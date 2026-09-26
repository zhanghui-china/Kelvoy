// ADR-0004: SQLite is the sole store (episodes, destinations, task queue).
// doc columns hold JSON as TEXT — bun:sqlite has no native JSON column
// type, and PRD v0.2 §6 always treated these as "one jsonb row" anyway.
export const SCHEMA = `
create table if not exists episodes (
  episode_id text primary key,
  owner_id text not null,
  row_version integer not null default 1,
  doc text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists destinations (
  destination_id text primary key,
  version integer not null,
  doc text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists personas (
  persona_id text primary key,
  owner_id text,
  version integer not null default 1,
  doc text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists persona_versions (
  persona_id text not null,
  version integer not null,
  doc text not null,
  compatibility_approximation integer not null default 0,
  primary key (persona_id, version)
);

create table if not exists templates (
  template_id text primary key,
  owner_id text,
  doc text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists users (
  user_id text primary key,
  username text not null unique,
  password_hash text not null,
  created_at text not null default (datetime('now')),
  settings text not null default '{}'
);

create table if not exists sessions (
  session_id text primary key,
  user_id text not null,
  expires_at text not null
);

create table if not exists tasks (
  task_id text primary key,
  episode_id text not null,
  stage text not null,
  shot_no integer,
  attempt integer not null default 1,
  operation text,
  instruction text,
  lease_until integer,
  lease_token text,
  status text not null default 'pending',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists credit_accounts (
  user_id text primary key,
  available integer not null default 0 check (available >= 0),
  reserved integer not null default 0 check (reserved >= 0)
);

create table if not exists credit_actions (
  action_id text primary key,
  user_id text not null,
  episode_id text,
  task_id text,
  kind text not null,
  units integer not null check (units > 0),
  price integer not null check (price >= 0),
  status text not null check (status in ('reserved', 'settled', 'released')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists credit_ledger (
  entry_id text primary key,
  user_id text not null,
  action_id text not null,
  kind text not null,
  available_delta integer not null,
  reserved_delta integer not null,
  created_at text not null default (datetime('now')),
  unique (action_id, kind)
);

create table if not exists credit_prices (
  kind text primary key,
  price integer not null check (price >= 0)
);

insert or ignore into credit_prices (kind, price) values
  ('script', 1), ('image', 1), ('video', 10), ('compose', 1);
`;

/**
 * 已有库的补列（M2-15 给 users 加了 settings）。SQLite 没有
 * "add column if not exists"，而上面的 `create table if not exists` 对已经
 * 建好的 data/kelvoy.db 不起作用——新列只能靠这里补。按列名判断，重复运行
 * 无副作用（每次 open() 都会跑一遍）。
 */
export const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "tasks", column: "operation", ddl: "alter table tasks add column operation text" },
  { table: "tasks", column: "instruction", ddl: "alter table tasks add column instruction text" },
  { table: "tasks", column: "lease_until", ddl: "alter table tasks add column lease_until integer" },
  { table: "tasks", column: "lease_token", ddl: "alter table tasks add column lease_token text" },
  {
    table: "users",
    column: "settings",
    ddl: "alter table users add column settings text not null default '{}'",
  },
];
