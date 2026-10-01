#!/usr/bin/env python3
"""Generate 1_10_DecaRef2IMG workflows (API + UI) from the 1_9_NonaRef pair."""
import json
import copy
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / "comfyui-bridge"

# ---------- API workflow ----------
api = json.loads((BASE / "1_9_NonaRef2IMG_QwenImage2_1_api.json").read_text(encoding="utf-8"))

NEW_NODE_ID = "503"  # 1_9 uses up to 501 (UI last_node_id=502); 503 is free in both
api[NEW_NODE_ID] = {
    "class_type": "LoadImage",
    "inputs": {"image": "example_image_10.png", "upload": "image"},
}
api["469"]["inputs"]["images.image_10"] = [NEW_NODE_ID, 0]
api["469"]["inputs"]["prompt"] = "十个女人一起在漫展上"

(BASE / "1_10_DecaRef2IMG_QwenImage2_1_api.json").write_text(
    json.dumps(api, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ---------- UI workflow ----------
ui = json.loads((BASE / "1_9_NonaRef2IMG_QwenImage2_1.json").read_text(encoding="utf-8"))

NEW_LINK_ID = 736  # ui last_link_id = 735
te = next(n for n in ui["nodes"] if n["id"] == 469)
slot10 = next(i for i, inp in enumerate(te["inputs"]) if inp["name"] == "images.image_10")
assert te["inputs"][slot10]["link"] is None, "image_10 already wired?"
te["inputs"][slot10]["link"] = NEW_LINK_ID

last_loader = next(n for n in ui["nodes"] if n["id"] == 499)
new_node = copy.deepcopy(last_loader)
new_node["id"] = 503
new_node["pos"] = [last_loader["pos"][0], last_loader["pos"][1] + 402.0]
new_node["order"] = 12
new_node["outputs"][0]["links"] = [NEW_LINK_ID]

orders = {n["order"] for n in ui["nodes"]}
while new_node["order"] in orders:
    new_node["order"] += 1
ui["nodes"].append(new_node)

ui["links"].append([NEW_LINK_ID, 503, 0, 469, slot10, "IMAGE"])
ui["last_node_id"] = 503
ui["last_link_id"] = NEW_LINK_ID

(BASE / "1_10_DecaRef2IMG_QwenImage2_1.json").write_text(
    json.dumps(ui, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("api nodes:", len(api), "| ui nodes:", len(ui["nodes"]), "| ui links:", len(ui["links"]))
