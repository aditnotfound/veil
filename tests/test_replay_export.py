import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.export_call_replay import build_replay


MIGRATIONS = Path(__file__).resolve().parents[1] / "src-tauri/src/db/migrations"


class ReplayExportTests(unittest.TestCase):
    def test_export_includes_silent_turns_and_requires_independent_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            with closing(sqlite3.connect(path)) as db:
                for filename in ("call-sessions.sql", "call-timing.sql", "call-decisions.sql", "call-delete.sql", "call-jev-shadow.sql"):
                    db.executescript((MIGRATIONS / filename).read_text())
                db.execute("INSERT INTO call_sessions(id,started_at,ended_at) VALUES ('call',1000,20000)")
                # Insert out of capture order to catch accidental row-order export.
                db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("second", "call", "system", 2, 4000, 5000, "What changed?"))
                db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("first", "call", "mic", 1, 2000, 3000, "Hello"))
                db.execute(
                    "INSERT INTO call_turn_timings(turn_id,session_id,source,audio_ready_at,status) VALUES (?,?,?,?,?)",
                    ("second", "call", "system", 5100, "answered"),
                )
                db.execute(
                    "INSERT INTO call_turn_decisions VALUES (?,?,?,?,?,?,?)",
                    ("second", "call", 5200, "deterministic-v1", "on_question", "short_answer", "explicit_question"),
                )
                db.commit()
            replay = build_replay(path, "call")
            session = replay["sessions"][0]
            self.assertIsNone(session["negativeDurationMs"])
            self.assertEqual([turn["id"] for turn in session["turns"]], ["first", "second"])
            self.assertTrue(all(turn["usefulSuggestion"] is None for turn in session["turns"]))
            self.assertTrue(session["turns"][1]["answerSucceeded"])
            self.assertTrue(all("observedDecision" not in turn for turn in session["turns"]))
            with self.assertRaises(ValueError):
                build_replay(path, "missing")


if __name__ == "__main__":
    unittest.main()
