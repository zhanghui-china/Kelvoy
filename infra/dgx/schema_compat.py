"""Additive-migration database comparison for release tooling (standard library only).

A release may add new tables/indexes (and their schema_migrations rows) but must not touch anything
that existed before. Both databases are opened read-only and compared directly; messages name tables,
indexes and migration ids only, never row content (rows are user data and must stay out of logs).

Row digests use the same scheme as deploy-video-timeout.database_snapshot (count + sha256 of the
sorted repr of every row), so a comparison with no allowances is equivalent to strict snapshot equality.
"""
import contextlib
import hashlib
import sqlite3

MIGRATIONS_TABLE = 'schema_migrations'
MIGRATION_KEY = 'migration_id'


def _connect(path):
    return sqlite3.connect(f'file:{path}?mode=ro', uri=True)


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _objects(connection):
    """{(type, name): (tbl_name, sql)} for every sqlite_master entry."""
    return {(kind, name): (table, sql) for kind, name, table, sql in connection.execute(
        'select type, name, tbl_name, sql from sqlite_master')}


def _migration_ids(connection):
    columns = [row[1] for row in connection.execute(f'pragma table_info({_quote(MIGRATIONS_TABLE)})')]
    if MIGRATION_KEY not in columns:
        return None
    return {row[0] for row in connection.execute(f'select {MIGRATION_KEY} from {_quote(MIGRATIONS_TABLE)}')}


def _table_digest(connection, table, skip_ids=frozenset()):
    """(count, sha256) of the table's rows, ignoring schema_migrations rows whose id is in skip_ids."""
    key_index = None
    if table == MIGRATIONS_TABLE and skip_ids:
        columns = [row[1] for row in connection.execute(f'pragma table_info({_quote(table)})')]
        key_index = columns.index(MIGRATION_KEY)
    records = []
    for row in connection.execute(f'select * from {_quote(table)}'):
        if key_index is not None and row[key_index] in skip_ids:
            continue
        records.append(repr(row))
    records.sort()
    return len(records), hashlib.sha256('\n'.join(records).encode()).hexdigest()


def diff_databases(before_path, after_path, *, new_tables=(), migration_ids=(), expect_empty_new_tables=False):
    """Returns (reasons, summary). `reasons` is empty when `after` is an allowed additive evolution of `before`."""
    new_tables, migration_ids = set(new_tables), set(migration_ids)
    reasons = []
    with contextlib.closing(_connect(before_path)) as before, contextlib.closing(_connect(after_path)) as after:
        if after.execute('pragma integrity_check').fetchone()[0] != 'ok':
            reasons.append('integrity_check failed on the resulting database')
        old_objects, new_objects = _objects(before), _objects(after)
        for key, value in old_objects.items():
            if key not in new_objects:
                reasons.append(f'existing {key[0]} {key[1]} was removed')
            elif new_objects[key] != value:
                reasons.append(f'existing {key[0]} {key[1]} definition changed')
        created_tables = {name for (kind, name) in new_objects.keys() - old_objects.keys() if kind == 'table'}
        created_indexes = []
        for kind, name in sorted(new_objects.keys() - old_objects.keys()):
            table = new_objects[(kind, name)][0]
            if kind == 'table':
                if name not in new_tables:
                    reasons.append(f'unexpected new table {name}')
            elif kind == 'index':
                if table in new_tables and table in created_tables:
                    created_indexes.append(name)
                else:
                    reasons.append(f'unexpected new index {name} on table {table}')
            else:
                reasons.append(f'unexpected new {kind} {name}')
        # Only ids that did not exist before and are explicitly allowed may be ignored in schema_migrations.
        old_ids, after_ids = _migration_ids(before), _migration_ids(after)
        added_ids = sorted((migration_ids & after_ids) - (old_ids or set())) if old_ids is not None and after_ids is not None else []
        for kind, name in sorted(old_objects):
            if kind != 'table' or (kind, name) not in new_objects:
                continue
            skip = frozenset(added_ids) if name == MIGRATIONS_TABLE else frozenset()
            try:
                old_digest = _table_digest(before, name)
                new_digest = _table_digest(after, name, skip)
            except sqlite3.Error:
                reasons.append(f'table {name} could not be read for comparison')
                continue
            if old_digest != new_digest:
                if new_digest[0] > old_digest[0]:
                    change = 'rows were added'
                elif new_digest[0] < old_digest[0]:
                    change = 'rows were removed'
                else:
                    change = 'rows were modified'
                suffix = ' (ids outside the allowed migrations)' if name == MIGRATIONS_TABLE and new_digest[0] > old_digest[0] else ''
                reasons.append(f'table {name}: {change}{suffix}')
        counts = {name: after.execute(f'select count(*) from {_quote(name)}').fetchone()[0] for name in sorted(created_tables & new_tables)}
        if expect_empty_new_tables:
            reasons += [f'new table {name} is expected to be empty but has {count} rows' for name, count in counts.items() if count]
    summary = {
        'new_tables': sorted(counts),
        'new_indexes': created_indexes,
        'new_migrations': added_ids,
        'new_table_counts': counts,
        'absent_new_tables': sorted(new_tables - set(counts)),
        'absent_migrations': sorted(migration_ids - set(added_ids) - (old_ids or set())),
    }
    return reasons, summary


def check_additive(before_path, after_path, **options):
    """Raises RuntimeError unless `after_path` only adds allowed tables/indexes/migration rows to `before_path`."""
    reasons, summary = diff_databases(before_path, after_path, **options)
    if reasons:
        raise RuntimeError('Database changed beyond the allowed additive migration: ' + '; '.join(reasons))
    return summary


def fingerprint(path):
    """Full-database fingerprint for idempotency checks: sqlite_master entries plus per-table digests."""
    with contextlib.closing(_connect(path)) as connection:
        tables = [name for (kind, name) in _objects(connection) if kind == 'table']
        return {
            'schema': sorted(f'{kind}\0{name}\0{table}\0{sql}' for (kind, name), (table, sql) in _objects(connection).items()),
            'tables': {name: _table_digest(connection, name) for name in sorted(tables)},
        }


def table_counts(path):
    with contextlib.closing(_connect(path)) as connection:
        return {name: connection.execute(f'select count(*) from {_quote(name)}').fetchone()[0]
                for (kind, name) in sorted(_objects(connection)) if kind == 'table'}
