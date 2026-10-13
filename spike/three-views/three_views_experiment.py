"""One-off experiment: can one full-body photo become a usable front/side/back set, and does a keyframe
built from that set keep ONE person?

Not part of the product (spike/ is not linted or tested). Run on a DGX with the inference service's
Python (httpx + Pillow) against the local ComfyUI. Reads reference images only; writes to --out.
It waits for an idle ComfyUI before every job so it never jumps ahead of real tasks.

Phase `views`:     [full-body photo] -> front / side / back, 3 prompt variants x 2 personas (single-ref workflow)
Phase `keyframes`: chosen variant's three views stitched left-to-right into one sheet (scheme A), then
                   [sheet, landmark] -> keyframe (dual-ref workflow, as in production), 2 personas x 3 landmarks x 2 seeds.
                   Baseline: [original full-body photo, landmark] = today's behaviour, 1 seed.
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont

PERSONAS = {"阿岚": "persona/c_official_alan/full.jpg", "阿澄": "persona/c_official_aching/full.jpg"}
LANDMARKS = {"灵山大佛": "dest/lingshan/01.jpg", "南长街街区": "dest/nanchang/01.jpg", "泰山山景": "dest/mount-tai/01.jpg"}
TEMPLATES = {1: "1_1_SingleRef2IMG_QwenImage2_1_api.json", 2: "1_2_DualRef2IMG_QwenImage2_1_api.json"}
LOAD_NODES = {1: ["489"], 2: ["489", "491"]}
RES_NODE = {1: "491", 2: "493"}
SEEDS = [20261013, 20261014]
VIEWS = ["正面", "侧面", "背面"]

VIEW_TEXT = {
    "正面": "面向镜头正面站立",
    "侧面": "身体转向画面右侧，标准90度侧面站立",
    "背面": "背对镜头站立，完整展示背部和背包",
}
KEEP = "保持人物的脸型、发型、服装、鞋子和背包的款式与颜色完全不变"
VARIANTS = {
    "V1设定图": lambda v: f"把人物改为全身角色设定图：{VIEW_TEXT[v]}，纯白背景，人物居中，全身入镜，双臂自然下垂，{KEEP}",
    "V2命名中性": lambda v: (f"图1是人物的参考图。生成这个人物的{v}全身设定图：{VIEW_TEXT[v]}，中性站姿，"
                             f"均匀柔光，纯白背景，无任何场景和阴影，{KEEP}"),
    "V3简短": lambda v: f"同一个人，全身{v}，纯白背景",
}

SHEET_NAMING = ("图1是出镜人物的三视图设定图（从左到右依次是正面、侧面、背面，是同一个人），图2是「{lm}」的实景参考图。"
                "把图1中的这一个人物放进图2的实景中，画面里只出现一个人，不要画出设定图的拼图或多个人物，"
                "保持人物的脸、发型和服装不变，保持地标的形状与比例、清晰可辨。")
PHOTO_NAMING = ("图1是出镜人物的参考图，图2是「{lm}」的实景参考图。把图1的人物放进图2的实景中，"
                "保持人物的脸、发型和服装不变，保持地标的形状与比例、清晰可辨。")
SCENE = "9:16画幅，秋日午后柔和暖光，中景机位，人物全身入镜，站在画面右侧，约占画面高度的三分之一，侧身（四分之三侧面）望向{lm}，{lm}清晰可辨。"


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


def generate(client: httpx.Client, bridge: Path, refs: list[Path], prompt: str, seed: int, out: Path,
             aspect: str = "9:16 (Portrait Widescreen)") -> float:
    count = len(refs)
    workflow = json.loads((bridge / TEMPLATES[count]).read_text())
    for node, ref in zip(LOAD_NODES[count], refs):
        workflow[node]["inputs"]["image"] = upload(client, ref)
    workflow["469"]["inputs"]["prompt"] = prompt
    workflow[RES_NODE[count]]["inputs"]["aspect_ratio"] = aspect
    workflow[RES_NODE[count]]["inputs"]["megapixels"] = 1.0
    workflow["474"]["inputs"]["seed"] = seed
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


def font():
    for path in ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"):
        if Path(path).exists():
            return ImageFont.truetype(path, 16)
    return ImageFont.load_default()


def contact_sheet(target: Path, tiles: list[tuple[str, Path]], columns: int, width: int = 240) -> None:
    images = []
    for label, path in tiles:
        image = Image.open(path).convert("RGB")
        image = image.resize((width, int(image.height * width / image.width)))
        tile = Image.new("RGB", (width, image.height + 22), "white")
        tile.paste(image, (0, 22))
        ImageDraw.Draw(tile).text((3, 2), label, fill="black", font=font())
        images.append(tile)
    rows = [images[i:i + columns] for i in range(0, len(images), columns)]
    canvas = Image.new("RGB", (columns * width, sum(max(t.height for t in row) for row in rows)), "white")
    y = 0
    for row in rows:
        for i, tile in enumerate(row):
            canvas.paste(tile, (i * width, y))
        y += max(t.height for t in row)
    canvas.save(target, quality=82)


def stitch(paths: list[Path], target: Path) -> None:
    """Scheme A: front | side | back on one canvas, equal height, white gutter."""
    images = [Image.open(p).convert("RGB") for p in paths]
    height = max(i.height for i in images)
    images = [i.resize((int(i.width * height / i.height), height)) for i in images]
    canvas = Image.new("RGB", (sum(i.width for i in images), height), "white")
    x = 0
    for image in images:
        canvas.paste(image, (x, 0))
        x += image.width
    canvas.save(target, quality=92)


def run_views(client, args) -> None:
    tiles: dict[str, list[tuple[str, Path]]] = {p: [] for p in PERSONAS}
    for persona, base in PERSONAS.items():
        for variant, make in VARIANTS.items():
            for view in VIEWS:
                target = args.out / f"views_{persona}_{variant}_{view}.png"
                if not target.exists():
                    seconds = generate(client, args.bridge, [args.projects_root / base], make(view), SEEDS[0], target)
                    print(f"{target.name} {seconds:.0f}s", flush=True)
                tiles[persona].append((f"{variant} {view}", target))
    for persona, items in tiles.items():
        contact_sheet(args.out / f"sheet_views_{persona}.jpg", items, columns=3)


def run_keyframes(client, args) -> None:
    tiles: dict[str, list[tuple[str, Path]]] = {p: [] for p in PERSONAS}
    for persona, base in PERSONAS.items():
        views = [args.out / f"views_{persona}_{args.variant}_{v}.png" for v in VIEWS]
        sheet = args.out / f"setsheet_{persona}_{args.variant}.jpg"
        stitch(views, sheet)
        print(f"{sheet.name} {Image.open(sheet).size}", flush=True)
        for lm, lkey in LANDMARKS.items():
            landmark = args.projects_root / lkey
            for index, seed in enumerate(SEEDS):
                target = args.out / f"kf_A_{persona}_{lm}_s{index}.png"
                if not target.exists():
                    prompt = SHEET_NAMING.format(lm=lm) + SCENE.format(lm=lm)
                    seconds = generate(client, args.bridge, [sheet, landmark], prompt, seed, target)
                    print(f"{target.name} {seconds:.0f}s", flush=True)
                tiles[persona].append((f"A设定图 {lm} s{index}", target))
            target = args.out / f"kf_base_{persona}_{lm}.png"
            if not target.exists():
                prompt = PHOTO_NAMING.format(lm=lm) + SCENE.format(lm=lm)
                seconds = generate(client, args.bridge, [args.projects_root / base, landmark], prompt, SEEDS[0], target)
                print(f"{target.name} {seconds:.0f}s", flush=True)
            tiles[persona].append((f"对照 现状 {lm}", target))
    for persona, items in tiles.items():
        contact_sheet(args.out / f"sheet_kf_{persona}.jpg", items, columns=3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["views", "keyframes"])
    parser.add_argument("--projects-root", required=True, type=Path)
    parser.add_argument("--bridge", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--variant", default="V1设定图", choices=list(VARIANTS))
    parser.add_argument("--comfy", default="http://127.0.0.1:8188")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=args.comfy, timeout=60) as client:
        print("waiting for ComfyUI to be idle...", flush=True)
        wait_idle(client, 3 * 3600)
        (run_views if args.phase == "views" else run_keyframes)(client, args)
    print("done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
