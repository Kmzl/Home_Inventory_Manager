import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

export type DbInstance = Database.Database;

export function resolveDatabasePath(databaseUrl: string): string {
  if (path.isAbsolute(databaseUrl)) return databaseUrl;
  return path.resolve(process.cwd(), databaseUrl);
}

function initSchema(db: DbInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      location TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items(deleted_at);
  `);
}

export function createDb(databaseUrl: string): DbInstance {
  const dbPath = resolveDatabasePath(databaseUrl);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}
