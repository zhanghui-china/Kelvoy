"""Frontend build staleness stamp."""
import json
import tempfile
import unittest
from pathlib import Path

import dist_stamp


def make_release(root):
    root = Path(root)
    files = {
        'apps/web/index.html': '<html></html>',
        'apps/web/vite.config.ts': 'export default {}',
        'apps/web/package.json': '{}',
        'apps/web/src/frontend/app.tsx': 'export const a = 1',
        'apps/web/src/frontend/nested/panel.tsx': 'export const b = 1',
        'apps/web/src/frontend/app.test.tsx': 'test one',
        'apps/web/src/shared/types.ts': 'export type T = 1',
        'apps/web/dist/index.html': '<built/>',
        'RELEASE.json': json.dumps({'commit': 'abc1234', 'files': {}}),
    }
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return root


class DistStampTests(unittest.TestCase):
    def test_stamp_then_verify_passes_and_records_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            release = make_release(root)
            dist_stamp.stamp(release)
            dist_stamp.verify(release)
            data = json.loads((release / 'apps/web/dist/BUILD.json').read_text())
            self.assertEqual(data['commit'], 'abc1234')
            self.assertEqual(len(data['source_sha256']), 64)
            self.assertIn('built_at', data)

    def test_source_change_fails_verify(self):
        for name in ('apps/web/src/frontend/app.tsx', 'apps/web/src/frontend/nested/panel.tsx', 'apps/web/index.html',
                     'apps/web/vite.config.ts', 'apps/web/package.json', 'apps/web/src/shared/types.ts'):
            with self.subTest(name), tempfile.TemporaryDirectory() as root:
                release = make_release(root)
                dist_stamp.stamp(release)
                (release / name).write_text('changed')
                with self.assertRaises(RuntimeError):
                    dist_stamp.verify(release)

    def test_added_source_file_fails_verify(self):
        with tempfile.TemporaryDirectory() as root:
            release = make_release(root)
            dist_stamp.stamp(release)
            (release / 'apps/web/src/frontend/new.tsx').write_text('x')
            with self.assertRaises(RuntimeError):
                dist_stamp.verify(release)

    def test_test_files_do_not_affect_stamp(self):
        with tempfile.TemporaryDirectory() as root:
            release = make_release(root)
            dist_stamp.stamp(release)
            (release / 'apps/web/src/frontend/app.test.tsx').write_text('edited test')
            (release / 'apps/web/src/frontend/other.test.ts').write_text('new test')
            dist_stamp.verify(release)

    def test_missing_or_malformed_build_json_fails(self):
        with tempfile.TemporaryDirectory() as root:
            release = make_release(root)
            with self.assertRaises(RuntimeError):
                dist_stamp.verify(release)
            (release / 'apps/web/dist/BUILD.json').write_text('not json')
            with self.assertRaises(RuntimeError):
                dist_stamp.verify(release)

    def test_commit_is_optional(self):
        with tempfile.TemporaryDirectory() as root:
            release = make_release(root)
            (release / 'RELEASE.json').unlink()
            dist_stamp.stamp(release)
            dist_stamp.verify(release)
            self.assertIsNone(json.loads((release / 'apps/web/dist/BUILD.json').read_text())['commit'])


if __name__ == '__main__':
    unittest.main()
