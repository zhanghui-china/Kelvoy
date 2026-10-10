"""Launch an isolated service with inherited deployment environment, without exposing secrets."""

import os
import subprocess
import sys
import time
from pathlib import Path

kind, release, fixture = sys.argv[1:]
service = "kelvoy-worker" if kind == "worker" else "kelvoy-inference"
pid = subprocess.check_output(["systemctl", "--user", "show", service, "-p", "MainPID", "--value"], text=True).strip()
environment = dict(os.environ)
if pid != "0":
    for item in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
        if b"=" in item:
            key, value = item.split(b"=", 1)
            environment[key.decode()] = value.decode()
environment.update({
    "KELVOY_PROJECTS_ROOT": str(Path(fixture) / "projects"),
    "KELVOY_DB_PATH": str(Path(fixture) / "acceptance.db"),
    "KELVOY_VIDEO_ACCEPTANCE_ROOT": fixture,
    "KELVOY_VIDEO_TIMEOUT_SECONDS": "900",
    "INFERENCE_BASE_URL": "http://127.0.0.1:18100",
})
if kind == "worker":
    # Capture the live deployment environment before pausing its receiver.
    # Parent releases this gate only after the production GPU queue is idle.
    (Path(fixture) / "worker-environment-ready").touch(mode=0o600)
    gate = Path(fixture) / "start-worker"
    deadline = time.monotonic() + 60
    while not gate.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("acceptance start gate was not released")
        time.sleep(0.2)
    os.chdir(release)
    program = str(Path.home() / ".bun/bin/bun")
    command = [program, "infra/dgx/verify-video-acceptance.ts"]
else:
    os.chdir(Path(release) / "services/inference")
    environment.update({"PORT": "18100", "HOST": "127.0.0.1"})
    program = str(Path(release) / "services/inference/.venv/bin/python")
    command = [program, "-m", "inference"]
os.execve(program, command, environment)
