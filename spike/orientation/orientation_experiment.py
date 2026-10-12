"""One-off experiment: can the prompt make the protagonist face away / sideways and relate to the landmark?

Not part of the product (spike/ is not linted or tested). Run on a DGX with the inference service's
Python (httpx + Pillow) against the local ComfyUI. Reads reference images only; writes to --out.
It waits for an idle ComfyUI before every job so it never jumps ahead of real tasks.

Prompt variants (production-style kf_prompt, refs [person, landmark] unless noted):
  P0 today      no composition/orientation words
  P1 words      + position / back-to-camera / looking at the landmark, images not named
  P2 named-back images named ("图1是人物，图2是地标") + back-to-camera
  P3 named-side images named + three-quarter side view
  P4 named-front images named + facing camera (control)
  P2o           P2 wording but the person ref is an outfit image from ~/outfit-exp
Empty shots (no person): E1 persona ref still sent, E2 persona ref omitted; prompt says "无人物".
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont

PERSONAS = {"阿岚": "persona/c_official_alan/front.jpg", "阿澄": "persona/c_official_aching/front.jpg"}
OUTFIT_IMAGES = {"阿岚": "outfit_阿岚_秋季风衣.png", "阿澄": "outfit_阿澄_秋季风衣.png"}
LANDMARKS = {"灵山大佛": "dest/lingshan/01.jpg", "南长街街区": "dest/nanchang/01.jpg", "泰山山景": "dest/mount-tai/01.jpg"}
TEMPLATES = {1: "1_1_SingleRef2IMG_QwenImage2_1_api.json", 2: "1_2_DualRef2IMG_QwenImage2_1_api.json"}
LOAD_NODES = {1: ["489"], 2: ["489", "491"]}
RES_NODE = {1: "491", 2: "493"}
SEED = 20261012
NAMING = ("图1是出镜人物的参考图，图2是「{lm}」的实景参考图。把图1的人物放进图2的实景中，"
          "保持人物的脸、发型和服装不变，保持地标的形状与比例、清晰可辨。")
BASE = "9:16画幅，秋日午后柔和暖光，中景机位，"
BACK = "人物位于画面左下三分之一，背对镜头，仰头望向远处的{lm}，{lm}占据画面主体且清晰可辨。"
SIDE = "人物位于画面右侧，侧身（四分之三侧面）望向{lm}，{lm}在人物身后清晰可辨。"
FRONT = "人物面向镜头微笑，身后是{lm}。"
TODAY = "一位旅行者在{lm}前游览，自然轻松。"


def prompts(lm: str) -> dict[str, str]:
    return {
        "P0现状": BASE + TODAY.format(lm=lm),
        "P1文字": BASE + BACK.format(lm=lm),
        "P2命名背对": NAMING.format(lm=lm) + BASE + BACK.format(lm=lm),
        "P3命名侧面": NAMING.format(lm=lm) + BASE + SIDE.format(lm=lm),
        "P4命名正面": NAMING.format(lm=lm) + BASE + FRONT.format(lm=lm),
    }


FULL_BACK = "人物全身入镜，站在画面下方偏左，约占画面高度的三分之一，背对镜头，仰头望向远处的{lm}，{lm}占据画面主体且清晰可辨。"
FULL_SIDE = "人物全身入镜，站在画面右侧，约占画面高度的三分之一，侧身（四分之三侧面）望向{lm}，{lm}清晰可辨。"


def prompts_full(lm: str) -> dict[str, str]:
    # Round 2: does saying "full body, one third of the frame" fix the person scale inherited from a close-up ref?
    return {
        "P5命名背对全身": NAMING.format(lm=lm) + BASE + FULL_BACK.format(lm=lm),
        "P6命名侧面全身": NAMING.format(lm=lm) + BASE + FULL_SIDE.format(lm=lm),
    }


def wait_idle(client: httpx.Client, limit_s: float) -> None:
    deadline = time.monotonic() + limit_s
    while True:
        queue = client.get("/queue").json()
        if not queue.get("queue_running") and not queue.get("queue_pending"):
            return
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
    wait_idle(client, 3 * 3600)
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


def sheet(out: Path, title: str, tiles: list[tuple[str, Path]], width: int = 230) -> None:
    font = ImageFont.load_default()
    for path in ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"):
        if Path(path).exists():
            font = ImageFont.truetype(path, 15)
            break
    images = []
    for label, path in tiles:
        image = Image.open(path).convert("RGB")
        image = image.resize((width, int(image.height * width / image.width)))
        tile = Image.new("RGB", (width, image.height + 22), "white")
        tile.paste(image, (0, 22))
        ImageDraw.Draw(tile).text((3, 2), label, fill="black", font=font)
        images.append(tile)
    columns = 6
    rows = [images[i:i + columns] for i in range(0, len(images), columns)]
    height = sum(max(t.height for t in row) for row in rows)
    canvas = Image.new("RGB", (columns * width, height), "white")
    y = 0
    for row in rows:
        for i, tile in enumerate(row):
            canvas.paste(tile, (i * width, y))
        y += max(t.height for t in row)
    canvas.save(out / f"sheet_{title}.jpg", quality=85)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--projects-root", required=True, type=Path)
    parser.add_argument("--bridge", required=True, type=Path)
    parser.add_argument("--outfit-dir", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--comfy", default="http://127.0.0.1:8188")
    parser.add_argument("--round", default="1", choices=["1", "2"])
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    root = args.projects_root
    tiles: dict[str, list[tuple[str, Path]]] = {p: [] for p in PERSONAS}
    tiles["空镜"] = []

    def make(persona: str, lm: str, name: str, refs: list[Path], prompt: str) -> Path:
        target = args.out / f"{persona}_{lm}_{name}.png"
        if not target.exists():
            seconds = generate(client, args.bridge, refs, prompt, target)
            print(f"{target.name} {seconds:.0f}s", flush=True)
        return target

    with httpx.Client(base_url=args.comfy, timeout=60) as client:
        print("waiting for ComfyUI to be idle...", flush=True)
        wait_idle(client, 3 * 3600)
        if args.round == "2":
            for persona, base in PERSONAS.items():
                for lm, lkey in LANDMARKS.items():
                    for name, prompt in prompts_full(lm).items():
                        path = make(persona, lm, name, [root / base, root / lkey], prompt)
                        tiles[persona].append((f"{lm} {name}", path))
            for title, items in tiles.items():
                if items:
                    sheet(args.out, f"r2_{title}", items)
            print("done", flush=True)
            return
        for persona, base in PERSONAS.items():
            for lm, lkey in LANDMARKS.items():
                variants = prompts(lm)
                for name, prompt in variants.items():
                    path = make(persona, lm, name, [root / base, root / lkey], prompt)
                    tiles[persona].append((f"{lm} {name}", path))
                outfit = args.outfit_dir / OUTFIT_IMAGES[persona]
                path = make(persona, lm, "P2o穿搭图背对", [outfit, root / lkey], variants["P2命名背对"])
                tiles[persona].append((f"{lm} P2o穿搭图背对", path))
        empty = f"{BASE}{{lm}}全景，无人物出镜，空镜，氛围宁静"
        for lm, lkey in LANDMARKS.items():
            prompt = empty.format(lm=lm)
            with_person = make("阿岚", lm, "E1带人物图", [root / PERSONAS["阿岚"], root / lkey], prompt)
            named = "图1是「" + lm + "」的实景参考图，画面中没有人物。" + prompt
            without = make("阿岚", lm, "E2不带人物图", [root / lkey], named)
            tiles["空镜"] += [(f"{lm} E1带人物图", with_person), (f"{lm} E2不带人物图", without)]
    for title, items in tiles.items():
        sheet(args.out, title, items)
    print("done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
