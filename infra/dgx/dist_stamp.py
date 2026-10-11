"""Frontend build staleness stamp: `stamp` after the build, `verify` before a release is switched.

CLI: python3 dist_stamp.py stamp|verify RELEASE_DIR

The stamp hashes the frontend SOURCE inputs only. It cannot prove that apps/web/dist was actually
produced from them (that would mean rebuilding and diffing, and Vite output is not byte-reproducible
across hosts/versions). What it does catch is the common failure: sources changed after the last
build, or a release shipped with a dist built from a different tree. Run `stamp` right after build.
"""
import hashlib
import json
import sys
import time
from pathlib import Path

WEB = 'apps/web'
STAMP = f'{WEB}/dist/BUILD.json'
SINGLE_FILES = (f'{WEB}/index.html', f'{WEB}/vite.config.ts', f'{WEB}/package.json')
TREES = (f'{WEB}/src/frontend', f'{WEB}/src/shared')


def source_files(release):
    release = Path(release)
    found = {}
    for name in SINGLE_FILES:
        if (release / name).is_file():
            found[name] = release / name
    for tree in TREES:
        for path in (release / tree).rglob('*'):
            if path.is_file() and '.test.' not in path.name:
                found[path.relative_to(release).as_posix()] = path
    return found


def source_digest(release):
    files = source_files(release)
    if not any(name.startswith(f'{WEB}/src/frontend/') for name in files):
        raise RuntimeError('No frontend sources found to stamp')
    entries = [[name, hashlib.sha256(files[name].read_bytes()).hexdigest()] for name in sorted(files)]
    return hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()


def _commit(release):
    try:
        return json.loads((Path(release) / 'RELEASE.json').read_text()).get('commit')
    except (OSError, ValueError, AttributeError):
        return None


def stamp(release):
    release = Path(release)
    data = {
        'source_sha256': source_digest(release),
        'built_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'commit': _commit(release),
    }
    (release / STAMP).parent.mkdir(parents=True, exist_ok=True)
    (release / STAMP).write_text(json.dumps(data, indent=2) + '\n')
    return data


def verify(release):
    release = Path(release)
    try:
        recorded = json.loads((release / STAMP).read_text())['source_sha256']
    except (OSError, ValueError, KeyError, TypeError):
        raise RuntimeError('Frontend build stamp missing or unreadable; run dist_stamp.py stamp after the build') from None
    if recorded != source_digest(release):
        raise RuntimeError('Frontend build is stale: sources changed after the build stamp')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('stamp', 'verify'):
        sys.exit('usage: dist_stamp.py stamp|verify RELEASE_DIR')
    result = stamp(sys.argv[2]) if sys.argv[1] == 'stamp' else verify(sys.argv[2])
    print(json.dumps(result or {'status': 'ok'}))
