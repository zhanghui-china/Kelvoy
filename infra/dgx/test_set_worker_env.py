"""set-worker-env edits one KEY=VALUE line of a protected env file; it must keep every other line byte for
byte, never print values, and keep the file's permission bits."""
import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('set_worker_env', Path(__file__).with_name('set-worker-env.py'))
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class EditTests(unittest.TestCase):
    def test_adds_missing_key_and_keeps_other_lines(self):
        text = '# comment\nSTEPFUN_API_KEY=secret-value\nKELVOY_X=1\n'
        self.assertEqual(tool.set_env_value(text, 'STEPFUN_MODEL', 'step-5-preview'),
                         '# comment\nSTEPFUN_API_KEY=secret-value\nKELVOY_X=1\nSTEPFUN_MODEL=step-5-preview\n')

    def test_replaces_existing_key_once(self):
        text = 'A=1\nSTEPFUN_MODEL=step-3.5-flash\nB=2\n'
        self.assertEqual(tool.set_env_value(text, 'STEPFUN_MODEL', 'step-5-preview'),
                         'A=1\nSTEPFUN_MODEL=step-5-preview\nB=2\n')

    def test_adds_newline_when_file_lacks_trailing_newline(self):
        self.assertEqual(tool.set_env_value('A=1', 'K', 'v'), 'A=1\nK=v\n')

    def test_does_not_touch_similarly_named_keys(self):
        text = 'XSTEPFUN_MODEL=a\nSTEPFUN_MODEL_EXTRA=b\n'
        self.assertEqual(tool.set_env_value(text, 'STEPFUN_MODEL', 'm'), text + 'STEPFUN_MODEL=m\n')

    def test_rejects_values_that_could_inject_lines(self):
        for bad in ('a\nB=2', 'a b', '', 'a"b'):
            with self.assertRaises(ValueError):
                tool.set_env_value('A=1\n', 'K', bad)

    def test_file_edit_keeps_mode_and_writes_backup_with_same_mode(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'worker.env'
            path.write_text('STEPFUN_API_KEY=secret-value\n')
            os.chmod(path, 0o600)
            backup = tool.edit_env_file(path, 'STEPFUN_MODEL', 'step-5-preview')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
            self.assertEqual(backup.read_text(), 'STEPFUN_API_KEY=secret-value\n')
            self.assertIn('STEPFUN_MODEL=step-5-preview\n', path.read_text())

    def test_noop_when_value_already_set(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'worker.env'
            path.write_text('STEPFUN_MODEL=step-5-preview\n')
            self.assertIsNone(tool.edit_env_file(path, 'STEPFUN_MODEL', 'step-5-preview'))


if __name__ == '__main__':
    unittest.main()
