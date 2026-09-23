-- ADR-0003: whole-record jsonb storage, no ORM.
create table if not exists destinations (
  destination_id text primary key,
  version integer not null,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);
