"""Run one reproducible ComfyUI workflow without exposing a model endpoint."""

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from copy import deepcopy
from pathlib import Path


def prepare_image(template, persona_image, landmark_image, prompt, seed):
    workflow = deepcopy(template)
    workflow["489"]["inputs"]["image"] = persona_image
    workflow["491"]["inputs"]["image"] = landmark_image
    workflow["469"]["inputs"]["prompt"] = prompt
    workflow["493"]["inputs"]["aspect_ratio"] = "9:16 (Portrait Widescreen)"
    workflow["493"]["inputs"]["megapixels"] = 1.0
    workflow["474"]["inputs"]["seed"] = seed
    workflow["474"]["inputs"]["control_after_generate"] = "fixed"
    return workflow


def prepare_video(template, first_frame, prompt, duration, seed, shortest_side):
    workflow = deepcopy(template)
    workflow["7"]["inputs"]["image"] = first_frame
    workflow["74"]["inputs"]["prompt"] = prompt
    workflow["71"]["inputs"]["value"] = duration
    workflow["9"]["inputs"]["scale_to_length"] = shortest_side
    workflow["9"]["inputs"]["scale_to_side"] = "shortest"
    workflow["49"]["inputs"]["seed"] = seed
    workflow["49"]["inputs"]["control_after_generate"] = "fixed"
    return workflow


def get_json(base, route):
    with urllib.request.urlopen(base + route, timeout=30) as response:
        return json.load(response)


def run(base, workflow, output, timeout):
    queue = get_json(base, "/queue")
    if queue["queue_running"] or queue["queue_pending"]:
        raise RuntimeError("ComfyUI queue is busy; retry when idle")

    client_id = str(uuid.uuid4())
    body = json.dumps({"prompt": workflow, "client_id": client_id}).encode()
    request = urllib.request.Request(
        base + "/prompt", data=body, headers={"Content-Type": "application/json"}
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            submitted = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode(errors="replace")) from error
    prompt_id = submitted["prompt_id"]
    print(json.dumps({"prompt_id": prompt_id, "state": "queued"}), flush=True)

    while time.monotonic() - started < timeout:
        history = get_json(base, "/history/" + prompt_id).get(prompt_id)
        if history:
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status, ensure_ascii=False))
            for node in history.get("outputs", {}).values():
                for key in ("images", "videos", "gifs"):
                    if not node.get(key):
                        continue
                    item = node[key][0]
                    query = urllib.parse.urlencode(
                        {
                            "filename": item["filename"],
                            "subfolder": item.get("subfolder", ""),
                            "type": item.get("type", "output"),
                        }
                    )
                    with urllib.request.urlopen(base + "/view?" + query, timeout=180) as response:
                        output.parent.mkdir(parents=True, exist_ok=True)
                        output.write_bytes(response.read())
                    return {
                        "prompt_id": prompt_id,
                        "output": str(output),
                        "seconds": round(time.monotonic() - started, 1),
                        "bytes": output.stat().st_size,
                    }
        time.sleep(3)
    raise TimeoutError(f"prompt {prompt_id} did not finish within {timeout} seconds")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("image", "video"), required=True)
    parser.add_argument("--bridge", type=Path, required=True)
    parser.add_argument("--input1", required=True)
    parser.add_argument("--input2")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260925)
    parser.add_argument("--duration", type=int, default=5)
    parser.add_argument("--shortest-side", type=int, default=480)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--base", default="http://127.0.0.1:8188")
    args = parser.parse_args()

    if args.kind == "image":
        if not args.input2:
            parser.error("--input2 is required for the dual-reference image workflow")
        filename = "1_2_DualRef2IMG_QwenImage2_1_api.json"
        template = json.loads((args.bridge / filename).read_text())
        workflow = prepare_image(template, args.input1, args.input2, args.prompt, args.seed)
    else:
        filename = "2_0_Image2Video_MinimaxH3_api.json"
        template = json.loads((args.bridge / filename).read_text())
        workflow = prepare_video(
            template, args.input1, args.prompt, args.duration, args.seed, args.shortest_side
        )

    result = run(args.base, workflow, args.output, args.timeout)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
