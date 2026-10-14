import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'src-tauri/src/db/migrations'
SOURCE = (ROOT / 'src/lib/knowledge/preparation.ts').read_text(encoding='utf-8')

def sql_constant(name):
    return re.search(r'export const ' + name + r' = `([\s\S]*?)`;', SOURCE).group(1)

def database(foreign_keys=True):
    db = sqlite3.connect(':memory:')
    db.execute(f'PRAGMA foreign_keys={int(foreign_keys)}')
    for name in re.findall(r'include_str!\("migrations/([^"]+)"\)', (ROOT / 'src-tauri/src/db/main.rs').read_text()):
        db.executescript((MIGRATIONS / name).read_text())
    return db

def add_source(db, ident, enabled=1, pinned=0):
    db.execute('INSERT INTO knowledge_sources (id,title,kind,raw_text,created_at,updated_at,enabled,pinned) VALUES (?,?,?, ?,1,1,?,?)', (ident, ident, 'note', 'database project', enabled, pinned))
    db.execute('INSERT INTO knowledge_chunks VALUES (?,?,0,?,\'[]\',1)', (ident+'-chunk', ident, 'database project'))

class KnowledgePreparationTests(unittest.TestCase):
    def test_migration_preserves_existing_sources_and_chunks(self):
        db = sqlite3.connect(':memory:')
        for name in ['knowledge.sql', 'call-sessions.sql', 'local-search.sql']:
            db.executescript((MIGRATIONS / name).read_text())
        db.execute("INSERT INTO knowledge_sources VALUES ('old','Old','note','[]','original',1,1)")
        db.execute("INSERT INTO knowledge_chunks VALUES ('chunk','old',0,'original','[]',1)")
        db.executescript((MIGRATIONS / 'knowledge-preparation.sql').read_text())
        self.assertEqual(db.execute('SELECT raw_text,enabled,pinned FROM knowledge_sources').fetchone(), ('original',1,0))
        self.assertEqual(db.execute("SELECT count(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'original'").fetchone()[0], 1)
        db.close()

    def test_actual_search_and_pin_queries_exclude_disabled_sources(self):
        db = database()
        add_source(db, 'included'); add_source(db, 'excluded', enabled=0, pinned=1); add_source(db, 'pin', pinned=1)
        rows = db.execute(sql_constant('LOCAL_KNOWLEDGE_SQL'), ('"database"*',)).fetchall()
        self.assertEqual({row[1] for row in rows}, {'included','pin'})
        self.assertEqual([row[1] for row in db.execute(sql_constant('PINNED_KNOWLEDGE_SQL'))], ['pin'])
        db.execute("UPDATE knowledge_sources SET enabled=0 WHERE id='pin'")
        self.assertEqual(db.execute(sql_constant('PINNED_KNOWLEDGE_SQL')).fetchall(), [])
        db.close()

    def test_search_excerpt_includes_a_match_at_end_of_long_note(self):
        db = database()
        add_source(db, 'long')
        db.execute("UPDATE knowledge_chunks SET content=? WHERE source_id='long'", ('background ' * 190 + 'The launch codename is Zephyr.',))
        rows = db.execute(sql_constant('LOCAL_KNOWLEDGE_SQL'), ('"Zephyr"*',)).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertIn('Zephyr', rows[0][2][:700])
        db.close()

    def test_session_context_is_a_snapshot_and_prunes_even_without_foreign_keys(self):
        for foreign_keys in [True,False]:
            with self.subTest(foreign_keys=foreign_keys):
                db = database(foreign_keys)
                db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',1)")
                db.execute("INSERT INTO knowledge_preparation VALUES (1,?,1)", ('{"aboutYou":"original"}',))
                db.execute("INSERT INTO call_session_context VALUES ('call','original',1)")
                db.execute("UPDATE knowledge_preparation SET preparation_json=?", ('{"aboutYou":"changed"}',))
                self.assertEqual(db.execute('SELECT context_text FROM call_session_context').fetchone()[0], 'original')
                db.execute("DELETE FROM call_sessions WHERE id='call'")
                self.assertEqual(db.execute('SELECT count(*) FROM call_session_context').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT count(*) FROM knowledge_preparation').fetchone()[0], 1)
                db.close()

    def test_actual_pin_update_enforces_three_pin_limit(self):
        db = database()
        source = (ROOT / 'src/lib/knowledge/store.ts').read_text(encoding='utf-8')
        query = re.search(r'`(UPDATE knowledge_sources SET pinned = 1[^`]+)`', source).group(1)
        for i in range(4):
            add_source(db, str(i))
            db.execute(query, (str(i),))
        self.assertEqual(db.execute('SELECT sum(pinned) FROM knowledge_sources').fetchone()[0],3)
        db.execute("UPDATE knowledge_sources SET pinned=0 WHERE id='0'")
        db.execute(query, ('3',))
        self.assertEqual(db.execute("SELECT pinned FROM knowledge_sources WHERE id='3'").fetchone()[0], 1)
        db.close()

if __name__ == '__main__':
    unittest.main()
