/** PR13: exercise backup, legacy migration, restart, and rollback on disposable SQLite files. */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { close, getEpisode, open } from "../packages/store/src/index";

const dir = mkdtempSync(join(tmpdir(), "kelvoy-pr13-rehearsal-"));
const source = join(dir, "legacy.db");
const backup = join(dir, "backup.db");
const candidate = join(dir, "candidate.db");
const restored = join(dir, "restored.db");
const tables = ["episodes", "personas", "destinations", "tasks", "users"] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function snapshot(db: Database): Record<string, number> {
  return Object.fromEntries(tables.map((table) => {
    const row = db.query<{ count: number }, []>(`select count(*) as count from ${table}`).get();
    return [table, row?.count ?? 0];
  }));
}

function integrity(db: Database): void {
  assert(db.query<{ integrity_check: string }, []>("pragma integrity_check").get()?.integrity_check === "ok", "SQLite integrity_check failed");
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyWithBackup(sourcePath: string, targetPath: string): void {
  const db = new Database(sourcePath, { readonly: true });
  try {
    // VACUUM INTO makes a consistent snapshot even if the source uses WAL.
    db.query("vacuum into ?").run(targetPath);
  } finally {
    db.close();
  }
}

try {
  // Deliberately old tables: missing task lease/operation fields, user settings,
  // nullable persona owner, and the version-history tables.
  const legacy = new Database(source, { create: true });
  legacy.exec(`
    create table episodes (episode_id text primary key, owner_id text not null,
      row_version integer not null default 1, doc text not null, updated_at text not null);
    create table personas (persona_id text primary key, owner_id text not null,
      version integer not null, doc text not null, updated_at text not null);
    create table destinations (destination_id text primary key, version integer not null,
      doc text not null, updated_at text not null);
    create table tasks (task_id text primary key, episode_id text not null, stage text not null,
      shot_no integer, attempt integer not null default 1, status text not null,
      created_at text not null, updated_at text not null);
    create table users (user_id text primary key, username text not null unique,
      password_hash text not null, created_at text not null);
  `);
  const oldEpisode = {
    episode_id: "legacy-episode", owner_id: "owner-a", persona_id: "persona-a",
    persona_version: 1, destination_id: "destination-a", destination_version: 1,
    mode: "grid", status: "done", render: { title: "旧作品" },
    brief: { season: "秋" }, share: { enabled: true, slug: "legacy-share" },
  };
  legacy.query("insert into episodes values (?, ?, 1, ?, datetime('now'))")
    .run(oldEpisode.episode_id, oldEpisode.owner_id, JSON.stringify(oldEpisode));
  legacy.query("insert into personas values (?, ?, 2, ?, datetime('now'))")
    .run("persona-a", "owner-a", JSON.stringify({ persona_id: "persona-a", version: 2, name: "当前角色" }));
  legacy.query("insert into destinations values (?, 2, ?, datetime('now'))")
    .run("destination-a", JSON.stringify({ destination_id: "destination-a", version: 2, name: "当前目的地" }));
  legacy.query("insert into tasks values (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
    .run("task-a", "legacy-episode", "video", 1, 1, "done");
  legacy.query("insert into users values (?, ?, ?, datetime('now'))").run("owner-a", "legacy", "hash");
  integrity(legacy);
  const before = snapshot(legacy);
  legacy.close();

  copyWithBackup(source, backup);
  copyWithBackup(backup, candidate);
  const sourceHash = digest(source);
  const backupHash = digest(backup);

  let migrated = open(candidate);
  integrity(migrated);
  assert(JSON.stringify(snapshot(migrated)) === JSON.stringify(before), "migration changed core row counts");
  const episode = await getEpisode("legacy-episode");
  assert(episode.ok && episode.episode.candidate_count === 2 &&
    episode.episode.brief.aspect === "9:16" && episode.episode.cut_policy === "beat_aligned",
  "legacy episode defaults did not decode");
  const approximation = migrated.query<{ count: number }, []>(
    "select count(*) as count from persona_versions where compatibility_approximation = 1",
  ).get()?.count;
  const destinationApproximation = migrated.query<{ count: number }, []>(
    "select count(*) as count from destination_versions where compatibility_approximation = 1",
  ).get()?.count;
  assert(approximation === 1 && destinationApproximation === 1, "missing legacy version warning snapshots");
  assert(migrated.query<{ count: number }, []>("select count(*) as count from schema_migrations").get()?.count === 1,
    "migration marker missing");
  close();
  migrated = open(candidate);
  integrity(migrated);
  assert(migrated.query<{ count: number }, []>("select count(*) as count from schema_migrations").get()?.count === 1,
    "migration reran on restart");
  assert(JSON.stringify(snapshot(migrated)) === JSON.stringify(before), "restart changed core row counts");
  close();

  // Rollback is rehearsed only before accepting writes on the migrated DB.
  copyWithBackup(backup, restored);
  const rollback = new Database(restored, { readonly: true });
  integrity(rollback);
  assert(JSON.stringify(snapshot(rollback)) === JSON.stringify(before), "rollback changed core row counts");
  assert(rollback.query<{ count: number }, []>(
    "select count(*) as count from sqlite_master where type = 'table' and name = 'schema_migrations'",
  ).get()?.count === 0, "rollback retained migrated schema");
  rollback.close();
  assert(digest(source) === sourceHash && digest(backup) === backupHash,
    "source or backup was modified during rehearsal");

  console.log(JSON.stringify({ result: "pass", fixture: "disposable legacy SQLite",
    core_rows_before_after: before, sqlite_integrity: "ok", legacy_defaults: "pass",
    approximate_catalog_versions: { persona: approximation, destination: destinationApproximation },
    restart_idempotence: "pass", rollback_before_new_writes: "pass",
    source_and_backup_unchanged: true }, null, 2));
} finally {
  close();
  rmSync(dir, { recursive: true, force: true });
}
