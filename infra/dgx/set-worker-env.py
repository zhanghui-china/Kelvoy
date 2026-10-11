"""Set one KEY=VALUE in the Worker's protected env file and restart the Worker without cutting off work.

Order: freeze Web admission, wait until no task is pending/processing and no live execution lease remains
(bounded), stop the Worker, back up the env file, edit one line, start the Worker, start Web. Never prints
env values. If draining times out nothing is changed and Web is started again.

Used for configuration-only changes such as STEPFUN_MODEL; code releases use deploy-web-worker.py.
"""
import argparse
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

VALUE_PATTERN = re.compile(r'^[A-Za-z0-9._:/@+-]+$')


def set_env_value(text, key, value):
    """Return `text` with `key` set to `value`; every other line is kept byte for byte."""
    if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or not VALUE_PATTERN.match(value):
        raise ValueError('unsafe env key or value')
    lines = text.splitlines(keepends=True)
    out, found = [], False
    for line in lines:
        if re.match(rf'^{re.escape(key)}=', line):
            if not found:
                out.append(f'{key}={value}\n')
            found = True
            continue
        out.append(line)
    if not found:
        if out and not out[-1].endswith('\n'):
            out[-1] += '\n'
        out.append(f'{key}={value}\n')
    return ''.join(out)


def edit_env_file(path, key, value):
    """Edit in place keeping the permission bits. Returns the backup path, or None when already set."""
    path = Path(path)
    original = path.read_text()
    updated = set_env_value(original, key, value)
    if updated == original:
        return None
    mode = path.stat().st_mode & 0o777
    backup = path.with_name(f'{path.name}.before-{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'w') as stream:
        stream.write(original)
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, 'w') as stream:
        stream.write(updated)
    os.replace(temporary, path)
    os.chmod(path, mode)
    return backup


def has_live_work(database):
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection:
        if connection.execute("select 1 from tasks where status in ('pending','processing') limit 1").fetchone():
            return True
        return connection.execute(
            "select 1 from task_executions where exited=0 and lease_until>unixepoch('now') limit 1").fetchone() is not None


def systemctl(*args):
    return subprocess.run(['systemctl', '--user', *args], check=True, capture_output=True, text=True).stdout


def live_has(service, key, value):
    pid = int(systemctl('show', service, '-p', 'MainPID', '--value').strip() or 0)
    if not pid:
        return False
    for item in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0'):
        if item == f'{key}={value}'.encode():
            return True
    return False


def apply(env_file, key, value, database, timeout=1000):
    web_was_active = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', 'kelvoy-web']).returncode == 0
    systemctl('stop', 'kelvoy-web')
    try:
        deadline = time.monotonic() + timeout
        while has_live_work(database):
            if time.monotonic() > deadline:
                raise RuntimeError('Task drain incomplete; nothing changed')
            time.sleep(2)
        systemctl('stop', 'kelvoy-worker')
        try:
            backup = edit_env_file(env_file, key, value)
        finally:
            systemctl('start', 'kelvoy-worker')
        time.sleep(2)
        if not live_has('kelvoy-worker', key, value):
            raise RuntimeError('Worker did not pick up the new value')
        return {'changed': backup is not None, 'backup': str(backup) if backup else None}
    finally:
        if web_was_active:
            systemctl('start', 'kelvoy-web')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--key', required=True)
    parser.add_argument('--value', required=True)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--drain-timeout', type=int, default=1000)
    args = parser.parse_args()
    result = apply(args.env_file, args.key, args.value, args.database, args.drain_timeout)
    print(result)
    sys.exit(0)
