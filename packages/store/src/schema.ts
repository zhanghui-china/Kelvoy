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
  owner_id text not null,
  version integer not null default 1,
  doc text not null,
  updated_at text not null default (datetime('now'))
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
  created_at text not null default (datetime('now'))
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
  status text not null default 'pending',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
`;
