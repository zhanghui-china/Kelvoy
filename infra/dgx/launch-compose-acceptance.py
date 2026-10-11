"""Launch isolated composition checks with no inherited provider credentials."""
import os
import subprocess
import sys
from pathlib import Path

kind, release, fixture = sys.argv[1:]
release, fixture = Path(release).resolve(strict=True), Path(fixture).resolve(strict=True)
pid = subprocess.check_output(['systemctl', '--user', 'show', 'kelvoy-worker', '-p', 'MainPID', '--value'], text=True).strip()
live = {}
if pid != '0':
    for item in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0'):
        if b'=' in item:
            key, value = item.split(b'=', 1)
            live[key.decode()] = value.decode()
environment = {key: value for key, value in os.environ.items() if key in ('HOME', 'USER', 'LANG', 'XDG_RUNTIME_DIR')}
environment.update({
    'PATH': live.get('PATH', os.defpath),
    'KELVOY_DB_PATH': str(fixture / 'acceptance.db'),
    'KELVOY_PROJECTS_ROOT': str(fixture / 'projects'),
    'KELVOY_COMPOSE_ACCEPTANCE_ROOT': str(fixture),
    'INFERENCE_BASE_URL': 'http://127.0.0.1:1',
    'KELVOY_COMFYUI_BASE_URL': 'http://127.0.0.1:1',
    'STEPFUN_API_BASE': 'http://127.0.0.1:1',
    'KELVOY_VERIFY_BASE_URL': 'http://127.0.0.1:18888',
})
if live.get('KELVOY_FONT_FILE'):
    environment['KELVOY_FONT_FILE'] = live['KELVOY_FONT_FILE']
bun = str(Path.home() / '.bun/bin/bun')
if kind == 'web':
    os.chdir(release / 'apps/web')
    environment['PORT'] = '18888'
    command = [bun, 'src/server/index.ts']
else:
    assert kind in ('init', 'verify')
    os.chdir(release)
    command = [bun, 'infra/dgx/verify-compose-acceptance.ts', kind]
os.execve(bun, command, environment)
