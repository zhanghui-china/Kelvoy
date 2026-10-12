"""One-off experiment: does an outfit reference image keep face/outfit/landmark in keyframes?

Not part of the product (spike/ is not linted or tested). Run on a DGX with the inference
service's Python (needs httpx) against the local ComfyUI. It never touches the Kelvoy database
or the projects tree except reading reference images; outputs go to --out.

Variants per persona x outfit x landmark:
  A  [outfit, landmark]            outfit image replaces the base persona image (2 refs, wired in prod)
  B  [outfit, base, landmark]      outfit + base image for the face (3 refs, needs the Tri template)
  C  [base, landmark]              today's behaviour, as a baseline

Outfit images are first produced from the base image with the single-reference edit workflow
(prompt = change the clothes), so this measures the model's own outfit-change ability.
"""
import argparse
import html
import json
import sys
import time
import uuid
from pathlib import Path

import httpx

PERSONAS = {"阿岚": "persona/c_official_alan/front.jpg", "阿澄": "persona/c_official_aching/front.jpg"}
OUTFITS = {
    "秋季风衣": "把人物的衣服换成米色长款风衣，里面是白色高领毛衣和深色长裤，保持人物的脸型、发型和体态完全不变，全身正面站立，背景简洁",
    "冬季羽绒服": "把人物的衣服换成深灰色长款羽绒服，围着红色围巾，戴深色手套，保持人物的脸型、发型和体态完全不变，全身正面站立，背景简洁",
}
LANDMARKS = {"灵山大佛": "dest/lingshan/01.jpg", "南长街街区": "dest/nanchang/01.jpg", "泰山山景": "dest/mount-tai/01.jpg"}
TEMPLATES = {1: "1_1_SingleRef2IMG_QwenImage2_1_api.json", 2: "1_2_DualRef2IMG_QwenImage2_1_api.json",
             3: "1_3_TriRef2IMG_QwenImage2_1_api.json"}
LOAD_NODES = {1: ["489"], 2: ["489", "491"], 3: ["489", "491", "493"]}
RES_NODE = {1: "491", 2: "493", 3: "494"}
SEED = 20261012


def scene_prompt(landmark: str) -> str:
    # Same style as production kf_prompt: scene, light, framing; no appearance description.
    return f"一位旅行者站在真实的{landmark}前，自然光，竖版构图，保持人物外貌和服装与参考图一致，保持地标特征"


def comfy_idle(client: httpx.Client) -> bool:
    queue = client.get("/queue").json()
    return not queue.get("queue_running") and not queue.get("queue_pending")


def wait_idle(client: httpx.Client, limit_s: float = 900) -> None:
    deadline = time.monotonic() + limit_s
    while not comfy_idle(client):
        if time.monotonic() > deadline:
            raise SystemExit("ComfyUI stayed busy; not adding load. Stop and retry later.")
        time.sleep(5)


def upload(client: httpx.Client, path: Path) -> str:
    with path.open("rb") as file:
        response = client.post("/upload/image", files={"image": (path.name, file, "application/octet-stream")},
                               data={"overwrite": "false"})
    response.raise_for_status()
    body = response.json()
    return f"{body['subfolder']}/{body['name']}" if body.get("subfolder") else body["name"]


def generate(client: httpx.Client, bridge: Path, refs: list[Path], prompt: str, out: Path) -> float:
    count = len(refs)
    workflow = json.loads((bridge / TEMPLATES[count]).read_text())
    for node, ref in zip(LOAD_NODES[count], refs):
        workflow[node]["inputs"]["image"] = upload(client, ref)
    workflow["469"]["inputs"]["prompt"] = prompt
    workflow[RES_NODE[count]]["inputs"]["aspect_ratio"] = "9:16 (Portrait Widescreen)"
    workflow[RES_NODE[count]]["inputs"]["megapixels"] = 1.0
    workflow["474"]["inputs"]["seed"] = SEED
    workflow["474"]["inputs"]["control_after_generate"] = "fixed"
    wait_idle(client)
    started = time.monotonic()
    response = client.post("/prompt", json={"prompt": workflow, "client_id": str(uuid.uuid4())})
    response.raise_for_status()
    prompt_id = response.json()["prompt_id"]
    while True:
        history = client.get(f"/history/{prompt_id}").json()
        if prompt_id in history:
            item = history[prompt_id]
            if item.get("status", {}).get("status_str") == "error":
                raise RuntimeError(f"ComfyUI failed: {item['status'].get('messages')}")
            images = item.get("outputs", {}).get("482", {}).get("images", [])
            if images:
                break
        if time.monotonic() - started > 600:
            raise TimeoutError("generation exceeded 10 minutes")
        time.sleep(2)
    meta = images[0]
    data = client.get("/view", params={"filename": meta["filename"], "subfolder": meta.get("subfolder", ""),
                                       "type": meta.get("type", "output")})
    data.raise_for_status()
    out.write_bytes(data.content)
    return time.monotonic() - started


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--projects-root", required=True, type=Path)
    parser.add_argument("--bridge", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--comfy", default="http://127.0.0.1:8188")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    root = args.projects_root
    timings: list[tuple[str, float]] = []
    with httpx.Client(base_url=args.comfy, timeout=60) as client:
        print("waiting for ComfyUI to be idle...", flush=True)
        wait_idle(client, 3 * 3600)  # never jump ahead of real jobs; each job below re-checks
        outfit_images: dict[tuple[str, str], Path] = {}
        for persona, base in PERSONAS.items():
            for outfit, prompt in OUTFITS.items():
                target = args.out / f"outfit_{persona}_{outfit}.png"
                if not target.exists():
                    seconds = generate(client, args.bridge, [root / base], prompt, target)
                    timings.append((target.name, seconds))
                    print(f"{target.name} {seconds:.0f}s", flush=True)
                outfit_images[(persona, outfit)] = target
        rows = []
        for persona, base in PERSONAS.items():
            for landmark, lkey in LANDMARKS.items():
                variants = {"C 现状[基础图,地标]": [root / base, root / lkey]}
                for outfit in OUTFITS:
                    image = outfit_images[(persona, outfit)]
                    variants[f"A {outfit}[穿搭图,地标]"] = [image, root / lkey]
                    variants[f"B {outfit}[穿搭图,基础图,地标]"] = [image, root / base, root / lkey]
                for name, refs in variants.items():
                    target = args.out / f"{persona}_{landmark}_{name[0]}_{name.split(' ')[1][:5]}.png"
                    if not target.exists():
                        seconds = generate(client, args.bridge, refs, scene_prompt(landmark), target)
                        timings.append((target.name, seconds))
                        print(f"{target.name} {seconds:.0f}s", flush=True)
                    rows.append((persona, landmark, name, target))
    write_sheet(args.out, root, outfit_images, rows)


def write_sheet(out: Path, root: Path, outfits: dict, rows: list) -> None:
    parts = ["<meta charset=utf-8><title>穿搭参考图实验</title><style>body{font-family:sans-serif;margin:1rem}"
             "figure{display:inline-block;margin:.3rem;width:200px;vertical-align:top}img{width:200px}"
             "h2{margin-top:1.5rem}figcaption{font-size:12px}</style><h1>穿搭参考图实验</h1>"
             "<p>C=现状，A=穿搭图替代基础图，B=穿搭图+基础图。看：脸是否漂、衣服是否对、地标是否保持。</p>"]
    for persona in PERSONAS:
        parts.append(f"<h2>{html.escape(persona)}</h2><div>")
        parts.append(f"<figure><img src='base_{persona}.jpg' alt=''><figcaption>基础图</figcaption></figure>")
        for (p, outfit), path in outfits.items():
            if p == persona:
                parts.append(f"<figure><img src='{path.name}'><figcaption>穿搭图：{html.escape(outfit)}（模型换装）</figcaption></figure>")
        parts.append("</div>")
        for landmark in LANDMARKS:
            parts.append(f"<h3>{html.escape(landmark)}</h3><div>")
            for p, lm, name, path in rows:
                if p == persona and lm == landmark:
                    parts.append(f"<figure><img src='{path.name}'><figcaption>{html.escape(name)}</figcaption></figure>")
            parts.append("</div>")
    (out / "index.html").write_text("".join(parts))
    for persona, base in PERSONAS.items():
        (out / f"base_{persona}.jpg").write_bytes((root / base).read_bytes())


if __name__ == "__main__":
    sys.exit(main())
