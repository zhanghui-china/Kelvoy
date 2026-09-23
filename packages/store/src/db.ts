import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { SCHEMA } from "./schema";

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
  return db;
}

export function getDb(): Database {
  if (!db) open();
  return db!;
}

export function close(): void {
  db?.close();
  db = null;
}
