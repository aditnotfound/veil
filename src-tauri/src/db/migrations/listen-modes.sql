-- Migration 4: Listen Modes + curated prompt metadata

ALTER TABLE system_prompts ADD COLUMN category TEXT;
ALTER TABLE system_prompts ADD COLUMN recommended_model TEXT;
ALTER TABLE system_prompts ADD COLUMN recommended_provider TEXT;
ALTER TABLE system_prompts ADD COLUMN blurb TEXT;
ALTER TABLE system_prompts ADD COLUMN is_default INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS listen_modes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    prompt_id INTEGER,
    sort_order INTEGER NOT NULL,
    is_builtin INTEGER DEFAULT 1,
    FOREIGN KEY(prompt_id) REFERENCES system_prompts(id)
);

CREATE INDEX IF NOT EXISTS idx_listen_modes_sort_order ON listen_modes(sort_order);
CREATE INDEX IF NOT EXISTS idx_system_prompts_is_default ON system_prompts(is_default);
