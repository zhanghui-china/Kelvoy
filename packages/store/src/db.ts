import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { COLUMN_MIGRATIONS, SCHEMA } from "./schema";

// ADR-0004: single-file SQLite, lazy singleton. Not exported directly —
// episodes.ts/destinations.ts/tasks.ts are the public surface, so a future
// networked implementation can replace this file without touching them.
let db: Database | null = null;

const DEFAULT_PATH = "data/kelvoy.db";

/** Opens (or reopens) the store at `path`. Tests use ":memory:" for isolation. */
export function open(path: string = process.env.KELVOY_DB_PATH ?? DEFAULT_PATH): Database {
  if (db) close();
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new Database(path, { create: true });
  db.exec("pragma journal_mode = WAL;");
  db.exec(SCHEMA);
  applyColumnMigrations(db);
  return db;
}

// 见 schema.ts 的 COLUMN_MIGRATIONS：给已存在的表补新列，新建的库这里全是
// no-op（SCHEMA 已经带上了这些列）。
function applyColumnMigrations(database: Database): void {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = database
      .query<{ name: string }, []>(`pragma table_info(${migration.table})`)
      .all();
    if (!columns.some((c) => c.name === migration.column)) database.exec(migration.ddl);
  }
}

export function getDb(): Database {
  if (!db) open();
  return db!;
}

export function close(): void {
  db?.close();
  db = null;
}
