"""Rehearse an additive store migration on a throwaway copy of the production database.

The source database is only ever opened read-only (sqlite backup API). The copy is migrated by running
the release's own `@kelvoy/store` open() twice (idempotency), then compared with the pristine copy via
schema_compat. Prints one JSON line; exit code is non-zero on any failure. Never touches the source.
"""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_compat  # noqa: E402

# Path comes from the environment, never argv/default: if it were missing, open() would fall back to
# data/kelvoy.db under the release directory. Fail closed instead.
BUN_SCRIPT = (
    'import { open, close } from "@kelvoy/store";'
    'const path = process.env.REHEARSAL_DB;'
    'if (!path) throw new Error("REHEARSAL_DB missing");'
    'open(path); close();'
)


def find_bun():
    return shutil.which('bun') or str(Path.home() / '.bun/bin/bun')


def run_store_open(release, database):
    """Runs the release store open() against `database`. cwd is apps/worker: bun links workspace packages
    per package (apps/*/node_modules/@kelvoy/*), not at the repo root, and Worker is the real consumer."""
    scratch = Path(database).parent
    environment = dict(os.environ, REHEARSAL_DB=str(database), KELVOY_DB_PATH=str(database),
                       KELVOY_PROJECTS_ROOT=str(scratch / 'projects-unused'))
    result = subprocess.run([find_bun(), '-e', BUN_SCRIPT], cwd=Path(release) / 'apps/worker', env=environment,
                            capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        # stderr is store/bun diagnostics on a throwaway copy; keep only its tail.
        raise RuntimeError('store open() failed on the rehearsal copy: ' + result.stderr.strip()[-500:])


def copy_database(source, target):
    origin = sqlite3.connect(f'file:{source}?mode=ro', uri=True)
    destination = sqlite3.connect(target)
    try:
        origin.backup(destination)
    finally:
        destination.close()
        origin.close()


def rehearse(database, release, *, new_tables=(), migration_ids=(), expect_empty_new_tables=False,
             runner=run_store_open, passes=2):
    database, release = Path(database).resolve(strict=True), Path(release).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='kelvoy-rehearsal-') as scratch:
        scratch = Path(scratch)
        pristine, migrated = scratch / 'pristine.db', scratch / 'migrated.db'
        copy_database(database, pristine)
        copy_database(pristine, migrated)
        fingerprints = []
        for _ in range(passes):
            runner(release, migrated)
            fingerprints.append(schema_compat.fingerprint(migrated))
        if any(item != fingerprints[0] for item in fingerprints[1:]):
            raise RuntimeError('Migration is not idempotent: a repeated open() changed the database')
        summary = schema_compat.check_additive(
            pristine, migrated, new_tables=new_tables, migration_ids=migration_ids,
            expect_empty_new_tables=expect_empty_new_tables)
        if summary['absent_new_tables']:
            raise RuntimeError('Expected new tables missing after migration: ' + ', '.join(summary['absent_new_tables']))
        if summary['absent_migrations']:
            raise RuntimeError('Expected migration ids missing after migration: ' + ', '.join(summary['absent_migrations']))
        return {'status': 'ok', 'passes': passes, 'tables': schema_compat.table_counts(migrated), **{
            key: summary[key] for key in ('new_tables', 'new_indexes', 'new_migrations')}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--allow-new-table', action='append', default=[])
    parser.add_argument('--allow-migration', action='append', default=[])
    parser.add_argument('--expect-empty-new-table', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(rehearse(args.database, args.release, new_tables=args.allow_new_table,
                                  migration_ids=args.allow_migration,
                                  expect_empty_new_tables=args.expect_empty_new_table)))
    except (RuntimeError, OSError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}))
        sys.exit(1)
