import sqlite3
import unittest
from contextlib import closing
from pathlib import Path


MIGRATIONS = Path(__file__).resolve().parents[1] / "src-tauri/src/db/migrations"


class CallMigrationTests(unittest.TestCase):
    def test_restoring_previous_transcript_creates_a_new_audit_revision(self):
        with closing(sqlite3.connect(":memory:")) as db:
            for filename in (
                "call-sessions.sql", "call-answer-cards.sql",
                "call-session-ledger.sql", "call-session-plans.sql",
                "call-transcript-revisions.sql",
            ):
                db.executescript((MIGRATIONS / filename).read_text())
            db.execute("INSERT INTO call_sessions(id, started_at) VALUES ('call', 1)")
            db.execute(
                "INSERT INTO call_utterances VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("turn", "call", "system", 1, 2, 3, "original"),
            )
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("turn", "call", "fixture", "fixture", "answer", '[]', 4, 5),
            )
            db.execute("UPDATE call_utterances SET text='corrected' WHERE id='turn'")
            revision = db.execute(
                "SELECT id, previous_text FROM call_utterance_revisions ORDER BY id"
            ).fetchone()

            db.execute(
                "UPDATE call_utterances SET text=? WHERE id='turn'",
                (revision[1],),
            )

            self.assertEqual(
                db.execute("SELECT text FROM call_utterances WHERE id='turn'").fetchone()[0],
                "original",
            )
            self.assertEqual(
                db.execute(
                    "SELECT previous_text, corrected_text FROM call_utterance_revisions ORDER BY id"
                ).fetchall(),
                [("original", "corrected"), ("corrected", "original")],
            )
            self.assertEqual(
                db.execute("SELECT reason FROM call_answer_invalidations WHERE turn_id='turn'").fetchone(),
                ("transcript_corrected",),
            )

    def test_retention_prunes_only_sessions_older_than_cutoff(self):
        with closing(sqlite3.connect(":memory:")) as db:
            for filename in (
                "call-sessions.sql", "call-timing.sql", "call-decisions.sql",
                "call-delete.sql", "call-jev-shadow.sql", "call-answer-cards.sql",
                "call-deep-answers.sql", "call-session-ledger.sql",
                "call-session-plans.sql", "call-transcript-revisions.sql",
            ):
                db.executescript((MIGRATIONS / filename).read_text())

            db.executemany(
                "INSERT INTO call_sessions(id, started_at, ended_at) VALUES (?, ?, ?)",
                [
                    ("old", 100, 200),
                    ("recent", 700, 900),
                    ("active", 950, None),
                ],
            )
            db.executemany(
                "INSERT INTO call_utterances VALUES (?, ?, 'system', 1, ?, ?, ?)",
                [
                    ("old-turn", "old", 110, 120, "old"),
                    ("recent-turn", "recent", 710, 720, "recent"),
                    ("active-turn", "active", 960, 970, "active"),
                ],
            )
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("old-turn", "old", "fixture", "fixture", "old answer", '[]', 121, 122),
            )

            result = db.execute(
                "DELETE FROM call_sessions WHERE COALESCE(ended_at, started_at) < ?",
                (500,),
            )

            self.assertEqual(result.rowcount, 1)
            self.assertEqual(
                [row[0] for row in db.execute("SELECT id FROM call_sessions ORDER BY id")],
                ["active", "recent"],
            )
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_utterances WHERE session_id='old'").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_answer_cards WHERE session_id='old'").fetchone()[0], 0)

    def test_upgrade_preserves_legacy_rows_and_cascades_call_data(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.execute("PRAGMA foreign_keys=ON")
            for filename in ("system-prompts.sql", "chat-history.sql", "knowledge.sql", "listen-modes.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.execute("INSERT INTO conversations(id,title,created_at,updated_at) VALUES ('old','Old chat',1,1)")
            db.execute("INSERT INTO meetings(id,title,created_at,updated_at) VALUES ('old-meeting','Old meeting',1,1)")

            for filename in ("call-sessions.sql", "call-timing.sql", "call-decisions.sql", "call-delete.sql", "call-jev-shadow.sql", "call-answer-cards.sql", "call-deep-answers.sql", "call-session-ledger.sql", "call-session-plans.sql", "call-transcript-revisions.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            self.assertEqual(db.execute("SELECT title FROM conversations WHERE id='old'").fetchone()[0], "Old chat")
            self.assertEqual(db.execute("SELECT title FROM meetings WHERE id='old-meeting'").fetchone()[0], "Old meeting")

            db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',2)")
            db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("turn", "call", "mic", 1, 2, 3, "hello"))
            db.execute(
                "INSERT INTO call_turn_timings(turn_id,session_id,source,audio_ready_at,status) VALUES (?,?,?,?,?)",
                ("turn", "call", "mic", 3, "transcribed"),
            )
            db.execute(
                "INSERT INTO call_turn_decisions VALUES (?,?,?,?,?,?,?)",
                ("turn", "call", 3, "deterministic-v1", "after_pause", "silence", "mic_source"),
            )
            db.execute(
                "INSERT INTO call_jev_shadow VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", 3, "typesafe/jev-1.13", "after_pause", "valid", "silence", 0.7, 120.0),
            )
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("turn", "call", "openai", "model", "answer", '[{"at":4,"delta":"answer"}]', 3, 4),
            )
            db.execute(
                "INSERT INTO call_deep_answers VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", "openai", "model", "deep answer", '[{"at":5,"delta":"deep answer"}]', "draft", 4, 5),
            )
            db.execute(
                "INSERT INTO call_session_ledger VALUES (?,?,?,?,?,?,?)",
                ("ledger", "call", "turn", "fact", "hello", "candidate", 3),
            )
            db.execute(
                "INSERT INTO call_session_plans VALUES (?,?,?,?,?,?,?,?,?)",
                ("call", 1, "turn", "openai", "model", '{"objective":"test"}', "candidate", 3, 4),
            )
            db.execute("UPDATE call_utterances SET text='corrected hello' WHERE id='turn'")
            revision = db.execute(
                "SELECT previous_text, corrected_text FROM call_utterance_revisions"
            ).fetchone()
            self.assertEqual(revision, ("hello", "corrected hello"))
            self.assertEqual(db.execute("SELECT reason FROM call_answer_invalidations").fetchone()[0], "transcript_corrected")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_session_ledger").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_session_plans").fetchone()[0], 0)
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(
                    "INSERT INTO call_turn_decisions VALUES (?,?,?,?,?,?,?)",
                    ("missing", "call", 4, "deterministic-v1", "after_pause", "invalid", "test"),
                )
            db.execute("DELETE FROM call_sessions WHERE id='call'")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_utterances").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_turn_timings").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_turn_decisions").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_jev_shadow").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_answer_cards").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_deep_answers").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_session_ledger").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_session_plans").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_utterance_revisions").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_answer_invalidations").fetchone()[0], 0)

    def test_delete_removes_all_session_records_without_foreign_key_pragma(self):
        with closing(sqlite3.connect(":memory:")) as db:
            for filename in ("call-sessions.sql", "call-timing.sql", "call-decisions.sql", "call-delete.sql", "call-jev-shadow.sql", "call-answer-cards.sql", "call-deep-answers.sql", "call-session-ledger.sql", "call-session-plans.sql", "call-transcript-revisions.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 0)
            db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',2)")
            db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("turn", "call", "system", 1, 2, 3, "question"))
            db.execute(
                "INSERT INTO call_turn_timings(turn_id,session_id,source,audio_ready_at,status) VALUES (?,?,?,?,?)",
                ("turn", "call", "system", 3, "answered"),
            )
            db.execute(
                "INSERT INTO call_turn_decisions VALUES (?,?,?,?,?,?,?)",
                ("turn", "call", 3, "deterministic-v1", "on_question", "short_answer", "explicit_question"),
            )
            db.execute(
                "INSERT INTO call_jev_shadow VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", 3, "typesafe/jev-1.13", "on_question", "valid", "short_answer", 0.7, 120.0),
            )
            db.execute(
                "INSERT INTO call_answer_cards VALUES (?,?,?,?,?,?,?,?)",
                ("turn", "call", "openai", "model", "answer", '[{"at":4,"delta":"answer"}]', 3, 4),
            )
            db.execute(
                "INSERT INTO call_deep_answers VALUES (?,?,?,?,?,?,?,?,?)",
                ("turn", "call", "openai", "model", "deep answer", '[{"at":5,"delta":"deep answer"}]', "draft", 4, 5),
            )
            db.execute(
                "INSERT INTO call_session_ledger VALUES (?,?,?,?,?,?,?)",
                ("ledger", "call", "turn", "unresolved_question", "question", "candidate", 3),
            )
            db.execute(
                "INSERT INTO call_session_plans VALUES (?,?,?,?,?,?,?,?,?)",
                ("call", 1, "turn", "openai", "model", '{"objective":"test"}', "candidate", 3, 4),
            )
            db.execute("UPDATE call_utterances SET text='corrected question' WHERE id='turn'")
            db.execute("DELETE FROM call_sessions WHERE id='call'")
            for table in ("call_sessions", "call_utterances", "call_turn_timings", "call_turn_decisions", "call_jev_shadow", "call_answer_cards", "call_deep_answers", "call_session_ledger", "call_session_plans", "call_utterance_revisions", "call_answer_invalidations"):
                self.assertEqual(db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_shadow_table_rejects_choice_for_invalid_response(self):
        with closing(sqlite3.connect(":memory:")) as db:
            for filename in ("call-sessions.sql", "call-jev-shadow.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',1)")
            db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("turn", "call", "system", 1, 1, 2, "question"))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(
                    "INSERT INTO call_jev_shadow VALUES (?,?,?,?,?,?,?,?,?)",
                    ("turn", "call", 2, "typesafe/jev-1.13", "on_question", "invalid", "short_answer", None, 100.0),
                )


if __name__ == "__main__":
    unittest.main()
