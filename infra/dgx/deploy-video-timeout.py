"""Node-local cutover after real-shot acceptance. Does not submit or modify tasks.

Run as the node service account: python3 deploy-video-timeout.py --release ABS_PATH
--data-root is mandatory if the live Web service lacks absolute persistent paths.
Backups are evidence/recovery inputs; rollback never overwrites user data.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SERVICES = ("kelvoy-inference", "kelvoy-web", "kelvoy-worker")
DROPIN = "zzzzzzzz-video-timeout-20261010.conf"


class DeploymentCheckError(RuntimeError):
    """Only this script's fixed safe check messages may enter deployment reports."""


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def systemctl(*args):
    return command("systemctl", "--user", *args)


def property_value(service, key):
    return systemctl("show", service, "-p", key, "--value")


def service_active(service):
    return property_value(service, "ActiveState") == "active"


def request_json(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def queue_idle(url):
    queue = request_json(url.rstrip("/") + "/queue")
    # Fail closed if this is not a ComfyUI queue response.
    return queue["queue_running"] == [] and queue["queue_pending"] == []


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def media_snapshot(root):
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise DeploymentCheckError("Projects contains symlinks; manual backup review required")
        if path.is_file():
            result[str(path.relative_to(root))] = digest(path)
    return result


def database_snapshot(path):
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as database:
        if database.execute("pragma integrity_check").fetchone()[0] != "ok":
            raise DeploymentCheckError("Database integrity check failed")
        schema = database.execute(
            "select type,name,tbl_name,sql from sqlite_master order by type,name"
        ).fetchall()
        tables = database.execute(
            "select name from sqlite_master where type='table' order by name"
        ).fetchall()
        rows = {}
        for (table,) in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            # Sort serialized rows; no dependency on rowid or table primary keys.
            records = sorted(repr(row) for row in database.execute(f"select * from {quoted}"))
            rows[table] = {
                "count": len(records),
                "sha256": hashlib.sha256("\n".join(records).encode()).hexdigest(),
            }
        return {"schema_sha256": hashlib.sha256(repr(schema).encode()).hexdigest(), "tables": rows}


def has_tasks(path, statuses):
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as database:
        parameters = ",".join("?" for _ in statuses)
        return (
            database.execute(
                f"select 1 from tasks where status in ({parameters}) limit 1", statuses
            ).fetchone()
            is not None
        )


def live_environment(service):
    pid = int(property_value(service, "MainPID"))
    if not pid:
        return {}
    values = {}
    for item in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
        if b"=" in item:
            key, value = item.split(b"=", 1)
            values[key.decode()] = value.decode()
    return values


def directory_matches(service, expected):
    pid = int(property_value(service, "MainPID"))
    return (
        bool(pid)
        and property_value(service, "WorkingDirectory") == str(expected)
        and (Path(f"/proc/{pid}/cwd").resolve(strict=True) == expected)
    )


def wait_healthy(service, url):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            if service_active(service) and request_json(url).get("status") == "ok":
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise DeploymentCheckError(f"Health check failed for {service}")


def cutover(args):
    os.umask(0o077)
    release = Path(args.release).resolve(strict=True)
    manifest = json.loads((release / "RELEASE.json").read_text())
    bun = Path.home() / ".bun/bin/bun"
    python = release / "services/inference/.venv/bin/python"
    for path in (
        bun,
        python,
        release / "apps/web/dist/index.html",
        release / "apps/worker/src/index.ts",
    ):
        if not path.is_file():
            raise DeploymentCheckError("Release dependencies/build missing")
    if any(character.isspace() for character in str(release)):
        raise DeploymentCheckError("Release path cannot contain whitespace")
    if any(character in str(release) for character in ('"', "\n", "%", "\\")):
        raise DeploymentCheckError("Release path cannot be represented safely in systemd")
    initial = {service: service_active(service) for service in SERVICES}
    environment = live_environment("kelvoy-web")
    data_root = Path(args.data_root).resolve(strict=True) if args.data_root else None
    db_path = environment.get("KELVOY_DB_PATH")
    projects_path = environment.get("KELVOY_PROJECTS_ROOT")
    if data_root:
        database = data_root / "data/kelvoy.db"
        projects = data_root / "projects"
    elif (
        db_path
        and projects_path
        and Path(db_path).is_absolute()
        and Path(projects_path).is_absolute()
    ):
        database, projects = Path(db_path), Path(projects_path)
    else:
        raise DeploymentCheckError(
            "Supply --data-root for explicit persistent database/projects paths"
        )
    database, projects = database.resolve(strict=True), projects.resolve(strict=True)
    for path in (database, projects):
        if any(character in str(path) for character in ('"', "\n", "%", "\\")):
            raise DeploymentCheckError("Persistent path cannot be represented safely in systemd")
    if database.is_relative_to(release) or projects.is_relative_to(release):
        raise DeploymentCheckError("Persistent data must be outside the new release")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path.home() / "kelvoy-backups" / f"pre-video-timeout-{stamp}"
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    report = {
        "release": str(release),
        "manifest": manifest,
        "backup": str(backup),
        "database": str(database),
        "projects": str(projects),
        "initial_services": initial,
        "started_at": stamp,
        "status": "preparing",
    }
    created = []
    saved_config = {}

    def record():
        try:
            (backup / "deployment.json").write_text(json.dumps(report, indent=2))
        except Exception:  # noqa: BLE001 - reporting must never prevent service restoration
            # A full disk or permission failure must never prevent service restoration.
            try:
                print(
                    "Deployment report write failed; continuing service recovery", file=sys.stderr
                )
            except OSError:
                pass

    def phase(name):
        report["phase"] = name
        record()

    for service in SERVICES:
        path = Path.home() / ".config/systemd/user" / f"{service}.service.d" / DROPIN
        if path.exists():
            raise DeploymentCheckError("Video timeout drop-in already exists; do not overwrite it")
    worker_stopped = False
    try:
        phase("admission_stop_web")
        # Stop Web first: no new user task can race the admission/idle checks.
        systemctl("stop", "kelvoy-web")
        if initial["kelvoy-worker"]:
            if has_tasks(database, ("pending", "processing")) or not queue_idle(args.comfy_url):
                raise DeploymentCheckError("Active Worker has tasks/GPU jobs; drain before cutover")
            systemctl("stop", "kelvoy-worker")
            worker_stopped = True
        # An already-paused GX Worker may have stale processing/pending rows.
        # Those rows remain unchanged and resume naturally after successful cutover.
        if not queue_idle(args.comfy_url):
            raise DeploymentCheckError("GPU queue busy; no release switched")
    except Exception:  # noqa: BLE001 - all admission failures must restore Web/receiver state
        report["status"] = "admission_rejected"
        record()
        if worker_stopped and initial["kelvoy-worker"]:
            systemctl("start", "kelvoy-worker")
        if initial["kelvoy-web"]:
            systemctl("start", "kelvoy-web")
        raise DeploymentCheckError("Admission failed; original service state restored") from None

    try:
        phase("backup_configuration")
        for service in SERVICES:
            (backup / f"{service}.service.txt").write_text(systemctl("cat", service))
            files = [property_value(service, "FragmentPath")]
            files += property_value(service, "DropInPaths").split()
            files += re.findall(
                r"(\S+) \(ignore_errors=(?:yes|no)\)", property_value(service, "EnvironmentFiles")
            )
            for filename in files:
                path = Path(filename)
                if not path.is_file():
                    raise DeploymentCheckError("Referenced service configuration missing")
                saved_config[str(path)] = digest(path)
                output = backup / "configuration" / str(path).lstrip("/")
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, output)
        report["configuration_sha256"] = saved_config
        phase("backup_database")
        systemctl("stop", "kelvoy-web", "kelvoy-inference")
        before = database_snapshot(database)
        with (
            sqlite3.connect(f"file:{database}?mode=ro", uri=True) as source,
            sqlite3.connect(backup / "kelvoy-cutover.db") as target,
        ):
            source.backup(target)
        if database_snapshot(backup / "kelvoy-cutover.db") != before:
            raise DeploymentCheckError("SQLite backup verification failed")
        phase("backup_media")
        media = media_snapshot(projects)
        archive_path = backup / "projects-cutover.tar"
        with tarfile.open(archive_path, "w") as archive:
            archive.add(projects, arcname="projects")
        with tarfile.open(archive_path) as archive:
            archived = {
                str(Path(member.name).relative_to("projects")): hashlib.file_digest(
                    archive.extractfile(member), "sha256"
                ).hexdigest()
                for member in archive.getmembers()
                if member.isfile()
            }
        if archived != media:
            raise DeploymentCheckError("Media archive verification failed")
        report.update(
            database_snapshot=before, media_sha256=media, archive_sha256=digest(archive_path)
        )
        phase("write_dropins")
        settings = {
            "kelvoy-web": (release / "apps/web", f'"{bun}" src/server/index.ts'),
            "kelvoy-worker": (release, f'"{bun}" apps/worker/src/index.ts'),
            "kelvoy-inference": (release / "services/inference", f'"{python}" -m inference'),
        }
        for service, (directory, executable) in settings.items():
            path = Path.home() / ".config/systemd/user" / f"{service}.service.d" / DROPIN
            if path.exists():
                raise DeploymentCheckError(
                    "Video timeout drop-in already exists; do not overwrite it"
                )
            path.parent.mkdir(parents=True, exist_ok=True)
            created.append(path)
            path.write_text(
                f"[Service]\nWorkingDirectory={directory}\nExecStart=\n"
                f"ExecStart={executable}\nEnvironment=KELVOY_VIDEO_TIMEOUT_SECONDS=900\n"
                f'Environment="KELVOY_DB_PATH={database}"\n'
                f'Environment="KELVOY_PROJECTS_ROOT={projects}"\n'
            )
        phase("start_inference_web")
        systemctl("daemon-reload")
        systemctl("start", "kelvoy-inference", "kelvoy-web")
        phase("health_inference")
        wait_healthy("kelvoy-inference", args.inference_url.rstrip("/") + "/health")
        phase("health_web")
        wait_healthy("kelvoy-web", args.web_url.rstrip("/") + "/api/health")
        for service in ("kelvoy-inference", "kelvoy-web"):
            phase(f"effective_environment_{service}")
            effective = live_environment(service)
            directory_ok = directory_matches(service, settings[service][0])
            report.setdefault("environment_checks", {})[service] = {
                "working_directory_matches": directory_ok,
                "timeout_matches": effective.get("KELVOY_VIDEO_TIMEOUT_SECONDS") == "900",
                "projects_matches": effective.get("KELVOY_PROJECTS_ROOT") == str(projects),
                "database_matches": effective.get("KELVOY_DB_PATH") == str(database),
            }
            record()
            if not directory_ok:
                raise DeploymentCheckError("Effective service WorkingDirectory not new release")
            if effective.get("KELVOY_VIDEO_TIMEOUT_SECONDS") != "900":
                raise DeploymentCheckError("Video timeout configuration not effective")
            if effective.get("KELVOY_PROJECTS_ROOT") != str(projects):
                raise DeploymentCheckError("Persistent service projects path not effective")
            if service == "kelvoy-web" and (
                effective.get("KELVOY_DB_PATH") != str(database)
                or effective.get("KELVOY_PROJECTS_ROOT") != str(projects)
            ):
                raise DeploymentCheckError("Persistent Web paths not effective")
        phase("compare_database_media")
        current_database = database_snapshot(database)
        current_media = media_snapshot(projects)
        if current_database != before or current_media != media:
            report["consistency_changes"] = {
                "schema_changed": current_database["schema_sha256"] != before["schema_sha256"],
                "tables_changed": sorted(
                    name
                    for name in current_database["tables"].keys() | before["tables"].keys()
                    if current_database["tables"].get(name) != before["tables"].get(name)
                ),
                "media_added_count": len(current_media.keys() - media.keys()),
                "media_removed_count": len(media.keys() - current_media.keys()),
                "media_changed_count": sum(
                    current_media[name] != media[name]
                    for name in current_media.keys() & media.keys()
                ),
            }
            record()
            raise DeploymentCheckError("Paused database/media changed after service switch")
        phase("compare_original_configuration")
        if any(digest(Path(path)) != value for path, value in saved_config.items()):
            raise DeploymentCheckError("Original service/environment configuration changed")
        report["status"] = "verified_before_worker"
        record()
        # GX10 Worker may already be paused for acceptance; success always resumes production.
        phase("start_worker")
        systemctl("start", "kelvoy-worker")
        time.sleep(2)
        if not service_active("kelvoy-worker"):
            raise DeploymentCheckError("Worker failed to resume queue")
        phase("effective_environment_kelvoy-worker")
        worker_environment = live_environment("kelvoy-worker")
        worker_directory_ok = directory_matches("kelvoy-worker", release)
        report.setdefault("environment_checks", {})["kelvoy-worker"] = {
            "working_directory_matches": worker_directory_ok,
            "timeout_matches": worker_environment.get("KELVOY_VIDEO_TIMEOUT_SECONDS") == "900",
            "projects_matches": worker_environment.get("KELVOY_PROJECTS_ROOT") == str(projects),
            "database_matches": worker_environment.get("KELVOY_DB_PATH") == str(database),
        }
        record()
        if not worker_directory_ok:
            raise DeploymentCheckError("Effective Worker WorkingDirectory not new release")
        if worker_environment.get("KELVOY_VIDEO_TIMEOUT_SECONDS") != "900":
            raise DeploymentCheckError("Worker timeout configuration not effective")
        if worker_environment.get("KELVOY_DB_PATH") != str(database) or worker_environment.get(
            "KELVOY_PROJECTS_ROOT"
        ) != str(projects):
            raise DeploymentCheckError("Persistent Worker paths not effective")
        report.update(
            status="deployed",
            services={
                service: {
                    "active": service_active(service),
                    "restarts": property_value(service, "NRestarts"),
                }
                for service in SERVICES
            },
        )
        record()
    except Exception as error:  # noqa: BLE001 - all cutover failures require rollback
        report.update(
            status="rollback_needed",
            error_type=type(error).__name__,
            failure_phase=report.get("phase"),
            failure_reason=str(error)
            if isinstance(error, DeploymentCheckError)
            else "External operation failed; exception text withheld",
        )
        record()
        # Freeze new user submissions before determining whether Worker can be stopped.
        # Never signal a Worker that might own an in-flight GPU task, including the
        # pending -> processing race. Drain first; no global interrupt is permitted.
        systemctl("stop", "kelvoy-web")
        try:
            rollback_busy = not queue_idle(args.comfy_url) or (
                service_active("kelvoy-worker") and has_tasks(database, ("pending", "processing"))
            )
        except Exception:  # noqa: BLE001 - uncertainty about live work means fail closed
            rollback_busy = True
        if rollback_busy:
            report["status"] = "rollback_deferred"
            report["rollback"] = (
                "Worker/GPU work may be live; no cancellation; manual drain required"
            )
            record()
            raise DeploymentCheckError(
                "Rollback deferred; live Worker/GPU left untouched"
            ) from None
        systemctl("stop", "kelvoy-worker")
        systemctl("stop", "kelvoy-web", "kelvoy-inference")
        for path in created:
            path.unlink(missing_ok=True)
        systemctl("daemon-reload")
        for service in SERVICES:
            if initial[service]:
                systemctl("start", service)
        report.update(
            status="rolled_back", rollback="Code/config only; database/media never overwritten"
        )
        record()
        raise DeploymentCheckError(
            "Deployment failed; original code/config restored; see protected report"
        ) from None
    print(json.dumps({"status": report["status"], "release": str(release), "backup": str(backup)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    parser.add_argument("--data-root")
    parser.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    parser.add_argument("--inference-url", default="http://127.0.0.1:8100")
    parser.add_argument("--web-url", default="http://127.0.0.1:8888")
    cutover(parser.parse_args())
