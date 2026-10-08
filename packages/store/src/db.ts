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
  // Web and Worker write to the same WAL database. Wait for short writer
  // transactions instead of crashing the Worker on a transient SQLITE_BUSY.
  db.exec("pragma busy_timeout = 5000;");
  db.exec("pragma journal_mode = WAL;");
  db.exec(SCHEMA);
  applyColumnMigrations(db);
  db.exec("create index if not exists idx_tasks_status_created_lease on tasks(status, created_at, lease_until)");
  db.exec("create index if not exists idx_tasks_episode_status_updated on tasks(episode_id, status, updated_at)");
  db.exec("create index if not exists idx_tasks_episode_stage_shot_status on tasks(episode_id, stage, shot_no, status)");
  migrateLegacyCatalogVersions(db);
  return db;
}

/** Capture legacy catalog snapshots once; missing historical revisions remain marked approximations. */
function migrateLegacyCatalogVersions(database: Database): void {
  database.transaction(() => {
    const migrated = database.query<{ migration_id: string }, [string]>(
      "select migration_id from schema_migrations where migration_id = ?",
    ).get("legacy_catalog_versions_v1");
    if (migrated) return;
    const owner = database.query<{ name: string; notnull: number }, []>("pragma table_info(personas)").all()
      .find((column) => column.name === "owner_id");
    if (owner?.notnull) {
      database.exec(`create table personas_new (
        persona_id text primary key, owner_id text, version integer not null default 1,
        doc text not null, updated_at text not null default (datetime('now')), deleted_at text
      );
      insert into personas_new select persona_id, owner_id, version, doc, updated_at, deleted_at from personas;
      drop table personas;
      alter table personas_new rename to personas;`);
    }
    // Existing current docs become exact revisions. Older versions referenced
    // by episodes cannot be reconstructed; freeze today's document under the
    // requested version once and mark that compatibility approximation.
    database.exec(`insert or ignore into persona_versions (persona_id, version, doc)
      select persona_id, version, doc from personas`);
    const rows = database.query<{ persona_id: string; persona_version: number }, []>(
      `select distinct json_extract(doc, '$.persona_id') as persona_id,
        json_extract(doc, '$.persona_version') as persona_version from episodes
       where json_valid(doc) and persona_id is not null and persona_version is not null`,
    ).all();
    for (const row of rows) {
      const current = database.query<{ doc: string }, [string]>("select doc from personas where persona_id = ?").get(row.persona_id);
      if (!current) continue;
      const approximation = { ...JSON.parse(current.doc), version: row.persona_version };
      database.query(`insert or ignore into persona_versions
        (persona_id, version, doc, compatibility_approximation) values (?, ?, ?, 1)`)
        .run(row.persona_id, row.persona_version, JSON.stringify(approximation));
    }
    database.exec(`insert or ignore into destination_versions (destination_id, version, doc)
      select destination_id, version, doc from destinations`);
    const destinations = database.query<{ destination_id: string; destination_version: number }, []>(
      `select distinct json_extract(doc, '$.destination_id') as destination_id,
        json_extract(doc, '$.destination_version') as destination_version from episodes
       where json_valid(doc) and destination_id is not null and destination_version is not null`,
    ).all();
    for (const row of destinations) {
      const current = database.query<{ doc: string }, [string]>(
        "select doc from destinations where destination_id = ?",
      ).get(row.destination_id);
      if (!current) continue;
      const approximation = { ...JSON.parse(current.doc), version: row.destination_version };
      database.query(`insert or ignore into destination_versions
        (destination_id, version, doc, compatibility_approximation) values (?, ?, ?, 1)`)
        .run(row.destination_id, row.destination_version, JSON.stringify(approximation));
    }
    database.query("insert into schema_migrations (migration_id) values (?)")
      .run("legacy_catalog_versions_v1");
  }).immediate();
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
