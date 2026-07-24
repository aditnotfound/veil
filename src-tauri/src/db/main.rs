use tauri_plugin_sql::{Migration, MigrationKind};

/// Returns all database migrations
pub fn migrations() -> Vec<Migration> {
    vec![
        // Migration 1: Create system_prompts table with indexes and triggers
        Migration {
            version: 1,
            description: "create_system_prompts_table",
            sql: include_str!("migrations/system-prompts.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 2: Create chat history tables (conversations and messages)
        Migration {
            version: 2,
            description: "create_chat_history_tables",
            sql: include_str!("migrations/chat-history.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 3: Personal knowledge base, meetings, notes
        Migration {
            version: 3,
            description: "create_knowledge_meetings_notes",
            sql: include_str!("migrations/knowledge.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 4: Listen modes + curated system prompt metadata
        Migration {
            version: 4,
            description: "create_listen_modes",
            sql: include_str!("migrations/listen-modes.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
