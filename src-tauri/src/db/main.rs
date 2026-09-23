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
        Migration {
            version: 5,
            description: "create_call_sessions",
            sql: include_str!("migrations/call-sessions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_call_timing",
            sql: include_str!("migrations/call-timing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_call_decisions",
            sql: include_str!("migrations/call-decisions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "delete_call_session_records",
            sql: include_str!("migrations/call-delete.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create_call_jev_shadow",
            sql: include_str!("migrations/call-jev-shadow.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "create_local_search_indexes",
            sql: include_str!("migrations/local-search.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "create_call_answer_cards",
            sql: include_str!("migrations/call-answer-cards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "create_call_deep_answers",
            sql: include_str!("migrations/call-deep-answers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "create_call_session_ledger",
            sql: include_str!("migrations/call-session-ledger.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "create_call_session_plans",
            sql: include_str!("migrations/call-session-plans.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "create_call_transcript_revisions",
            sql: include_str!("migrations/call-transcript-revisions.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
