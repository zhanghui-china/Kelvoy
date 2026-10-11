"""Read-only copy of a production composition's existing inputs into an isolated root."""
import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path

source, target = (Path(arg).resolve() for arg in sys.argv[1:3])
episode_id = sys.argv[3]
target.mkdir(mode=0o700, parents=True, exist_ok=False)
with sqlite3.connect(f"file:{source / 'data/kelvoy.db'}?mode=ro", uri=True) as database:
    episode = json.loads(database.execute("select doc from episodes where episode_id=?", (episode_id,)).fetchone()[0])
    persona = json.loads(database.execute("select doc from persona_versions where persona_id=? and version=?", (episode['persona_id'], episode['persona_version'])).fetchone()[0])
    destination = json.loads(database.execute("select doc from destination_versions where destination_id=? and version=?", (episode['destination_id'], episode['destination_version'])).fetchone()[0])
projects = (source / 'projects').resolve()
hashes = {}
clone_id = 'e_compose_acceptance'
for shot in episode['shots']:
    assert shot['status'] == 'approved' and shot['clip']
    key = shot['clip']
    path = (projects / episode_id / key).resolve()
    assert path.is_relative_to(projects / episode_id) and path.is_file()
    output = target / 'projects' / clone_id / key
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, output)
    hashes[key] = hashlib.sha256(path.read_bytes()).hexdigest()
for key in (episode['render']['intro'], episode['render']['outro'], persona['style']['lut'] or None):
    if key is None:
        continue
    path = (projects / key).resolve()
    assert path.is_relative_to(projects) and path.is_file()
    output = target / 'projects' / key
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, output)
fingerprint = hashlib.sha256(json.dumps(episode, sort_keys=True).encode()).hexdigest()
episode['episode_id'] = clone_id
episode['share'] = {'enabled': False, 'slug': ''}
episode['status'] = 'composing'
episode['music']['enabled'] = False
(target / 'inputs.json').write_text(json.dumps({'episode': episode, 'persona': persona, 'destination': destination, 'clip_hashes': hashes, 'original_episode_hash': fingerprint}))
print(json.dumps({'fixture': str(target), 'clips': len(hashes), 'cut_policy': episode['cut_policy'], 'music_directory_exists': (target / 'projects/music').exists()}))
