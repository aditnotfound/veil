"""Export saved deep call drafts for independent expert grading.

Usage: python scripts/export_deep_answer_review.py --db PATH --out REVIEW.json [--session ID]
The output contains private call and generated text. Keep it local unless call
participants consent to sharing it.
"""

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3


def build_review(db_path: Path, session_id: str | None = None) -> dict:
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT d.session_id, d.turn_id, u.text AS prompt, u.ended_at AS question_ended_at, "
            "c.answer_text AS initial_answer, d.answer_text AS deep_answer, d.provider, d.model, "
            "d.status, d.started_at, d.completed_at "
            "FROM call_deep_answers d "
            "JOIN call_utterances u ON u.id = d.turn_id "
            "LEFT JOIN call_answer_cards c ON c.turn_id = d.turn_id "
            "WHERE (? IS NULL OR d.session_id = ?) "
            "ORDER BY d.session_id, u.started_at, d.completed_at",
            (session_id, session_id),
        ).fetchall()
    if not rows:
        raise ValueError("No saved deep call answers matched")

    sessions: dict[str, list[dict]] = {}
    for row in rows:
        item = {
            "turnId": row["turn_id"],
            "prompt": row["prompt"],
            "initialAnswer": row["initial_answer"],
            "deepAnswer": row["deep_answer"],
            "provider": row["provider"],
            "model": row["model"],
            "displayedStatus": row["status"],
            "questionEndedAt": row["question_ended_at"],
            "deepStartedAt": row["started_at"],
            "deepCompletedAt": row["completed_at"],
            "inScopeHardQuestion": None,
            "correctness": None,
            "proofAdequacy": None,
            "improperVerificationClaim": None,
            "graderNotes": "",
        }
        sessions.setdefault(row["session_id"], []).append(item)
    return {
        "description": "Independent deep-answer grading template. All labels are unset.",
        "rubricVersion": "deep-answer-v1",
        "graderId": None,
        "annotationGuide": (
            "Use a grader who did not author the answer. Mark inScopeHardQuestion first. For in-scope "
            "items, label correctness as correct, partially_correct, incorrect, or not_gradable; label "
            "proofAdequacy as adequate, incomplete, or not_applicable; and mark improperVerificationClaim "
            "true if the text claims checked/proven/verified/final status without an actual supplied check."
        ),
        "sessions": [{"id": key, "answers": answers} for key, answers in sessions.items()],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--session")
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Output already exists; choose a new path to avoid overwriting grades")
    review = build_review(args.db, args.session)
    args.out.write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    count = sum(len(session["answers"]) for session in review["sessions"])
    print(f"Exported {count} deep answer(s) to {args.out}")
