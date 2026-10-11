"""Additive-migration database comparison used by deploy-web-worker.py and rehearse-migration.py."""
import hashlib
import importlib.util
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

import schema_compat

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SENTINEL = 'SENTINEL-user-data-7f3a'

spec = importlib.util.spec_from_file_location('rehearse_migration', HERE / 'rehearse-migration.py')
rehearse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearse)

OLD_SCHEMA = """
create table schema_migrations (migration_id text primary key, applied_at text not null default (datetime('now')));
create table episodes (episode_id text primary key, doc text not null);
create index idx_episodes_doc on episodes(doc);
insert into schema_migrations (migration_id) values ('episode_deletions_v1');
insert into episodes values ('e1', 'doc one'), ('e2', 'doc two');
"""
NEW_TABLE = "create table prompt_traces (task_id text not null, episode_id text not null, primary key (task_id))"
NEW_INDEX = "create index idx_prompt_traces_episode on prompt_traces(episode_id)"


def make_old_database(path):
    connection = sqlite3.connect(path)
    connection.executescript(OLD_SCHEMA)
    connection.commit()
    connection.close()


def make_pair(root, mutate=None):
    """Returns (before, after) paths; `mutate(connection)` is applied to the after copy."""
    before, after = Path(root) / 'before.db', Path(root) / 'after.db'
    make_old_database(before)
    shutil.copy(before, after)
    if mutate:
        connection = sqlite3.connect(after)
        mutate(connection)
        connection.commit()
        connection.close()
    return before, after


def additive(connection):
    connection.execute(NEW_TABLE)
    connection.execute(NEW_INDEX)
    connection.execute("insert into schema_migrations (migration_id) values ('prompt_traces_v1')")


ALLOW = dict(new_tables=('prompt_traces',), migration_ids=('prompt_traces_v1',))


class CompatTests(unittest.TestCase):
    def check(self, mutate, **options):
        with tempfile.TemporaryDirectory() as root:
            before, after = make_pair(root, mutate)
            return schema_compat.check_additive(before, after, **options)

    def assertIncompatible(self, mutate, expected=None, **options):
        with self.assertRaises(RuntimeError) as context:
            self.check(mutate, **options)
        if expected:
            self.assertIn(expected, str(context.exception))
        return str(context.exception)

    def test_01_additive_table_index_and_migration_row_is_compatible(self):
        result = self.check(additive, **ALLOW)
        self.assertEqual(result['new_tables'], ['prompt_traces'])
        self.assertIn('idx_prompt_traces_episode', result['new_indexes'])
        self.assertEqual(result['new_migrations'], ['prompt_traces_v1'])
        self.assertEqual(result['new_table_counts'], {'prompt_traces': 0})

    def test_02_objects_outside_allow_list_are_incompatible(self):
        def other_table(connection):
            additive(connection)
            connection.execute("create table surprise (x text)")
        self.assertIncompatible(other_table, 'surprise', **ALLOW)

        def extra_index_on_allowed_table(connection):
            additive(connection)
            connection.execute("create index idx_extra on prompt_traces(task_id)")
        # By design: the allow-list is per table, so extra indexes on an allowed new table are fine.
        self.check(extra_index_on_allowed_table, **ALLOW)

        def index_on_original_table(connection):
            additive(connection)
            connection.execute("create index idx_new_on_old on episodes(episode_id)")
        self.assertIncompatible(index_on_original_table, 'idx_new_on_old', **ALLOW)

    def test_03_row_changes_in_original_tables_are_incompatible(self):
        def update(connection):
            additive(connection)
            connection.execute("update episodes set doc='x' where episode_id='e1'")

        def insert(connection):
            additive(connection)
            connection.execute("insert into episodes values ('e3','d')")

        def delete(connection):
            additive(connection)
            connection.execute("delete from episodes where episode_id='e2'")
        for mutate in (update, insert, delete):
            self.assertIncompatible(mutate, 'episodes', **ALLOW)

    def test_03b_schema_migrations_only_allowed_ids_may_be_added(self):
        def extra_id(connection):
            additive(connection)
            connection.execute("insert into schema_migrations (migration_id) values ('rogue_v1')")
        self.assertIncompatible(extra_id, 'schema_migrations', **ALLOW)

        def also_changed(connection):
            additive(connection)
            connection.execute("update episodes set doc='x'")
        self.assertIncompatible(also_changed, 'episodes', **ALLOW)

        def existing_row_removed(connection):
            additive(connection)
            connection.execute("delete from schema_migrations where migration_id='episode_deletions_v1'")
        self.assertIncompatible(existing_row_removed, 'schema_migrations', **ALLOW)

        def existing_row_modified(connection):
            additive(connection)
            connection.execute("update schema_migrations set applied_at='1999-01-01' where migration_id='episode_deletions_v1'")
        self.assertIncompatible(existing_row_modified, 'schema_migrations', **ALLOW)

    def test_04_ddl_change_or_table_drop_is_incompatible(self):
        def altered(connection):
            additive(connection)
            connection.execute("alter table episodes add column extra text")
        self.assertIncompatible(altered, 'episodes', **ALLOW)

        def index_redefined(connection):
            additive(connection)
            connection.execute("drop index idx_episodes_doc")
            connection.execute("create index idx_episodes_doc on episodes(episode_id)")
        self.assertIncompatible(index_redefined, 'idx_episodes_doc', **ALLOW)

        def dropped(connection):
            additive(connection)
            connection.execute("drop table episodes")
        self.assertIncompatible(dropped, 'episodes', **ALLOW)

    def test_05_no_allowances_means_strict_equality(self):
        self.check(None)
        self.assertIncompatible(additive, 'prompt_traces')
        self.assertIncompatible(lambda c: c.execute("insert into schema_migrations (migration_id) values ('prompt_traces_v1')"), 'schema_migrations')
        self.assertIncompatible(lambda c: c.execute("update episodes set doc='x' where episode_id='e1'"), 'episodes')

    def test_06_expect_empty_new_table(self):
        def populated(connection):
            additive(connection)
            connection.execute("insert into prompt_traces values ('t1', 'e1')")
        self.check(populated, **ALLOW)
        self.assertIncompatible(populated, 'prompt_traces', expect_empty_new_tables=True, **ALLOW)
        self.check(additive, expect_empty_new_tables=True, **ALLOW)

    def test_07_error_messages_do_not_contain_row_content(self):
        def poisoned(connection):
            additive(connection)
            connection.execute("update episodes set doc=? where episode_id='e1'", (SENTINEL,))
            connection.execute("insert into episodes values (?, ?)", (SENTINEL + '-id', SENTINEL))
            connection.execute("insert into prompt_traces values (?, ?)", (SENTINEL, SENTINEL))
        for options in (ALLOW, dict(expect_empty_new_tables=True, **ALLOW)):
            message = self.assertIncompatible(poisoned, None, **options)
            self.assertNotIn(SENTINEL, message)

    def test_08_absent_allowed_names_are_reported_not_failed(self):
        result = self.check(None, **ALLOW)
        self.assertEqual(result['absent_new_tables'], ['prompt_traces'])
        self.assertEqual(result['absent_migrations'], ['prompt_traces_v1'])


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def fake_runner(self, release, database):
        self.calls.append(database)
        connection = sqlite3.connect(database)
        connection.execute("create table if not exists prompt_traces (task_id text not null, episode_id text not null, primary key (task_id))")
        connection.execute("create index if not exists idx_prompt_traces_episode on prompt_traces(episode_id)")
        connection.execute("insert or ignore into schema_migrations (migration_id) values ('prompt_traces_v1')")
        connection.commit()
        connection.close()

    def source(self, root):
        path = Path(root) / 'live.db'
        make_old_database(path)
        return path

    def test_09_rehearsal_passes_and_leaves_source_untouched(self):
        with tempfile.TemporaryDirectory() as root:
            source = self.source(root)
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            result = rehearse.rehearse(source, Path(root), runner=self.fake_runner, **ALLOW)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            self.assertEqual(result['status'], 'ok')
            self.assertEqual(result['new_tables'], ['prompt_traces'])
            self.assertEqual(result['passes'], 2)
            self.assertEqual(len(self.calls), 2)
            self.assertEqual(result['tables']['episodes'], 2)
            self.assertTrue(all(Path(call) != source for call in self.calls))
            self.assertFalse(any(Path(call).exists() for call in self.calls))

    def test_10_rehearsal_fails_when_runner_mutates_existing_rows(self):
        def bad(release, database):
            self.fake_runner(release, database)
            connection = sqlite3.connect(database)
            connection.execute("update episodes set doc='x'")
            connection.commit()
            connection.close()
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(RuntimeError):
                rehearse.rehearse(self.source(root), Path(root), runner=bad, **ALLOW)

    def test_11_rehearsal_fails_when_new_table_missing(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(RuntimeError) as context:
                rehearse.rehearse(self.source(root), Path(root), runner=lambda release, database: None, **ALLOW)
            self.assertIn('prompt_traces', str(context.exception))

    def test_12_rehearsal_detects_non_idempotent_runner(self):
        def counter(release, database):
            self.fake_runner(release, database)
            connection = sqlite3.connect(database)
            connection.execute("insert into prompt_traces values (?, 'e1')", (f't{len(self.calls)}',))
            connection.commit()
            connection.close()
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(RuntimeError) as context:
                rehearse.rehearse(self.source(root), Path(root), runner=counter, **ALLOW)
            self.assertIn('idempot', str(context.exception))


@unittest.skipUnless(shutil.which('bun') and (REPO / 'apps/worker/node_modules/@kelvoy/store').exists(), 'bun or installed workspace missing')
class BunIntegrationTests(unittest.TestCase):
    def test_13_real_store_open_adds_prompt_traces_only(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'live.db'
            # Build an "old" database with the real current store, then strip the ADR-0012 additions.
            rehearse.run_store_open(REPO, source)
            connection = sqlite3.connect(source)
            connection.execute("drop table prompt_traces")
            connection.execute("delete from schema_migrations where migration_id='prompt_traces_v1'")
            connection.commit()
            connection.execute("pragma journal_mode=delete")
            connection.close()
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            result = rehearse.rehearse(source, REPO, expect_empty_new_tables=True, **ALLOW)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            self.assertEqual(result['new_tables'], ['prompt_traces'])
            self.assertIn('idx_prompt_traces_episode', result['new_indexes'])
            self.assertEqual(result['new_migrations'], ['prompt_traces_v1'])


if __name__ == '__main__':
    unittest.main()
