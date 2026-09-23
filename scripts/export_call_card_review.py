"""Export completed Listen cards for blinded checkpoint usefulness review.

Usage: python scripts/export_call_card_review.py --db PATH --out REVIEW.json [--session ID]
The output contains transcript and generated answer text. Keep it local unless
call participants consent to sharing it.
"""

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3


def _checkpoints(raw_events: str, answer: str, started_at: int, completed_at: int) -> list[dict]:
    try:
        events = json.loads(raw_events)
    except json.JSONDecodeError as error:
        raise ValueError("A saved call card has invalid stream-event JSON") from error
    if not isinstance(events, list) or not events:
        raise ValueError("A saved call card has no stream checkpoints")
    visible = ""
    checkpoints = []
    previous_at = started_at
    for index, event in enumerate(events):
        if not isinstance(event, dict) or not isinstance(event.get("at"), int) or not isinstance(event.get("delta"), str):
            raise ValueError("A saved call card has a malformed stream checkpoint")
        at = event["at"]
        delta = event["delta"]
        if not delta or at < previous_at or at > completed_at:
            raise ValueError("A saved call card has an invalid checkpoint timestamp or text")
        visible += delta
        checkpoints.append({"index": index, "at": at, "visibleText": visible})
        previous_at = at
    if visible != answer:
        raise ValueError("Saved call-card checkpoints do not reconstruct the final answer")
    return checkpoints


def build_review(db_path: Path, session_id: str | None = None) -> dict:
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT c.session_id, c.turn_id, u.source, u.started_at AS question_started_at, "
            "u.ended_at AS question_ended_at, u.text AS prompt, c.provider, c.model, "
            "c.answer_text, c.stream_events, c.started_at, c.completed_at "
            "FROM call_answer_cards c JOIN call_utterances u ON u.id = c.turn_id "
            "WHERE (? IS NULL OR c.session_id = ?) "
            "ORDER BY c.session_id, u.started_at, c.completed_at",
            (session_id, session_id),
        ).fetchall()
    if not rows:
        raise ValueError("No completed saved Listen cards matched")

    sessions: dict[str, list[dict]] = {}
    for row in rows:
        card = {
            "turnId": row["turn_id"],
            "source": row["source"],
            "questionStartedAt": row["question_started_at"],
            "questionEndedAt": row["question_ended_at"],
            "prompt": row["prompt"],
            "provider": row["provider"],
            "model": row["model"],
            "answer": row["answer_text"],
            "checkpoints": _checkpoints(
                row["stream_events"], row["answer_text"], row["started_at"], row["completed_at"]
            ),
            "cardUseful": None,
            "firstUsefulCheckpoint": None,
        }
        sessions.setdefault(row["session_id"], []).append(card)
    return {
        "description": "Local completed-card review. Labels are intentionally unset.",
        "annotationGuide": (
            "Read each prompt, then inspect checkpoints in order. Set cardUseful to true only when "
            "a displayed checkpoint would materially help during the call, and set firstUsefulCheckpoint "
            "to the earliest such checkpoint index. For an unusable card, set cardUseful to false and "
            "leave firstUsefulCheckpoint null. Do not judge a generic acknowledgement as useful."
        ),
        "sessions": [{"id": key, "cards": cards} for key, cards in sessions.items()],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--session")
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Output already exists; choose a new path to avoid overwriting labels")
    review = build_review(args.db, args.session)
    args.out.write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    count = sum(len(session["cards"]) for session in review["sessions"])
    print(f"Exported {count} completed card(s) to {args.out}")
