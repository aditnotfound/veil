//! Builds from checkouts with different line endings embed byte-different
//! migration SQL, and tauri-plugin-sql refuses to open a database whose
//! recorded checksum no longer matches. Re-record checksums for migrations
//! whose SQL differs only in line endings; genuine SQL changes still fail.

use sha2::{Digest, Sha384};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{path::Path, time::Duration};

fn line_ending_variants(sql: &str) -> [String; 2] {
    let lf = sql.replace("\r\n", "\n");
    let crlf = lf.replace('\n', "\r\n");
    [lf, crlf]
}

pub async fn repair_line_ending_checksums(db_path: &Path) -> Result<usize, String> {
    if !db_path.exists() {
        return Ok(0);
    }
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| error.to_string())?;
    repair_on_connection(&mut connection).await
}

async fn repair_on_connection(connection: &mut SqliteConnection) -> Result<usize, String> {
    let has_table = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(&mut *connection)
    .await
    .map_err(|error| error.to_string())?
    .is_some();
    if !has_table {
        return Ok(0);
    }

    let rows = sqlx::query("SELECT version, checksum FROM _sqlx_migrations")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;

    let mut repaired = 0;
    for migration in super::migrations() {
        let Some(row) = rows
            .iter()
            .find(|row| row.get::<i64, _>("version") == migration.version)
        else {
            continue;
        };
        let stored: Vec<u8> = row.get("checksum");
        let current = Sha384::digest(migration.sql.as_bytes()).to_vec();
        if stored == current {
            continue;
        }
        let same_sql = line_ending_variants(migration.sql)
            .iter()
            .any(|variant| Sha384::digest(variant.as_bytes()).as_slice() == stored.as_slice());
        if !same_sql {
            continue;
        }
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(current)
            .bind(migration.version)
            .execute(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        repaired += 1;
    }
    Ok(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup(checksum_for: impl Fn(&str) -> Vec<u8>) -> SqliteConnection {
        let mut connection = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, checksum BLOB NOT NULL)")
            .execute(&mut connection)
            .await
            .unwrap();
        for migration in crate::db::migrations() {
            sqlx::query("INSERT INTO _sqlx_migrations (version, checksum) VALUES (?, ?)")
                .bind(migration.version)
                .bind(checksum_for(migration.sql))
                .execute(&mut connection)
                .await
                .unwrap();
        }
        connection
    }

    async fn stored(connection: &mut SqliteConnection) -> Vec<Vec<u8>> {
        sqlx::query("SELECT checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(connection)
            .await
            .unwrap()
            .iter()
            .map(|row| row.get("checksum"))
            .collect()
    }

    fn current() -> Vec<Vec<u8>> {
        crate::db::migrations()
            .iter()
            .map(|migration| Sha384::digest(migration.sql.as_bytes()).to_vec())
            .collect()
    }

    #[tokio::test]
    async fn checksums_recorded_with_other_line_endings_are_rewritten() {
        let mut connection = setup(|sql| {
            let flipped = if sql.contains("\r\n") {
                sql.replace("\r\n", "\n")
            } else {
                sql.replace('\n', "\r\n")
            };
            Sha384::digest(flipped.as_bytes()).to_vec()
        })
        .await;
        let repaired = repair_on_connection(&mut connection).await.unwrap();
        assert_eq!(repaired, crate::db::migrations().len());
        assert_eq!(stored(&mut connection).await, current());
    }

    #[tokio::test]
    async fn genuinely_changed_sql_is_left_for_the_migrator_to_reject() {
        let mut connection =
            setup(|sql| Sha384::digest(format!("{sql}-- edited").as_bytes()).to_vec()).await;
        assert_eq!(repair_on_connection(&mut connection).await.unwrap(), 0);
        assert_ne!(stored(&mut connection).await, current());
    }
}
