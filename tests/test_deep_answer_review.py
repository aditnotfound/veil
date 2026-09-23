import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.export_deep_answer_review import build_review
from scripts.report_deep_answer_quality import analyze, format_report


MIGRATIONS = Path(__file__).resolve().parents[1] / "src-tauri/src/db/migrations"


class DeepAnswerReviewTests(unittest.TestCase):
    def make_database(self, path: Path):
        with closing(sqlite3.connect(path)) as db:
            for filename in ("call-sessions.sql", "call-answer-cards.sql", "call-deep-answers.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',1000)")
            db.execute(
                "INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)",
                ("turn", "call", "system", 1, 1000, 2000, "Prove the bound"),
            )
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("turn", "call", "fast", "small", "Opening", '[{"at":2500,"delta":"Opening"}]', 2100, 2600),
            )
            db.execute(
                "INSERT INTO call_deep_answers VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", "strong", "large", "Detailed proof", '[{"at":4000,"delta":"Detailed proof"}]', "draft", 2700, 4100),
            )
            db.commit()

    def test_export_is_source_linked_and_unlabeled(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            self.make_database(path)
            review = build_review(path, "call")
            answer = review["sessions"][0]["answers"][0]
            self.assertEqual(answer["turnId"], "turn")
            self.assertEqual(answer["initialAnswer"], "Opening")
            self.assertEqual(answer["deepAnswer"], "Detailed proof")
            self.assertIsNone(answer["correctness"])
            self.assertIsNone(review["graderId"])

    def test_report_requires_complete_independent_grades(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            self.make_database(path)
            review = build_review(path)
            with self.assertRaises(ValueError):
                analyze(review)
            review["graderId"] = "reviewer-1"
            answer = review["sessions"][0]["answers"][0]
            answer.update({
                "inScopeHardQuestion": True,
                "correctness": "correct",
                "proofAdequacy": "adequate",
                "improperVerificationClaim": False,
            })
            result = analyze(review)
            self.assertEqual(result["correctRate"], 1.0)
            self.assertEqual(result["fullDraftP50Ms"], 2100)
            self.assertIn("Improper checked/proven/final claims: 0", format_report(result))

    def test_out_of_scope_answer_does_not_require_quality_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            self.make_database(path)
            review = build_review(path)
            review["graderId"] = "reviewer-2"
            review["sessions"][0]["answers"][0]["inScopeHardQuestion"] = False
            result = analyze(review)
            self.assertEqual(result["inScopeAnswers"], 0)
            self.assertEqual(result["outOfScopeAnswers"], 1)


if __name__ == "__main__":
    unittest.main()
