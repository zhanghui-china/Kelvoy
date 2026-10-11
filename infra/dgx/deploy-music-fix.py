"""Music release cutover. Retains online data and existing deletion audit on rollback."""
import argparse
import importlib.util
import json
import os
import shutil
import sqlite3
import tarfile
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('deployment', Path(__file__).with_name('deploy-video-timeout.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
DROPIN = 'zzzzzzzzzz-music-20261011.conf'
SERVICES = ('kelvoy-web', 'kelvoy-worker')
TRACKS = ('calm_morning', 'city_walk', 'bright_travel', 'night_neon', 'wide_nature')


def has_live_work(database):
    if ops.has_tasks(database, ("pending", "processing")):
        return True
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        return connection.execute("select 1 from task_executions where exited=0 and lease_until>unixepoch('now') limit 1").fetchone() is not None


def deploy(release, data_root):
    os.umask(0o077)
    release, data_root = release.resolve(strict=True), data_root.resolve(strict=True)
    database, projects = (data_root / 'data/kelvoy.db').resolve(strict=True), (data_root / 'projects').resolve(strict=True)
    if database.is_relative_to(release) or projects.is_relative_to(release):
        raise RuntimeError('Persistent data must remain outside release')
    manifest = json.loads((release / 'RELEASE.json').read_text())
    for key, digest in manifest['files'].items():
        if ops.digest(release / key) != digest:
            raise RuntimeError('Release file hash mismatch')
    if not (release / 'apps/web/dist/index.html').is_file():
        raise RuntimeError('Release production build missing')
    for path in (release, database, projects):
        if any(character in str(path) for character in ('"', '\n', '%', '\\')) or any(character.isspace() for character in str(path)):
            raise RuntimeError('Unrepresentable service path')
    paths = {service: Path.home() / '.config/systemd/user' / f'{service}.service.d' / DROPIN for service in SERVICES}
    if any(path.exists() for path in paths.values()):
        raise RuntimeError('Release drop-in already exists')
    worker_environment = ops.live_environment('kelvoy-worker')
    initial = {service: ops.service_active(service) for service in SERVICES}
    backup = Path.home() / 'kelvoy-backups' / ('pre-music-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    backup.mkdir(parents=True, exist_ok=False, mode=0o700)
    report = {'status': 'preparing', 'release': str(release), 'commit': manifest['commit'], 'backup': str(backup), 'original_services': initial}
    created = []
    worker_stopped = False

    def record(phase):
        report['phase'] = phase
        (backup / 'deployment.json').write_text(json.dumps(report, indent=2))

    try:
        record('freeze_admission_and_drain')
        ops.systemctl('stop', 'kelvoy-web')
        deadline = time.monotonic() + 1000
        while has_live_work(database):
            if not initial['kelvoy-worker'] or time.monotonic() > deadline:
                raise RuntimeError('Task drain incomplete; no release switched')
            time.sleep(2)
        ops.systemctl('stop', 'kelvoy-worker')
        worker_stopped = True
        record('backup_configuration_database_media')
        configuration = {}
        for service in SERVICES:
            (backup / f'{service}.service.txt').write_text(ops.systemctl('cat', service))
            import re
            files = [ops.property_value(service, 'FragmentPath')] + ops.property_value(service, 'DropInPaths').split()
            files += re.findall(r'(\S+) \(ignore_errors=(?:yes|no)\)', ops.property_value(service, 'EnvironmentFiles'))
            for filename in files:
                path = Path(filename)
                configuration[str(path)] = ops.digest(path)
                output = backup / 'configuration' / str(path).lstrip('/')
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, output)
        before_database = ops.database_snapshot(database)
        with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as source, sqlite3.connect(backup / 'kelvoy-cutover.db') as target:
            source.backup(target)
        if ops.database_snapshot(backup / 'kelvoy-cutover.db') != before_database:
            raise RuntimeError('Database backup mismatch')
        before_media = ops.media_snapshot(projects)
        with tarfile.open(backup / 'projects-cutover.tar', 'w') as archive:
            archive.add(projects, arcname='projects')
        with tarfile.open(backup / 'projects-cutover.tar') as archive:
            import hashlib
            archived = {str(Path(member.name).relative_to('projects')): hashlib.file_digest(archive.extractfile(member), 'sha256').hexdigest() for member in archive.getmembers() if member.isfile()}
        if archived != before_media:
            raise RuntimeError('Media backup mismatch')
        report.update(database_snapshot=before_database, media_sha256=before_media, configuration_sha256=configuration)
        record('install_missing_music_and_probe')
        installed, music = [], {}
        for track in TRACKS:
            source = release / 'assets/shared/music' / f'{track}.mp3'
            output = projects / 'music' / source.name
            output.parent.mkdir(parents=True, exist_ok=True)
            if not output.exists():
                # Exclusive create: existing user material must never be overwritten.
                with source.open('rb') as src, output.open('xb') as dst:
                    try:
                        shutil.copyfileobj(src, dst)
                    except BaseException:
                        output.unlink(missing_ok=True)
                        raise
                installed.append(str(output.relative_to(projects)))
            if ops.digest(source) != ops.digest(output):
                raise RuntimeError('Existing music differs from release; do not overwrite')
            tool = shutil.which('ffprobe', path=worker_environment.get('PATH'))
            if not tool:
                raise RuntimeError('Worker ffprobe dependency missing')
            probe = json.loads(ops.command(tool, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', str(output)))
            if not probe['streams'] or float(probe['format']['duration']) <= 0:
                raise RuntimeError('Music audio invalid')
            music[str(output.relative_to(projects))] = ops.digest(output)
        report.update(installed_music=installed, music_sha256=music)
        record('switch_web_worker')
        bun = Path.home() / '.bun/bin/bun'
        for service, directory, entry in (('kelvoy-web', release / 'apps/web', 'src/server/index.ts'), ('kelvoy-worker', release, 'apps/worker/src/index.ts')):
            path = paths[service]
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('x') as stream:
                created.append(path)
                stream.write(f'[Service]\nWorkingDirectory={directory}\nExecStart=\nExecStart="{bun}" {entry}\nEnvironment="KELVOY_DB_PATH={database}"\nEnvironment="KELVOY_PROJECTS_ROOT={projects}"\n')
        ops.systemctl('daemon-reload')
        ops.systemctl('start', 'kelvoy-web')
        ops.wait_healthy('kelvoy-web', 'http://127.0.0.1:8888/api/health')
        if not ops.directory_matches('kelvoy-web', release / 'apps/web'):
            raise RuntimeError('Web working directory mismatch')
        if ops.database_snapshot(database) != before_database:
            raise RuntimeError('Paused database changed')
        expected = {**before_media, **music}
        if ops.media_snapshot(projects) != expected:
            raise RuntimeError('Existing media changed')
        if any(ops.digest(Path(path)) != digest for path, digest in configuration.items()):
            raise RuntimeError('Original configuration changed')
        record('resume_worker')
        ops.systemctl('start', 'kelvoy-worker')
        worker_stopped = False
        time.sleep(2)
        if not ops.service_active('kelvoy-worker') or not ops.directory_matches('kelvoy-worker', release):
            raise RuntimeError('Worker working directory mismatch')
        for service in SERVICES:
            environment = ops.live_environment(service)
            if environment.get('KELVOY_DB_PATH') != str(database) or environment.get('KELVOY_PROJECTS_ROOT') != str(projects):
                raise RuntimeError('Persistent service paths mismatch')
        report.update(status='deployed', services={service: {'active': ops.service_active(service), 'restarts': ops.property_value(service, 'NRestarts')} for service in SERVICES})
        record('complete')
        print(json.dumps({'status': report['status'], 'backup': str(backup), 'commit': manifest['commit'], 'music_tracks': len(music), 'installed_tracks': len(installed)}))
    except BaseException:
        # Restore code configuration only. Never restore online DB/media or delete audits.
        ops.systemctl('stop', 'kelvoy-web')
        if not worker_stopped:
            if has_live_work(database):
                if created:
                    report['status'] = 'rollback_deferred_busy'
                    record('worker_has_active_tasks_code_retained')
                elif initial['kelvoy-web']:
                    ops.systemctl('start', 'kelvoy-web')
                raise
            ops.systemctl('stop', 'kelvoy-worker')
        for path in created:
            path.unlink(missing_ok=True)
        ops.systemctl('daemon-reload')
        for service in SERVICES:
            if initial[service]:
                ops.systemctl('start', service)
        report['status'] = 'rolled_back'
        record('rollback_code_only')
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--data-root', type=Path, required=True)
    args = parser.parse_args()
    deploy(args.release, args.data_root)
