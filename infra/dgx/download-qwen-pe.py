#!/usr/bin/env python3
"""Install immutable PE model artifacts, verifying published Git/LFS object hashes.

Installation only; the service runs with HF_HUB_OFFLINE=1. A mirror is a transport,
never a source of revisions. Metadata revision and every object are verified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

REVISION = "72927bc08afc99b7888ceb7d7d51a12db3700bbd"
MODEL = "Qwen/Qwen-Image-2.1-PE-I2I"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--endpoint", default="https://huggingface.co")
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    metadata = json.loads(Path(__file__).with_name("qwen-pe-model-artifacts.json").read_text())
    if metadata["sha"] != REVISION:
        raise SystemExit("Model revision changed; obtain reviewed pinned metadata first")
    required = sum(item["size"] for item in metadata["siblings"])
    if shutil.disk_usage(args.root).free < required + 20 * 1024**3:
        raise SystemExit("Insufficient space: leave at least 20 GiB after download")
    def fetch(item):
        name = item["rfilename"]
        target = args.root / name
        if Path(name).name != name:
            raise SystemExit("Unexpected nested model artifact")
        if not target.exists():
            partial = target.with_name(target.name + ".partial")
            print(f"Downloading {name}", flush=True)
            subprocess.run([
                "curl", "-fL", "--retry", "3", "--connect-timeout", "30",
                "--max-time", "7200", "-C", "-", "-o", str(partial),
                f"{args.endpoint}/{MODEL}/resolve/{REVISION}/{name}",
            ], check=True)
            partial.rename(target)
        sha256 = hashlib.sha256()
        git_blob = hashlib.sha1(f"blob {target.stat().st_size}\0".encode())
        with target.open("rb") as stream:
            while chunk := stream.read(8 * 1024**2):
                sha256.update(chunk)
                git_blob.update(chunk)
        if target.stat().st_size != item["size"]:
            raise SystemExit(f"Size mismatch: {name}")
        digest = sha256.hexdigest()
        if "lfs" in item:
            valid = digest == item["lfs"]["sha256"]
        else:
            valid = git_blob.hexdigest() == item["blobId"]
        if not valid:
            raise SystemExit(f"Published object hash mismatch: {name}")
        print(f"Verified {name}: {digest}", flush=True)
        return name, {"sha256": digest, "size": item["size"]}
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = dict(pool.map(fetch, metadata["siblings"]))
    manifest = {"model": MODEL, "revision": REVISION, "transport": args.endpoint,
                "metadata_source": metadata["source"],
                "files": records, "license": "LICENSE (Qwen Research License)"}
    partial_manifest = args.root / "ARTIFACTS.json.partial"
    partial_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    partial_manifest.replace(args.root / "ARTIFACTS.json")


if __name__ == "__main__":
    main()
