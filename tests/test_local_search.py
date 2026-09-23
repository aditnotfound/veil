import json
import sqlite3
import subprocess
import unittest
from contextlib import closing
from pathlib import Path


MIGRATIONS = Path(__file__).resolve().parents[1] / "src-tauri/src/db/migrations"


class LocalSearchMigrationTests(unittest.TestCase):
    def test_rebuild_and_triggers_keep_call_and_knowledge_indexes_current(self):
        with closing(sqlite3.connect(":memory:")) as db:
            for filename in ("knowledge.sql", "call-sessions.sql", "call-timing.sql", "call-decisions.sql", "call-delete.sql", "call-jev-shadow.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.execute("INSERT INTO knowledge_sources(id,title,kind,created_at,updated_at) VALUES ('source','Lab notes','note',1,1)")
            db.execute("INSERT INTO knowledge_chunks(id,source_id,chunk_index,content,embedding,created_at) VALUES ('chunk','source',0,'The calibration deadline is October twelve','[]',1)")
            db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',1)")
            db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("turn", "call", "mic", 1, 1, 2, "We agreed on October twelve"))
            db.executescript((MIGRATIONS / "local-search.sql").read_text())
            self.assertEqual(db.execute("SELECT COUNT(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'calibration'").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_utterances_fts WHERE call_utterances_fts MATCH 'agreed'").fetchone()[0], 1)

            db.execute("UPDATE knowledge_chunks SET content='The revised deadline is November twelve' WHERE id='chunk'")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'calibration'").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'revised'").fetchone()[0], 1)
            db.execute("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", ("turn2", "call", "system", 2, 3, 4, "Please confirm the deadline"))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_utterances_fts WHERE call_utterances_fts MATCH 'deadline'").fetchone()[0], 1)
            db.execute("DELETE FROM call_sessions WHERE id='call'")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM call_utterances_fts WHERE call_utterances_fts MATCH 'deadline'").fetchone()[0], 0)
            db.execute("DELETE FROM knowledge_chunks WHERE id='chunk'")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'revised'").fetchone()[0], 0)


    def test_live_query_excludes_current_future_recent_and_other_sessions(self):
        # Exercise the exact TypeScript query plan against SQLite FTS5.
        root = Path(__file__).resolve().parents[1]
        code = (
            'import {readFileSync} from "node:fs"; '
            'import {buildCallSearchQuery} from "./src/lib/call/local-search.ts"; '
            'const [sid,text,pivot,excluded] = JSON.parse(readFileSync(0,"utf8")); '
            'console.log(JSON.stringify(buildCallSearchQuery(sid,text,pivot,excluded)));'
        )
        with closing(sqlite3.connect(":memory:")) as db:
            for filename in ("knowledge.sql", "call-sessions.sql", "local-search.sql"):
                db.executescript((MIGRATIONS / filename).read_text())
            db.executemany("INSERT INTO call_sessions(id,started_at) VALUES (?,1)", [("call",), ("other",)])
            db.executemany("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", [
                ("old", "call", "mic", 1, 1000, 2000, "We agreed October twelve for calibration"),
                ("recent", "call", "system", 2, 2500, 2800, "Calibration deadline recap"),
                ("pivot", "call", "system", 3, 3000, 4000, "What is the calibration deadline we agreed on?"),
                ("future", "call", "system", 4, 5000, 6000, "The calibration deadline changed"),
                ("other", "other", "mic", 1, 1000, 2000, "Calibration deadline private"),
            ])
            def query(before, excluded):
                payload = json.dumps(["call", "What is the calibration deadline we agreed on?", before, excluded])
                result = subprocess.run(
                    ["node", "--input-type=module", "-e", code], cwd=root,
                    input=payload, text=True, capture_output=True, check=True,
                )
                plan = json.loads(result.stdout)
                return [row[0] for row in db.execute(plan["sql"], plan["args"])]
            self.assertEqual(query("pivot", ["recent"]), ["old"])
            self.assertEqual(set(query(None, [])), {"old", "recent", "pivot", "future"})
            self.assertEqual(query("nonexistent", []), [])


if __name__ == "__main__":
    unittest.main()
