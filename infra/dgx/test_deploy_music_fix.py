"""Deployment must wait for cancelled executions to actually exit."""
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('music_deployment', Path(__file__).with_name('deploy-music-fix.py'))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DrainTests(unittest.TestCase):
    def test_cancelled_execution_blocks_drain_until_exit_or_lease_expiry(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'test.db'
            with sqlite3.connect(path) as database:
                database.executescript("create table tasks(status text); create table task_executions(exited integer, lease_until integer); insert into tasks values('cancelled'); insert into task_executions values(0, unixepoch('now') + 90);")
                self.assertTrue(deployment.has_live_work(path))
                database.execute('update task_executions set exited=1')
                database.commit()
                self.assertFalse(deployment.has_live_work(path))
                database.execute("update task_executions set exited=0,lease_until=unixepoch('now')-1")
                database.commit()
                self.assertFalse(deployment.has_live_work(path))
                database.execute("insert into tasks values('pending')")
                database.commit()
                self.assertTrue(deployment.has_live_work(path))


if __name__ == '__main__':
    unittest.main()
