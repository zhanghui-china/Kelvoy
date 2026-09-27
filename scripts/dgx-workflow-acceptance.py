"""Run isolated ComfyUI video contract checks on the target host.

Uses local test images and writes only to ComfyUI's normal input/output plus --output.
The caller must ensure the queue is idle and use an isolated output directory.
"""

import argparse
import json
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from copy import deepcopy
from fractions import Fraction
from pathlib import Path


def get_json(base, route):
    with urllib.request.urlopen(base + route, timeout=30) as response:
        return json.load(response)


def upload(base, path):
    boundary = "kelvoy-" + uuid.uuid4().hex
    name = "audit_" + uuid.uuid4().hex + path.suffix.lower()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
        f"filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n"
    ).encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        base + "/upload/image", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)["name"]


def workflow(template, kind, images, aspect, seed):
    graph = deepcopy(template)
    if kind == "direct":
        graph["7"]["inputs"]["image"] = images[0]
        graph["92"]["inputs"]["image"] = images[1]
        graph["77"]["inputs"]["prompt"] = "A calm landscape, gentle camera movement"
        graph["76"]["inputs"]["value"] = 3
        graph["82"]["inputs"]["aspect_ratio"] = (
            "9:16 (Portrait Widescreen)" if aspect == "9:16" else "16:9 (Widescreen)"
        )
        graph["82"]["inputs"]["megapixels"] = 0.9
    else:
        graph["7"]["inputs"]["image"] = images[0]
        graph["74"]["inputs"]["prompt"] = "A calm landscape, gentle camera movement"
        graph["71"]["inputs"]["value"] = 3
        graph["9"]["inputs"]["scale_to_length"] = 480
        graph["9"]["inputs"]["scale_to_side"] = "shortest"
    graph["49"]["inputs"]["seed"] = seed
    graph["49"]["inputs"]["control_after_generate"] = "fixed"
    return graph


def assert_aspect(width, height, aspect):
    target = 9 / 16 if aspect == "9:16" else 16 / 9
    if abs(width / height - target) > 0.15:
        raise RuntimeError(f"expected {aspect}, got {width}x{height}")


def assert_keyframe_aspect(path, aspect):
    with path.open("rb") as image:
        header = image.read(24)
    if path.suffix.lower() != ".png" or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("keyframe input must be a PNG")
    assert_aspect(*struct.unpack(">II", header[16:24]), aspect)


def verify_video(path, aspect):
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,avg_frame_rate", "-show_entries", "format=duration",
        "-of", "json", str(path),
    ], check=True, capture_output=True, text=True)
    media = json.loads(probe.stdout)
    stream = media["streams"][0]
    assert_aspect(stream["width"], stream["height"], aspect)
    if not 2.5 <= float(media["format"]["duration"]) <= 3.5:
        raise RuntimeError("video duration is outside the 3 second contract")
    if Fraction(stream["avg_frame_rate"]) <= 0 or path.stat().st_size == 0:
        raise RuntimeError("video has no decodable frames")
    return media


def cancel_prompt(base, prompt_id):
    request = urllib.request.Request(base + f"/api/jobs/{prompt_id}/cancel",
                                     data=b"", method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            confirmation = json.load(response)
            if not isinstance(confirmation, dict) or confirmation.get("cancelled") is not True:
                print(f"warning: ComfyUI did not confirm cancellation for {prompt_id}",
                      file=sys.stderr)
    except (OSError, ValueError) as error:
        print(f"warning: could not cancel {prompt_id}: {error}", file=sys.stderr)


def await_video(args, prompt_id, started):
    while time.monotonic() - started < args.timeout:
        history = get_json(args.base, "/history/" + prompt_id).get(prompt_id)
        if history:
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status, ensure_ascii=False))
            if status.get("status_str") != "success" or status.get("completed") is not True:
                time.sleep(5)
                continue
            for node in history.get("outputs", {}).values():
                for key in ("videos", "gifs"):
                    if not node.get(key):
                        continue
                    item = node[key][0]
                    query = urllib.parse.urlencode({
                        "filename": item["filename"], "subfolder": item.get("subfolder", ""),
                        "type": item.get("type", "output"),
                    })
                    with urllib.request.urlopen(
                        args.base + "/view?" + query, timeout=180
                    ) as response:
                        args.output.parent.mkdir(parents=True, exist_ok=True)
                        args.output.write_bytes(response.read())
                    media = verify_video(args.output, args.aspect)
                    print(json.dumps({"prompt_id": prompt_id, "state": "done",
                                      "seconds": round(time.monotonic() - started, 1),
                                      "bytes": args.output.stat().st_size,
                                      "media": media}), flush=True)
                    return
        time.sleep(5)
    raise TimeoutError(f"prompt {prompt_id} did not finish within {args.timeout} seconds")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bridge", type=Path, required=True)
    parser.add_argument("--image", type=Path, action="append", required=True)
    parser.add_argument("--kind", choices=("direct", "keyframe"), required=True)
    parser.add_argument("--aspect", choices=("9:16", "16:9"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base", default="http://127.0.0.1:8188")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--seed", type=int, default=20260927)
    args = parser.parse_args()
    if len(args.image) < (2 if args.kind == "direct" else 1):
        parser.error("not enough --image inputs")
    if args.kind == "keyframe":
        assert_keyframe_aspect(args.image[0], args.aspect)
    queue = get_json(args.base, "/queue")
    if queue["queue_running"] or queue["queue_pending"]:
        raise RuntimeError("ComfyUI queue is busy")
    uploaded = [upload(args.base, path) for path in args.image]
    template_name = (
        "2_2_DualRef2Video_MinimaxH3_api.json" if args.kind == "direct"
        else "2_0_Image2Video_MinimaxH3_api.json"
    )
    graph = workflow(json.loads((args.bridge / template_name).read_text()), args.kind,
                     uploaded, args.aspect, args.seed)
    request = urllib.request.Request(
        args.base + "/prompt",
        data=json.dumps({"prompt": graph, "client_id": uuid.uuid4().hex}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode(errors="replace")) from error
    prompt_id = result["prompt_id"]
    print(json.dumps({"prompt_id": prompt_id, "state": "queued", "kind": args.kind,
                      "aspect": args.aspect}), flush=True)
    started = time.monotonic()
    try:
        await_video(args, prompt_id, started)
    except Exception:
        cancel_prompt(args.base, prompt_id)
        raise


if __name__ == "__main__":
    main()
