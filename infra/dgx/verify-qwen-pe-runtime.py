#!/usr/bin/env python3
"""Fail closed on changed official runtime code/checkpoint metadata before startup."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(os.environ.get('QWEN_ROOT', '/home1/huntun/kelvoy-qwen-pe'))
HASHES = {
    'official/run_transformers.py': 'b50ce0b93d0713e09af295ba926deb90859eb362b155919569b63a50a1b28e37',
    'official/pe_core.py': 'fd9732bbba71468fb24bd81de5c209f0db2941f01d1e556d52b5a6deba0f1fe5',
    'official/LICENSE': '8dc973f024ff95966bea25866efa443fd16776dcb1001e681e3d467ea572b28d',
    'official/Notice': 'efa09ff399c8e4426b6e57e707c14e5db35258a290a15368a5bacd3e1e8381ab',
    'model/system_prompt.txt': 'e378fea686a1431581ba4c654d332ae96adad633f144ae738ec8ce9c4fd66439',
    'model/generation_config.json': '2d92457211a50894a21ea309b73c86db69672350709c864e32744ca377a3e503',
}

for relative, digest in HASHES.items():
    if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Pinned official runtime artifact changed: {relative}')

artifacts = json.loads((ROOT / 'model/ARTIFACTS.json').read_text())
if artifacts['revision'] != '72927bc08afc99b7888ceb7d7d51a12db3700bbd':
    raise SystemExit('Unexpected model revision')
metadata = json.loads((ROOT / 'qwen-pe-model-artifacts.json').read_text())
for artifact in metadata['siblings']:
    actual = ROOT / 'model' / artifact['rfilename']
    saved = artifacts['files'][artifact['rfilename']]
    sha256 = hashlib.sha256()
    blob = hashlib.sha1(f'blob {actual.stat().st_size}\0'.encode())
    with actual.open('rb') as stream:
        while chunk := stream.read(8 * 1024**2):
            sha256.update(chunk)
            blob.update(chunk)
    if sha256.hexdigest() != saved['sha256'] or actual.stat().st_size != artifact['size']:
        raise SystemExit('Checkpoint actual bytes differ from verified installation')
    if 'lfs' in artifact:
        if (saved['sha256'] != artifact['lfs']['sha256']
                or saved['size'] != artifact['size']):
            raise SystemExit('Checkpoint differs from verified immutable installation')
    elif blob.hexdigest() != artifact['blobId']:
        raise SystemExit('Checkpoint Git blob differs from pinned official artifact')
print('Verified fixed Qwen PE code, system prompt, license and installation manifest')
