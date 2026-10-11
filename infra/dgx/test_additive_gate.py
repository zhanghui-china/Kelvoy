"""The additive-migration gate must actually apply the release's store migration while services are stopped and
fail when the expected objects are missing: Web opens the database lazily, so checking after a Web start can
pass vacuously (found in the prompt-traces release)."""
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('web_worker_deploy', Path(__file__).with_name('deploy-web-worker.py'))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


def make_database(path):
    with sqlite3.connect(path) as db:
        db.executescript("create table schema_migrations(migration_id text primary key);"
                         "insert into schema_migrations values('base_v1');"
                         "create table episodes(episode_id text primary key); insert into episodes values('e1');")


class GateTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.live = Path(self.root.name) / 'live.db'
        self.backup = Path(self.root.name) / 'backup.db'
        make_database(self.live)
        make_database(self.backup)
        self.options = dict(new_tables=['prompt_traces'], migration_ids=['prompt_traces_v1'], expect_empty_new_tables=True)

    def tearDown(self):
        self.root.cleanup()

    def gate(self, runner):
        return deployment.apply_additive_migration(Path('/release'), self.live, self.backup, runner=runner, **self.options)

    def test_applies_migration_and_reports_new_objects(self):
        def runner(release, database):
            with sqlite3.connect(database) as db:
                db.execute('create table prompt_traces(task_id text)')
                db.execute("insert into schema_migrations values('prompt_traces_v1')")
        summary = self.gate(runner)
        self.assertEqual(summary['new_tables'], ['prompt_traces'])
        self.assertEqual(summary['new_migrations'], ['prompt_traces_v1'])

    def test_vacuous_pass_is_a_failure_when_expected_objects_are_missing(self):
        with self.assertRaises(RuntimeError) as caught:
            self.gate(lambda release, database: None)
        self.assertIn('prompt_traces', str(caught.exception))

    def test_unexpected_table_or_changed_rows_fail(self):
        def extra(release, database):
            with sqlite3.connect(database) as db:
                db.execute('create table prompt_traces(task_id text)')
                db.execute("insert into schema_migrations values('prompt_traces_v1')")
                db.execute('create table surprise(a)')
        with self.assertRaises(RuntimeError):
            self.gate(extra)

        def tamper(release, database):
            with sqlite3.connect(database) as db:
                db.execute('create table prompt_traces(task_id text)')
                db.execute("insert into schema_migrations values('prompt_traces_v1')")
                db.execute("update episodes set episode_id='changed'")
        self.setUp()
        with self.assertRaises(RuntimeError):
            self.gate(tamper)


if __name__ == '__main__':
    unittest.main()
