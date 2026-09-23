-- Local lexical indexes for long-call context and the personal knowledge library.
-- External-content FTS tables avoid duplicating transcript and document text in
-- normal query results while preserving a fast path through existing records.
CREATE VIRTUAL TABLE IF NOT EXISTS call_utterances_fts USING fts5(
    text, content='call_utterances', content_rowid='rowid', tokenize='porter unicode61'
);
INSERT INTO call_utterances_fts(call_utterances_fts) VALUES ('rebuild');

CREATE TRIGGER IF NOT EXISTS call_utterances_fts_insert AFTER INSERT ON call_utterances BEGIN
    INSERT INTO call_utterances_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS call_utterances_fts_delete AFTER DELETE ON call_utterances BEGIN
    INSERT INTO call_utterances_fts(call_utterances_fts, rowid, text)
    VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS call_utterances_fts_update AFTER UPDATE ON call_utterances BEGIN
    INSERT INTO call_utterances_fts(call_utterances_fts, rowid, text)
    VALUES ('delete', old.rowid, old.text);
    INSERT INTO call_utterances_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    content, content='knowledge_chunks', content_rowid='rowid', tokenize='porter unicode61'
);
INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES ('rebuild');

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_fts_update AFTER UPDATE ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
