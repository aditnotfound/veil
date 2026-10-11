import hashlib
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from report_visible_call_latency import analyze, format_report


class VisibleLatencyReportTests(unittest.TestCase):
    def test_repeated_prompt_attempts_reject_prechunk_ui_text(self):
        root = Path(__file__).resolve().parents[1]
        prompt = "Why does fitting a scaler before validation leak information?"
        digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            db_path = Path(folder) / "veil.db"
            events_path = Path(folder) / "events.jsonl"
            with closing(sqlite3.connect(db_path)) as db:
                for migration in ("call-sessions.sql", "call-answer-attempts.sql"):
                    db.executescript((root / "src-tauri/src/db/migrations" / migration).read_text())
                db.execute("INSERT INTO call_sessions(id, started_at) VALUES ('s', 1)")
                db.execute(
                    "INSERT INTO call_utterances VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("u", "s", "system", 1, 100, 200, prompt),
                )
                for initiator, start, first, end in (
                    ("automatic", 250, 300, 400),
                    ("answer_now", 600, 680, 750),
                ):
                    db.execute(
                        "INSERT INTO call_answer_attempts "
                        "(turn_id, session_id, initiator, started_at, first_chunk_at, completed_at, outcome) "
                        "VALUES (?, ?, ?, ?, ?, ?, 'answered')",
                        ("u", "s", initiator, start, first, end),
                    )
                db.commit()
            first_text = [json.dumps({
                "event": "first_answer_text", "at": at, "promptHash": digest,
            }) for at in (290, 350, 650, 700)]
            samples = [json.dumps({
                "event": "observer_sample", "at": at, "promptHash": "",
            }) for at in (260, 320, 620, 690)]
            events_path.write_text("\n".join(first_text + samples), encoding="utf-8")
            result = analyze(db_path, events_path, "s")

        self.assertEqual(result["prematureEvents"], 2)
        self.assertEqual(result["unmatchedEvents"], 0)
        self.assertEqual([item["visibleAt"] for item in result["attempts"]], [350, 700])
        self.assertEqual([item["questionEndToVisibleMs"] for item in result["attempts"]], [150, 500])
        self.assertIn("missingVisible=0", format_report(result))

    def test_attempts_before_observer_started_are_unobserved_not_missing(self):
        root = Path(__file__).resolve().parents[1]
        prompt = "How does the cache work?"
        digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            db_path = Path(folder) / "veil.db"
            events_path = Path(folder) / "events.jsonl"
            with closing(sqlite3.connect(db_path)) as db:
                for migration in ("call-sessions.sql", "call-answer-attempts.sql"):
                    db.executescript((root / "src-tauri/src/db/migrations" / migration).read_text())
                db.execute("INSERT INTO call_sessions(id, started_at) VALUES ('s', 1)")
                db.execute("INSERT INTO call_utterances VALUES (?, ?, ?, ?, ?, ?, ?)",
                           ("u", "s", "system", 1, 100, 200, prompt))
                for start, first, end in ((250, 300, 400), (600, 680, 750)):
                    db.execute(
                        "INSERT INTO call_answer_attempts "
                        "(turn_id, session_id, initiator, started_at, first_chunk_at, completed_at, outcome) "
                        "VALUES (?, ?, 'answer_now', ?, ?, ?, 'answered')",
                        ("u", "s", start, first, end),
                    )
                db.commit()
            events_path.write_text("\n".join(json.dumps(event) for event in (
                {"event": "observer_sample", "at": 610, "promptHash": ""},
                {"event": "observer_sample", "at": 690, "promptHash": ""},
                {"event": "first_answer_text", "at": 700, "promptHash": digest},
            )), encoding="utf-8")
            result = analyze(db_path, events_path, "s")

        self.assertEqual([item["visibleAt"] for item in result["attempts"]], [None, 700])
        self.assertIn("missingVisible=0, unobserved=1", format_report(result))


if __name__ == "__main__":
    unittest.main()
