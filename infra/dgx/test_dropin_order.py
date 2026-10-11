"""systemd merges drop-ins in lexicographic filename order and the later file wins, so a new release's
drop-in must sort after every existing one regardless of the release name."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('web_worker_deploy', Path(__file__).with_name('deploy-web-worker.py'))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DropinOrderTests(unittest.TestCase):
    def names(self, existing, release):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for name in existing:
                (directory / name).write_text('[Service]\n')
            chosen = deployment.dropin_filename(directory, release)
            return sorted([*existing, chosen])[-1], chosen

    def test_new_dropin_sorts_last_even_when_release_name_is_alphabetically_earlier(self):
        existing = ['release.conf', 'zzzzzz-latest-20261010.conf', 'zzzzzzzzzz-music-20261011.conf',
                    'zzzzzzzzzz-rule-diag-20261011.conf', 'zzzzzzzzzz-share-projection-20261011.conf']
        last, chosen = self.names(existing, 'prompt-traces-20261011')
        self.assertEqual(last, chosen)
        self.assertTrue(chosen.endswith('-prompt-traces-20261011.conf'))

    def test_repeated_releases_keep_sorting_last(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for release in ('b-first', 'a-second', 'a-third', 'zz-fourth'):
                name = deployment.dropin_filename(directory, release)
                (directory / name).write_text('[Service]\n')
                self.assertEqual(sorted(path.name for path in directory.glob('*.conf'))[-1], name)

    def test_missing_directory_uses_the_current_convention(self):
        name = deployment.dropin_filename(Path('/nonexistent-dropin-dir-for-test'), 'x')
        self.assertEqual(name, 'zzzzzzzzzz-x.conf')


if __name__ == '__main__':
    unittest.main()
