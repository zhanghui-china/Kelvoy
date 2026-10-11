// ADR-0004: SQLite is the sole store (episodes, destinations, task queue).
// doc columns hold JSON as TEXT — bun:sqlite has no native JSON column
// type, and PRD v0.2 §6 always treated these as "one jsonb row" anyway.
export const SCHEMA = `
create table if not exists system_config (
  id integer primary key check (id = 1),
  version integer not null default 1,
  comfyui_base_url text,
  bridge_base_url text,
  updated_by text,
  updated_at text
);
insert or ignore into system_config (id) values (1);

create table if not exists episodes (
  episode_id text primary key,
  owner_id text not null,
  row_version integer not null default 1,
  doc text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists episode_deletions (
  episode_id text primary key, owner_id text not null,
  deleted_at text not null default (datetime('now')),
  usage_json text not null,
  cleanup_status text not null default 'pending',
  cleanup_attempts integer not null default 0,
  cleanup_revision integer not null default 0,
  cleanup_retry_at integer not null default 0
);
create table if not exists task_executions (
  task_id text not null, lease_token text not null, episode_id text not null,
  lease_until integer not null, exited integer not null default 0,
  primary key (task_id, lease_token)
);
create index if not exists idx_task_executions_episode on task_executions(episode_id, exited, lease_until);

create table if not exists destinations (
  destination_id text primary key,
  version integer not null,
  doc text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists destination_drafts (
  draft_id text primary key, creator_id text not null, edit_version integer not null,
  destination_id text, base_version integer, content text not null, published_version integer
);
create index if not exists idx_destination_drafts_creator on destination_drafts(creator_id);

create table if not exists destination_versions (
  destination_id text not null,
  version integer not null,
  doc text not null,
  compatibility_approximation integer not null default 0,
  primary key (destination_id, version)
);

create table if not exists schema_migrations (
  migration_id text primary key,
  applied_at text not null default (datetime('now'))
);

create table if not exists personas (
  deleted_at text,
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
  shot_id text,
  payload_json text,
  result_json text,
  error text,
  attempt integer not null default 1,
  operation text,
  instruction text,
  generation_id text,
  lease_until integer,
  lease_token text,
  status text not null default 'pending',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create trigger if not exists prevent_deleted_episode_task_insert before insert on tasks
when exists (select 1 from episode_deletions where episode_id = new.episode_id)
begin select raise(abort, 'episode deleted'); end;
create trigger if not exists prevent_deleted_episode_insert before insert on episodes
when exists (select 1 from episode_deletions where episode_id = new.episode_id)
begin select raise(abort, 'episode deleted'); end;

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

-- ADR-0012：作品所有者可见的提示词记录，只追加。owner_id 在写入时由 episodes 行取得。
-- 索引不能显式列 rowid（SQLite 报 no such column）；rowid 本就隐式追加在每个索引末尾，等价于 ADR 的 (…, rowid)。
create table if not exists prompt_traces (
  task_id text not null, attempt integer not null, seq integer not null,
  episode_id text not null, owner_id text not null,
  kind text not null check (kind in ('script_generate','script_revision','h3_rewrite')),
  shot_id text, round integer,
  source text not null check (source in ('llm','cache')),
  outcome text not null, rule text,
  model text, skill_version text, writer_version text, h3_mode text,
  user_message text not null, correction_message text, final_prompt text,
  input_hash text, truncated integer not null default 0,
  created_at text not null default (datetime('now')),
  primary key (task_id, attempt, seq)
);
create index if not exists idx_prompt_traces_episode on prompt_traces(episode_id, kind, shot_id);

-- ADR-0012 补充（prompt_traces_v2）：校验失败时被拒绝的模型原文。独立加性新表，不给已有的
-- prompt_traces 加列（部署闸门只放行新表）；与主表同主键，读取时左连接。
create table if not exists prompt_trace_rejections (
  task_id text not null, attempt integer not null, seq integer not null,
  episode_id text not null, owner_id text not null,
  rejected_output text not null, truncated integer not null default 0,
  created_at text not null default (datetime('now')),
  primary key (task_id, attempt, seq)
);
create index if not exists idx_prompt_trace_rejections_episode on prompt_trace_rejections(episode_id);
`;

/**
 * 已有库的补列（M2-15 给 users 加了 settings）。SQLite 没有
 * "add column if not exists"，而上面的 `create table if not exists` 对已经
 * 建好的 data/kelvoy.db 不起作用——新列只能靠这里补。按列名判断，重复运行
 * 无副作用（每次 open() 都会跑一遍）。
 */
export const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  ...["shot_id", "payload_json", "result_json", "error"].map(column => ({ table: "tasks", column, ddl: `alter table tasks add column ${column} text` })),
  { table: "personas", column: "deleted_at", ddl: "alter table personas add column deleted_at text" },
  { table: "tasks", column: "operation", ddl: "alter table tasks add column operation text" },
  { table: "tasks", column: "instruction", ddl: "alter table tasks add column instruction text" },
  { table: "tasks", column: "generation_id", ddl: "alter table tasks add column generation_id text" },
  { table: "tasks", column: "lease_until", ddl: "alter table tasks add column lease_until integer" },
  { table: "tasks", column: "lease_token", ddl: "alter table tasks add column lease_token text" },
  { table: "episode_deletions", column: "cleanup_last_error", ddl: "alter table episode_deletions add column cleanup_last_error text" },
  { table: "episode_deletions", column: "cleanup_revision", ddl: "alter table episode_deletions add column cleanup_revision integer not null default 0" },
  {
    table: "users",
    column: "settings",
    ddl: "alter table users add column settings text not null default '{}'",
  },
];
