"""Copy only selected read-only production inputs into a protected node-local fixture."""

import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
episode_id = sys.argv[3]
target.mkdir(mode=0o700, parents=True, exist_ok=False)
db = sqlite3.connect(f"file:{source / 'data/kelvoy.db'}?mode=ro", uri=True)
episode = json.loads(db.execute("select doc from episodes where episode_id=?", (episode_id,)).fetchone()[0])
persona = json.loads(db.execute("select doc from persona_versions where persona_id=? and version=?", (episode['persona_id'], episode['persona_version'])).fetchone()[0])
destination = json.loads(db.execute("select doc from destination_versions where destination_id=? and version=?", (episode['destination_id'], episode['destination_version'])).fetchone()[0])
tasks = []
references = set()
for number in (1, 5):
    shot = next(item for item in episode['shots'] if item['no'] == number)
    task = db.execute("select task_id,generation_id from tasks where episode_id=? and shot_id=? and stage='video' order by rowid desc limit 1", (episode_id, shot['shot_id'])).fetchone()
    tasks.append({'no': number, 'generation_id': task[1] or task[0]})
    landmark = next((item for item in destination['landmarks'] if item['id'] == shot.get('landmark')), destination['landmarks'][0])
    references.update((persona['refs'][0], landmark['refs'][0]))
hashes = {}
for key in references:
    path = (source / 'projects' / key).resolve()
    assert path.is_relative_to((source / 'projects').resolve()) and path.is_file()
    output = target / 'projects' / key
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, output)
    hashes[key] = hashlib.sha256(path.read_bytes()).hexdigest()
cache = source / 'projects' / episode_id / 'h3-prompts'
clone_id = 'e_video_acceptance'
if cache.exists():
    shutil.copytree(cache, target / 'projects' / clone_id / 'h3-prompts')
fingerprint = hashlib.sha256(json.dumps(episode, sort_keys=True).encode()).hexdigest()
episode['episode_id'] = clone_id
episode['owner_id'] = 'u_video_acceptance'
episode['status'] = 'clipping'
persona['owner_id'] = None
(target / 'inputs.json').write_text(json.dumps({'episode': episode, 'persona': persona, 'destination': destination, 'tasks': tasks, 'reference_hashes': hashes, 'original_episode_hash': fingerprint}))
print(json.dumps({'fixture': str(target), 'shots': [1, 5], 'references': len(references), 'cached_prompts': len(list(cache.glob('*.json')))}))
