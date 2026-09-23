import json
import sqlite3
import subprocess
import unittest
from contextlib import closing
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "src-tauri/src/db/migrations"


class SessionReviewQueryTests(unittest.TestCase):
    def test_exact_read_model_joins_initial_and_deep_answers_to_their_turn(self):
        code = (
            'import {CALL_LEDGER_SQL,CALL_SUGGESTIONS_SQL} from "./src/lib/call/session-review.ts"; '
            'import {SAVE_REGENERATED_CALL_ANSWER_SQL} from "./src/lib/call/answer-card.ts"; '
            'console.log(JSON.stringify({suggestions:CALL_SUGGESTIONS_SQL,ledger:CALL_LEDGER_SQL,saveRegenerated:SAVE_REGENERATED_CALL_ANSWER_SQL}));'
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", code], cwd=ROOT,
            text=True, capture_output=True, check=True,
        )
        queries = json.loads(result.stdout)

        with closing(sqlite3.connect(":memory:")) as db:
            db.row_factory = sqlite3.Row
            for filename in ("call-sessions.sql", "call-answer-cards.sql", "call-deep-answers.sql", "call-session-ledger.sql", "call-session-plans.sql", "call-transcript-revisions.sql", "call-answer-regeneration.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.executemany("INSERT INTO call_sessions(id,started_at) VALUES (?,1)", [("call",), ("other",)])
            db.executemany("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", [
                ("turn", "call", "system", 1, 1, 2, "Explain the method"),
                ("private", "other", "system", 1, 1, 2, "Other session"),
            ])
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("turn", "call", "fast", "small", "Opening", '[{"at":3,"delta":"Opening"}]', 2, 3),
            )
            db.execute(
                "INSERT INTO call_deep_answers VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", "strong", "large", "Proof", '[{"at":4,"delta":"Proof"}]', "draft", 3, 4),
            )
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("private", "other", "fast", "small", "Secret", '[{"at":3,"delta":"Secret"}]', 2, 3),
            )
            db.executemany("INSERT INTO call_session_ledger VALUES (?,?,?,?,?,?,?)", [
                ("ledger", "call", "turn", "fact", "The method uses calibration.", "candidate", 2),
                ("private-ledger", "other", "private", "fact", "Secret fact", "candidate", 2),
            ])
            rows = db.execute(queries["suggestions"], ("call", "call")).fetchall()
            self.assertEqual([(row["tier"], row["answer_text"]) for row in rows], [
                ("initial", "Opening"), ("deep", "Proof")
            ])
            self.assertTrue(all(row["turn_id"] == "turn" for row in rows))
            ledger = db.execute(queries["ledger"], ("call",)).fetchall()
            self.assertEqual([(row["source_utterance_id"], row["excerpt"]) for row in ledger], [
                ("turn", "The method uses calibration.")
            ])
            self.assertEqual(ledger[0]["source"], "system")
            db.execute("UPDATE call_utterances SET text='Corrected method question' WHERE id='turn'")
            stale_rows = db.execute(queries["suggestions"], ("call", "call")).fetchall()
            self.assertEqual([row["status"] for row in stale_rows], ["stale", "stale"])
            self.assertEqual(db.execute(queries["ledger"], ("call",)).fetchall(), [])

            db.execute(
                "INSERT OR REPLACE INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("turn", "call", "fast", "small", "Replacement", '[{"at":5,"delta":"Replacement"}]', 4, 5),
            )
            one_regenerated = db.execute(queries["suggestions"], ("call", "call")).fetchall()
            self.assertEqual([row["status"] for row in one_regenerated], ["stale", "unverified"])
            self.assertEqual(
                [(row["tier"], row["reason"]) for row in db.execute(
                    "SELECT tier, reason FROM call_answer_invalidations ORDER BY tier"
                )],
                [("deep", "transcript_corrected")],
            )

            db.execute(
                "INSERT OR REPLACE INTO call_deep_answers VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", "strong", "large", "Replacement proof", '[{"at":6,"delta":"Replacement proof"}]', "draft", 5, 6),
            )
            all_regenerated = db.execute(queries["suggestions"], ("call", "call")).fetchall()
            self.assertEqual([row["status"] for row in all_regenerated], ["unverified", "draft"])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_answer_invalidations").fetchone()[0], 0)

            db.execute("UPDATE call_utterances SET text='Changed during generation' WHERE id='turn'")
            rejected = db.execute(queries["saveRegenerated"], (
                "turn", "call", "fast", "small", "Raced answer",
                '[{"at":7,"delta":"Raced answer"}]', 6, 7,
                "turn", "call", "Corrected method question",
            ))
            self.assertEqual(rejected.rowcount, 0)
            self.assertEqual(
                db.execute("SELECT answer_text FROM call_answer_cards WHERE turn_id='turn'").fetchone()[0],
                "Replacement",
            )
            self.assertEqual(
                [tuple(row) for row in db.execute("SELECT tier FROM call_answer_invalidations ORDER BY tier")],
                [("deep",), ("initial",)],
            )


if __name__ == "__main__":
    unittest.main()
