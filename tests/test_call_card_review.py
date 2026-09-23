import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.export_call_card_review import build_review
from scripts.report_useful_card_latency import analyze, format_report


MIGRATIONS = Path(__file__).resolve().parents[1] / "src-tauri/src/db/migrations"


class CallCardReviewTests(unittest.TestCase):
    def make_database(self, path: Path):
        with closing(sqlite3.connect(path)) as db:
            for filename in ("call-sessions.sql", "call-answer-cards.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',1000)")
            db.execute(
                "INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)",
                ("turn", "call", "system", 1, 1000, 2000, "What changed?"),
            )
            events = json.dumps([
                {"at": 2500, "delta": "Let me think. "},
                {"at": 3000, "delta": "The deadline moved to Friday."},
            ])
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("turn", "call", "openai", "gpt-test", "Let me think. The deadline moved to Friday.", events, 2200, 3100),
            )
            db.commit()

    def test_export_reconstructs_visible_checkpoints_and_leaves_labels_blank(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            self.make_database(path)
            review = build_review(path, "call")
            card = review["sessions"][0]["cards"][0]
            self.assertEqual(card["questionEndedAt"], 2000)
            self.assertEqual(card["checkpoints"][0]["visibleText"], "Let me think. ")
            self.assertEqual(card["checkpoints"][1]["visibleText"], card["answer"])
            self.assertIsNone(card["cardUseful"])
            self.assertIsNone(card["firstUsefulCheckpoint"])

    def test_report_uses_first_labeled_useful_checkpoint_and_enforces_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            self.make_database(path)
            review = build_review(path)
            card = review["sessions"][0]["cards"][0]
            card["cardUseful"] = True
            card["firstUsefulCheckpoint"] = 1
            result = analyze(review)
            self.assertEqual(result["p50Ms"], 1000)
            self.assertEqual(result["p95Ms"], 1000)
            self.assertFalse(result["gateEligible"])
            self.assertIn("No useful checkpoint: 0", format_report(result))

            card["cardUseful"] = False
            card["firstUsefulCheckpoint"] = 1
            with self.assertRaises(ValueError):
                analyze(review)

    def test_export_rejects_corrupt_stream_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            self.make_database(path)
            with closing(sqlite3.connect(path)) as db:
                db.execute("UPDATE call_answer_cards SET stream_events='[]'")
                db.commit()
            with self.assertRaises(ValueError):
                build_review(path)


if __name__ == "__main__":
    unittest.main()
