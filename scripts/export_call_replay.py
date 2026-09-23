"""Export a local Listen session as an unlabeled router replay template.

Usage: python scripts/export_call_replay.py --db PATH_TO_veil.db --out replay.json [--session ID]
The output contains transcript text. Keep it local unless participants consent to sharing.
"""

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3


def build_replay(db_path: Path, session_id: str | None = None) -> dict:
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        sessions = db.execute(
            "SELECT s.id, s.started_at, s.ended_at FROM call_sessions s "
            "WHERE (? IS NULL OR s.id = ?) AND EXISTS "
            "(SELECT 1 FROM call_utterances u WHERE u.session_id = s.id) "
            "ORDER BY s.started_at, s.id",
            (session_id, session_id),
        ).fetchall()
        if not sessions:
            raise ValueError("No saved Listen session with transcript turns matched")

        exported = []
        for session in sessions:
            rows = db.execute(
                "SELECT u.id, u.session_id, u.source, u.sequence, u.started_at, "
                "u.ended_at, u.text, t.status "
                "FROM call_utterances u "
                "LEFT JOIN call_turn_timings t ON t.turn_id = u.id "
                "WHERE u.session_id = ? "
                "ORDER BY u.started_at, u.ended_at, u.source, u.sequence",
                (session["id"],),
            ).fetchall()
            turns = []
            for row in rows:
                turn = {
                    "id": row["id"],
                    "sessionId": row["session_id"],
                    "source": row["source"],
                    "sequence": row["sequence"],
                    "startedAt": row["started_at"],
                    "endedAt": row["ended_at"],
                    "text": row["text"],
                    "usefulSuggestion": None,
                }
                if row["status"] is not None:
                    turn["answerSucceeded"] = row["status"] == "answered"
                turns.append(turn)
            exported.append({
                "id": session["id"],
                "startedAt": session["started_at"],
                "endedAt": session["ended_at"],
                "negativeDurationMs": None,
                "turns": turns,
            })

    return {
        "description": "Local Listen replay template. Labels are intentionally unset.",
        "annotationGuide": (
            "Set usefulSuggestion to true only when an unsolicited card would help on that turn. "
            "Measure negativeDurationMs from reviewed intervals where no card would help. "
            "The export omits recorded routing decisions to support blind labeling. "
            "Use scripts/report_call_latency.py separately for post-VAD timing."
        ),
        "sessions": exported,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--session")
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Output already exists; choose a new path to avoid overwriting labels")
    replay = build_replay(args.db, args.session)
    args.out.write_text(json.dumps(replay, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Exported {len(replay['sessions'])} session(s) to {args.out}")
