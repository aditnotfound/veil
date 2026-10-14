import Database from "@tauri-apps/plugin-sql";

/**
 * Database configuration
 */
export const DB_NAME = "sqlite:veil.db";

let dbInstance: Database | null = null;
let dbLoading: Promise<Database> | null = null;

/**
 * Get database instance
 */
export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbLoading) {
    // Prepare and Library mount together. Share initialization and migrations.
    dbLoading = Database.load(DB_NAME).then((db) => {
      dbInstance = db;
      return db;
    }).catch((error) => {
      dbLoading = null;
      throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return dbLoading;
}
