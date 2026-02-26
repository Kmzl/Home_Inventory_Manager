import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

export type DbInstance = Database.Database;

export function resolveDatabasePath(databaseUrl: string): string {
  if (path.isAbsolute(databaseUrl)) return databaseUrl;
  return path.resolve(process.cwd(), databaseUrl);
}

function hasColumn(db: DbInstance, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function ensureColumn(db: DbInstance, table: string, column: string, ddl: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function initSchema(db: DbInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      level INTEGER NOT NULL,
      name TEXT NOT NULL,
      alias TEXT,
      note TEXT,
      image_url TEXT,
      path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(parent_id, name),
      FOREIGN KEY(parent_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      location TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      category_id INTEGER,
      primary_location_id INTEGER,
      image_url TEXT,
      expiry_date TEXT,
      opened_at TEXT,
      valid_days_after_open INTEGER,
      remind_days INTEGER NOT NULL DEFAULT 7,
      low_stock_threshold INTEGER,
      last_confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY(category_id) REFERENCES categories(id),
      FOREIGN KEY(primary_location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS item_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(item_id, location_id),
      FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      risk_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      UNIQUE(item_id, risk_type),
      FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS todo_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      risk_event_id INTEGER NOT NULL UNIQUE,
      handled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(risk_event_id) REFERENCES risk_events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_item_locations_item_id ON item_locations(item_id);
    CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON locations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_risk_events_status ON risk_events(status);
  `);

  // Compatible migration for older DBs
  ensureColumn(db, "items", "category_id", "category_id INTEGER");
  ensureColumn(db, "items", "primary_location_id", "primary_location_id INTEGER");
  ensureColumn(db, "items", "image_url", "image_url TEXT");
  ensureColumn(db, "items", "expiry_date", "expiry_date TEXT");
  ensureColumn(db, "items", "opened_at", "opened_at TEXT");
  ensureColumn(db, "items", "valid_days_after_open", "valid_days_after_open INTEGER");
  ensureColumn(db, "items", "remind_days", "remind_days INTEGER NOT NULL DEFAULT 7");
  ensureColumn(db, "items", "low_stock_threshold", "low_stock_threshold INTEGER");
  ensureColumn(db, "items", "last_confirmed_at", "last_confirmed_at TEXT");
}

export function createDb(databaseUrl: string): DbInstance {
  const dbPath = resolveDatabasePath(databaseUrl);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}
