"""Join passive packaged-window observations to one saved Veil call session.

Usage: py scripts/report_visible_call_latency.py --db PATH --events JSONL --session ID
The observer sees UI Automation text, not physical pixels or answer usefulness.
"""

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3

try:
    from scripts.report_call_latency import percentile
except ModuleNotFoundError:
    from report_call_latency import percentile


def _read_events(path: Path) -> list[dict]:
    events = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict) or not isinstance(event.get("at"), int) or not isinstance(event.get("promptHash"), str):
            raise ValueError(f"Invalid observation on line {line_number}")
        if event.get("event") == "first_answer_text":
            events.append(event)
    return sorted(events, key=lambda event: event["at"])


def analyze(db_path: Path, events_path: Path, session_id: str) -> dict:
    if not db_path.is_file() or not events_path.is_file():
        raise FileNotFoundError("Database or observation file is missing")
    events = _read_events(events_path)
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        if db.execute("SELECT 1 FROM call_sessions WHERE id = ?", (session_id,)).fetchone() is None:
            raise ValueError(f"Call session not found: {session_id}")
        rows = db.execute(
            "SELECT a.id, a.initiator, a.outcome, a.started_at, a.first_chunk_at, "
            "a.completed_at, u.ended_at, u.text "
            "FROM call_answer_attempts a JOIN call_utterances u "
            "ON u.id = a.turn_id AND u.session_id = a.session_id "
            "WHERE a.session_id = ? ORDER BY a.started_at, a.id",
            (session_id,),
        ).fetchall()
    used: set[int] = set()
    matches = []
    premature = 0
    digests = [hashlib.sha256(row["text"].strip().encode("utf-8")).hexdigest() for row in rows]
    for position, row in enumerate(rows):
        digest = digests[position]
        next_same_prompt = min(
            (future["started_at"] for future, future_digest in
             zip(rows[position + 1:], digests[position + 1:]) if future_digest == digest),
            default=None,
        )
        latest_at = row["completed_at"] + 5_000
        if next_same_prompt is not None:
            latest_at = min(latest_at, next_same_prompt - 1)
        visible_at = None
        for index, event in enumerate(events):
            if index in used or event["promptHash"] != digest:
                continue
            at = event["at"]
            if at < row["started_at"] or at > latest_at:
                continue
            if row["first_chunk_at"] is not None and at < row["first_chunk_at"]:
                premature += 1
                used.add(index)
                continue
            visible_at = at
            used.add(index)
            break
        matches.append({
            "initiator": row["initiator"],
            "outcome": row["outcome"],
            "visibleAt": visible_at,
            "questionEndToVisibleMs": visible_at - row["ended_at"] if visible_at is not None else None,
            "firstChunkToUiMs": visible_at - row["first_chunk_at"] if visible_at is not None and row["first_chunk_at"] is not None else None,
            "questionEndToCompleteMs": row["completed_at"] - row["ended_at"],
        })
    return {
        "sessionId": session_id,
        "attempts": matches,
        "observedEvents": len(events),
        "unmatchedEvents": len(events) - len(used),
        "prematureEvents": premature,
    }


def format_report(result: dict) -> str:
    lines = [
        f"Session: {result['sessionId']}",
        f"UI first-text events: {result['observedEvents']}",
        f"Unmatched UI events: {result['unmatchedEvents']}",
        f"Rejected events before provider first chunk: {result['prematureEvents']}",
    ]
    for initiator in ("automatic", "answer_now"):
        attempts = [item for item in result["attempts"] if item["initiator"] == initiator]
        if not attempts:
            continue
        answered = [item for item in attempts if item["outcome"] == "answered"]
        visible = [item for item in answered if item["visibleAt"] is not None]
        lines.append(
            f"\n{initiator}: attempts={len(attempts)}, answered={len(answered)}, "
            f"visible={len(visible)}, missingVisible={len(answered) - len(visible)}, "
            f"failed={sum(item['outcome'] == 'failed' for item in attempts)}, "
            f"canceled={sum(item['outcome'] == 'canceled' for item in attempts)}"
        )
        for key, label in (
            ("questionEndToVisibleMs", "Question end to first UI text"),
            ("firstChunkToUiMs", "Provider first chunk to UI text"),
            ("questionEndToCompleteMs", "Question end to completion"),
        ):
            values = [item[key] for item in visible if item[key] is not None]
            if values:
                lines.append(
                    f"  {label}: n={len(values)}, "
                    f"p50={percentile(values, 0.50):.0f} ms, "
                    f"p95={percentile(values, 0.95):.0f} ms"
                )
    lines.append(
        "\nUI Automation can expose a window covered by another app. "
        "These timestamps confirm rendered answer text in the Veil window, "
        "not that the user saw or found the text useful."
    )
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--session", required=True)
    args = parser.parse_args()
    print(format_report(analyze(args.db, args.events, args.session)))
