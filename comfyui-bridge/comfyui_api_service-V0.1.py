# -*- coding: utf-8 -*-
"""
ComfyUI Unified Multi-Modal API Service
=======================================
统一的 ComfyUI HTTP 中间件桥接服务，支持：
1. Qwen-Image 2.1 文生图 (/api/text2img)
2. Qwen-Image 2.1 单图编辑 (/api/edit, /api/image/edit)
3. Qwen-Image 2.1 2/3/4/9 图融合/编辑 (/api/blend, /api/triple_blend, /api/quad_blend, /api/nona_blend, /api/image/multi_edit)
4. Minimax-H3 图生视频 (/api/video/image2video, /api/image2video)
5. Minimax-H3 1/2/3/4/9 多图参考生视频 (/api/video/single_ref, /api/video/dual_ref, /api/video/tri_ref, /api/video/quad_ref, /api/video/nona_ref, /api/video/multi_ref)
6. Minimax-H3 视频编辑/图+视频生视频 (/api/video/edit, /api/video/video_edit, /api/video/image_video2video)
7. Minimax-H3 数字人/图+音频生视频 (/api/video/digital_human, /api/video/image_audio2video)
8. ACE STEP 1.5XL 音乐生成 (/api/music, /api/music/acestep)
9. 健康检查与接口规范 (/health, /)

启动方式:
    python comfyui_api_service.py

环境变量配置:
    COMFYUI_SERVER: ComfyUI 服务器地址 (默认: 127.0.0.1:8188)
    COMFYUI_INPUT_DIR: ComfyUI 输入目录 (默认: ./input)
    SERVICE_HOST: 服务监听地址 (默认: 0.0.0.0)
    SERVICE_PORT: 服务监听端口 (默认: 6000)
    GENERATION_TIMEOUT: 生成超时时间(秒) (默认: 600)
"""

import json
import uuid
import websocket
import requests
import os
import time
import random
from io import BytesIO
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename

# ==================== 配置区域 ====================

SERVER_ADDRESS = os.environ.get("COMFYUI_SERVER", "127.0.0.1:8188")
COMFYUI_INPUT_DIR = os.environ.get("COMFYUI_INPUT_DIR", "./input")
OUTPUT_IMAGE_DIR = os.environ.get("OUTPUT_IMAGE_DIR", "./output_image")
OUTPUT_VIDEO_DIR = os.environ.get("OUTPUT_VIDEO_DIR", "./output_video")
OUTPUT_AUDIO_DIR = os.environ.get("OUTPUT_AUDIO_DIR", "./output_audio")
GENERATION_TIMEOUT = int(os.environ.get("GENERATION_TIMEOUT", "600"))
HOST = os.environ.get("SERVICE_HOST", "0.0.0.0")
PORT = int(os.environ.get("SERVICE_PORT", "6000"))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

WORKFLOW_CONFIG = {
    # 图像类 (Qwen-Image 2.1)
    "text2img": {
        "template": os.path.join(BASE_DIR, "1_0_Text2IMG_QwenImge2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_0_Text2IMG_QwenImge2_1.json"),
        "type": "image"
    },
    "edit": {
        "template": os.path.join(BASE_DIR, "1_1_SingleRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_1_SingleRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "dual_blend": {
        "template": os.path.join(BASE_DIR, "1_2_DualRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_2_DualRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "tri_blend": {
        "template": os.path.join(BASE_DIR, "1_3_TriRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_3_TriRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "quad_blend": {
        "template": os.path.join(BASE_DIR, "1_4_QuadRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_4_QuadRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "nona_blend": {
        "template": os.path.join(BASE_DIR, "1_9_NonaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_9_NonaRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },

    # 视频类 (Minimax-H3)
    "image2video": {
        "template": os.path.join(BASE_DIR, "2_0_Image2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_0_Image2Video_MinimaxH3.json"),
        "type": "video"
    },
    "single_ref2video": {
        "template": os.path.join(BASE_DIR, "2_1_SingleRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_1_SingleRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "dual_ref2video": {
        "template": os.path.join(BASE_DIR, "2_2_DualRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_2_DualRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "tri_ref2video": {
        "template": os.path.join(BASE_DIR, "2_3_TriRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_3_TriRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "quad_ref2video": {
        "template": os.path.join(BASE_DIR, "2_4_QuadRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_4_QuadRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "nona_ref2video": {
        "template": os.path.join(BASE_DIR, "2_9_NonaRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_9_NonaRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "video_edit": {
        "template": os.path.join(BASE_DIR, "2_10_ImageVideo2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_10_ImageVideo2Video_MinimaxH3.json"),
        "type": "video"
    },
    "digital_human": {
        "template": os.path.join(BASE_DIR, "2_11_ImageAudio2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_11_ImageAudio2Video_MinimaxH3.json"),
        "type": "video"
    },

    # 音乐类 (ACE STEP 1.5XL)
    "music": {
        "template": os.path.join(BASE_DIR, "3_1_Text2Music_ACESTEP_api.json"),
        "ui_template": os.path.join(BASE_DIR, "3_1_Text2Music_ACESTEP.json"),
        "type": "audio"
    }
}

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB 支持长视频/音频上传


def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)


def clean_workflow(workflow):
    """清理 workflow 中的前端元数据"""
    cleaned = {}
    for node_id, node_data in workflow.items():
        clean_node = {}
        for k, v in node_data.items():
            if k == "_meta":
                continue
            clean_node[k] = v
        cleaned[str(node_id)] = clean_node
    return cleaned


def convert_ui_to_api_workflow(data):
    """将 ComfyUI UI 格式工作流 (nodes, links) 转换为 API Prompt 格式"""
    if "nodes" not in data:
        return clean_workflow(data)

    links = {link[0]: link for link in data.get('links', [])}
    prompt = {}
    for node in data.get('nodes', []):
        node_id = str(node['id'])
        node_type = node.get('type')
        if not node_type:
            continue
        inputs = {}
        if 'widgets_values_named' in node and isinstance(node['widgets_values_named'], dict):
            inputs.update(node['widgets_values_named'])
        for inp in node.get('inputs', []):
            name = inp.get('name')
            link_id = inp.get('link')
            if link_id is not None and link_id in links:
                link_data = links[link_id]
                origin_id = str(link_data[1])
                origin_slot = link_data[2]
                inputs[name] = [origin_id, origin_slot]
        prompt[node_id] = {
            'class_type': node_type,
            'inputs': inputs
        }
    return prompt


def load_workflow_template(workflow_type):
    """加载工作流模板并确保为 API 格式"""
    config = WORKFLOW_CONFIG.get(workflow_type)
    if not config:
        raise ValueError(f"Unknown workflow type: {workflow_type}")

    api_path = config.get("template")
    ui_path = config.get("ui_template")

    if api_path and os.path.exists(api_path):
        with open(api_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return clean_workflow(data)
    elif ui_path and os.path.exists(ui_path):
        with open(ui_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return convert_ui_to_api_workflow(data)
    else:
        raise FileNotFoundError(f"Workflow template not found for {workflow_type}: {api_path} or {ui_path}")


def queue_prompt(prompt, client_id):
    """向 ComfyUI 提交任务"""
    p = {"prompt": prompt, "client_id": client_id}
    data = json.dumps(p, ensure_ascii=False).encode('utf-8')
    headers = {"Content-Type": "application/json"}
    resp = requests.post(
        f"http://{SERVER_ADDRESS}/prompt",
        data=data,
        headers=headers,
        timeout=30
    )
    resp.raise_for_status()
    return resp.json()


def get_history(prompt_id):
    """查询任务执行结果历史"""
    resp = requests.get(f"http://{SERVER_ADDRESS}/history/{prompt_id}", timeout=30)
    resp.raise_for_status()
    return resp.json()


def download_file(filename, subfolder, file_type):
    """从 ComfyUI 获取生成的文件二进制流"""
    view_url = f"http://{SERVER_ADDRESS}/view?filename={filename}&subfolder={subfolder}&type={file_type}"
    resp = requests.get(view_url, timeout=180)
    resp.raise_for_status()
    return resp.content


def upload_to_comfyui(file_obj, filename=None):
    """上传文件 (图片/视频/音频) 到 ComfyUI 内部存储"""
    upload_url = f"http://{SERVER_ADDRESS}/upload/image"
    name = filename or secure_filename(file_obj.filename)
    files = {"image": (name, file_obj.stream if hasattr(file_obj, 'stream') else file_obj, "application/octet-stream")}
    resp = requests.post(upload_url, files=files, timeout=60)
    resp.raise_for_status()
    result = resp.json()
    return result["name"]


def wait_for_completion(ws, prompt_id, timeout=GENERATION_TIMEOUT):
    """通过 WebSocket 监听任务执行完成"""
    start_time = time.time()
    while True:
        if time.time() - start_time > timeout:
            raise TimeoutError(f"Task execution timed out after {timeout} seconds")
        try:
            out = ws.recv()
        except Exception as e:
            raise ConnectionError(f"WebSocket error: {e}")

        if isinstance(out, str):
            message = json.loads(out)
            msg_type = message.get('type')
            if msg_type == 'executing':
                data = message.get('data', {})
                if data.get('node') is None and data.get('prompt_id') == prompt_id:
                    return True
            elif msg_type == 'execution_error':
                data = message.get('data', {})
                if data.get('prompt_id') == prompt_id:
                    err_msg = data.get('exception_message', 'Unknown execution error')
                    node_id = data.get('node_id', 'Unknown')
                    raise RuntimeError(f"ComfyUI execution error at Node #{node_id}: {err_msg}")


def execute_and_fetch_output(workflow, client_id, expected_types=('images', 'videos', 'gifs', 'audio')):
    """核心执行与产物检索函数"""
    ws = websocket.WebSocket()
    try:
        ws.connect(f"ws://{SERVER_ADDRESS}/ws?clientId={client_id}", timeout=10)
        result = queue_prompt(workflow, client_id)
        prompt_id = result.get('prompt_id')
        if not prompt_id:
            raise RuntimeError(f"Failed to queue prompt: {result}")

        print(f"[{prompt_id}] Task queued, waiting for ComfyUI...")
        wait_for_completion(ws, prompt_id)
        print(f"[{prompt_id}] Execution finished, fetching results...")

        history = get_history(prompt_id)
        prompt_history = history.get(prompt_id, {})
        outputs = prompt_history.get('outputs', {})

        if not outputs:
            raise RuntimeError("No outputs found in task history")

        for node_id, node_output in outputs.items():
            for media_key in expected_types:
                if media_key in node_output and node_output[media_key]:
                    item = node_output[media_key][0]
                    filename = item['filename']
                    subfolder = item.get('subfolder', '')
                    item_type = item.get('type', 'output')
                    data = download_file(filename, subfolder, item_type)
                    print(f"[{prompt_id}] Downloaded {media_key} output: {filename}")
                    return data, filename

        raise RuntimeError(f"No media output found matching {expected_types} in workflow execution")
    finally:
        ws.close()


# ==================== 各模态业务逻辑 ====================

def run_image_workflow(workflow_type, image_filenames, prompt_text, aspect_ratio="3:4 (Portrait Standard)", seed=None, steps=25, cfg=1.0, negative_prompt="", megapixels=1.0):
    """
    Qwen-Image 2.1 文生图与图像编辑
    
    像素/分辨率推荐 (megapixels):
        - 首选推荐: 1.0 (平衡度最高、构图稳定、显存友好)
        - 细节增强: 2.0 (微距特写、复杂纹理细节丰富)
        - 折衷推荐: 1.5 (速度与细节兼顾)
        - 不建议: < 1.0 (易出现模糊与涂抹) 或 > 2.0 (易导致畸变与显存激增)
    """
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template(workflow_type)
    actual_seed = seed if seed is not None else random.randint(1, 10**15)

    # 注入采样参数 (Node 474 KSampler)
    if "474" in workflow and "inputs" in workflow["474"]:
        workflow["474"]["inputs"]["seed"] = actual_seed
        if steps is not None:
            workflow["474"]["inputs"]["steps"] = int(steps)
        if cfg is not None:
            workflow["474"]["inputs"]["cfg"] = float(cfg)

    # 注入提示词 (Node 469 TextEncodeQwenImage21)
    if "469" in workflow and "inputs" in workflow["469"]:
        workflow["469"]["inputs"]["prompt"] = prompt_text
        if negative_prompt is not None:
            workflow["469"]["inputs"]["negative_prompt"] = negative_prompt

    # 各工作流特定映射
    if workflow_type == "text2img":
        if "492" in workflow and "inputs" in workflow["492"]:
            workflow["492"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["492"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "edit":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        if "491" in workflow and "inputs" in workflow["491"]:
            workflow["491"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["491"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "dual_blend":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        workflow["491"]["inputs"]["image"] = image_filenames[1]
        if "493" in workflow and "inputs" in workflow["493"]:
            workflow["493"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["493"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "tri_blend":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        workflow["491"]["inputs"]["image"] = image_filenames[1]
        workflow["493"]["inputs"]["image"] = image_filenames[2]
        if "494" in workflow and "inputs" in workflow["494"]:
            workflow["494"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["494"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "quad_blend":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        workflow["493"]["inputs"]["image"] = image_filenames[1]
        workflow["494"]["inputs"]["image"] = image_filenames[2]
        workflow["495"]["inputs"]["image"] = image_filenames[3]
        if "491" in workflow and "inputs" in workflow["491"]:
            workflow["491"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["491"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "nona_blend":
        nona_nodes = ["489", "491", "493", "494", "495", "496", "497", "498", "499"]
        for idx, nid in enumerate(nona_nodes):
            if idx < len(image_filenames):
                workflow[nid]["inputs"]["image"] = image_filenames[idx]
        if "501" in workflow and "inputs" in workflow["501"]:
            workflow["501"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["501"]["inputs"]["megapixels"] = float(megapixels)
    else:
        raise ValueError(f"Unknown image workflow type: {workflow_type}")

    img_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('images',))

    if OUTPUT_IMAGE_DIR and os.path.exists(OUTPUT_IMAGE_DIR):
        try:
            with open(os.path.join(OUTPUT_IMAGE_DIR, output_filename), "wb") as f:
                f.write(img_data)
        except Exception as e:
            print(f"Warning: Failed to save copy in {OUTPUT_IMAGE_DIR}: {e}")

    return img_data, output_filename


def run_video_workflow(workflow_type, params):
    """
    Minimax-H3 视频生成/参考生视频/编辑/数字人
    
    参数与建议:
        - scale_to_length (image2video & video_edit): 按最短边缩放长宽。首选推荐 704 (默认)，快速模式 480，最高上限 768，不建议 > 768。
        - megapixels (ref2video & digital_human): 分辨率选择器百万像素。首选建议 0.9，快速模式 0.4，不建议超出 [0.4, 0.9] 范围。
        - duration: 生成时长(秒)。默认 15 秒，建议范围 [3.0, 15.0] 秒 (注意: video_edit 无需设置时长)。
    """
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template(workflow_type)
    seed = params.get("seed") or random.randint(1, 10**15)

    # 注入采样参数 (Node 49 KSampler)
    if "49" in workflow and "inputs" in workflow["49"]:
        workflow["49"]["inputs"]["seed"] = seed
        if "steps" in params and params["steps"] is not None:
            workflow["49"]["inputs"]["steps"] = int(params["steps"])

    # 1. 图生视频 (Image2Video)
    if workflow_type == "image2video":
        workflow["7"]["inputs"]["image"] = params["image"]
        if "prompt" in params and params["prompt"]:
            workflow["74"]["inputs"]["prompt"] = params["prompt"]

        # 画面缩放 (Node 9 LayerUtility: ImageScaleByAspectRatio V2)
        # 按照最短边 (scale_to_side="shortest") 缩放:
        # 首选推荐: 704 (默认), 快速模式: 480, 最高上限: 768 (需要更多时间), 不建议超过 768
        if "9" in workflow and "inputs" in workflow["9"]:
            scale_len = int(params.get("scale_to_length", 704))
            scale_side = params.get("scale_to_side", "shortest")
            workflow["9"]["inputs"]["scale_to_length"] = scale_len
            workflow["9"]["inputs"]["scale_to_side"] = scale_side

        # 生成时长 (Node 71 PrimitiveInt 控制秒数 -> Node 81 MathExpression 计算帧数)
        # 默认 15 秒，建议范围 [3.0, 15.0] 秒
        if "duration" in params and params["duration"] is not None:
            dur = float(params["duration"])
            if "71" in workflow and "inputs" in workflow["71"]:
                workflow["71"]["inputs"]["value"] = int(round(dur))
        elif "length" in params and params["length"]:
            workflow["74"]["inputs"]["length"] = int(params["length"])

    # 2. 单图参考生视频 (Single Ref to Video)
    elif workflow_type == "single_ref2video":
        workflow["7"]["inputs"]["image"] = params["image"]
        if "prompt" in params and params["prompt"]:
            workflow["77"]["inputs"]["prompt"] = params["prompt"]
        if "duration" in params and params["duration"] is not None and "76" in workflow and "inputs" in workflow["76"]:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        elif "length" in params and params["length"]:
            workflow["77"]["inputs"]["length"] = int(params["length"])
        if "82" in workflow and "inputs" in workflow["82"]:
            if "aspect_ratio" in params and params["aspect_ratio"]:
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if "megapixels" in params and params["megapixels"] is not None:
                workflow["82"]["inputs"]["megapixels"] = float(params["megapixels"])

    # 3. 双图参考生视频 (Dual Ref to Video)
    elif workflow_type == "dual_ref2video":
        workflow["7"]["inputs"]["image"] = params["image1"]
        workflow["92"]["inputs"]["image"] = params["image2"]
        if "prompt" in params and params["prompt"]:
            workflow["77"]["inputs"]["prompt"] = params["prompt"]
        if "duration" in params and params["duration"] is not None and "76" in workflow and "inputs" in workflow["76"]:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        elif "length" in params and params["length"]:
            workflow["77"]["inputs"]["length"] = int(params["length"])
        if "82" in workflow and "inputs" in workflow["82"]:
            if "aspect_ratio" in params and params["aspect_ratio"]:
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if "megapixels" in params and params["megapixels"] is not None:
                workflow["82"]["inputs"]["megapixels"] = float(params["megapixels"])

    # 4. 三图参考生视频 (Tri Ref to Video)
    elif workflow_type == "tri_ref2video":
        workflow["7"]["inputs"]["image"] = params["image1"]
        workflow["92"]["inputs"]["image"] = params["image2"]
        workflow["93"]["inputs"]["image"] = params["image3"]
        if "prompt" in params and params["prompt"]:
            workflow["77"]["inputs"]["prompt"] = params["prompt"]
        if "duration" in params and params["duration"] is not None and "76" in workflow and "inputs" in workflow["76"]:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        elif "length" in params and params["length"]:
            workflow["77"]["inputs"]["length"] = int(params["length"])
        if "82" in workflow and "inputs" in workflow["82"]:
            if "aspect_ratio" in params and params["aspect_ratio"]:
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if "megapixels" in params and params["megapixels"] is not None:
                workflow["82"]["inputs"]["megapixels"] = float(params["megapixels"])

    # 5. 四图参考生视频 (Quad Ref to Video)
    elif workflow_type == "quad_ref2video":
        workflow["7"]["inputs"]["image"] = params["image1"]
        workflow["92"]["inputs"]["image"] = params["image2"]
        workflow["93"]["inputs"]["image"] = params["image3"]
        workflow["94"]["inputs"]["image"] = params["image4"]
        if "prompt" in params and params["prompt"]:
            workflow["77"]["inputs"]["prompt"] = params["prompt"]
        if "duration" in params and params["duration"] is not None and "76" in workflow and "inputs" in workflow["76"]:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        elif "length" in params and params["length"]:
            workflow["77"]["inputs"]["length"] = int(params["length"])
        if "82" in workflow and "inputs" in workflow["82"]:
            if "aspect_ratio" in params and params["aspect_ratio"]:
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if "megapixels" in params and params["megapixels"] is not None:
                workflow["82"]["inputs"]["megapixels"] = float(params["megapixels"])

    # 6. 九图参考生视频 (Nona Ref to Video)
    elif workflow_type == "nona_ref2video":
        nona_nodes = ["7", "92", "93", "94", "95", "96", "98", "99", "100"]
        for idx, nid in enumerate(nona_nodes):
            key = f"image{idx+1}"
            if key in params:
                workflow[nid]["inputs"]["image"] = params[key]
        if "prompt" in params and params["prompt"]:
            workflow["77"]["inputs"]["prompt"] = params["prompt"]
        if "duration" in params and params["duration"] is not None and "76" in workflow and "inputs" in workflow["76"]:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        elif "length" in params and params["length"]:
            workflow["77"]["inputs"]["length"] = int(params["length"])
        if "82" in workflow and "inputs" in workflow["82"]:
            if "aspect_ratio" in params and params["aspect_ratio"]:
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if "megapixels" in params and params["megapixels"] is not None:
                workflow["82"]["inputs"]["megapixels"] = float(params["megapixels"])

    # 7. 视频编辑 (图+视频生视频)
    elif workflow_type == "video_edit":
        workflow["7"]["inputs"]["image"] = params["image"]
        workflow["101"]["inputs"]["video"] = params["video"]
        if "prompt" in params and params["prompt"]:
            workflow["77"]["inputs"]["prompt"] = params["prompt"]
        if "length" in params and params["length"]:
            workflow["77"]["inputs"]["length"] = int(params["length"])

        # 画面缩放 (Node 102 LayerUtility: ImageScaleByAspectRatio V2)
        # 按照最短边 (scale_to_side="shortest") 缩放:
        # 首选推荐: 704 (默认), 快速模式: 480, 最高上限: 768, 不建议超过 768
        # 注意: 视频编辑无需设置视频时长，时长继承自源视频
        if "102" in workflow and "inputs" in workflow["102"]:
            scale_len = int(params.get("scale_to_length", 704))
            scale_side = params.get("scale_to_side", "shortest")
            workflow["102"]["inputs"]["scale_to_length"] = scale_len
            workflow["102"]["inputs"]["scale_to_side"] = scale_side

    # 8. 数字人 (图+音频生视频)
    elif workflow_type == "digital_human":
        workflow["7"]["inputs"]["image"] = params["image"]
        workflow["104"]["inputs"]["audio"] = params["audio"]
        if "prompt" in params and params["prompt"]:
            workflow["103"]["inputs"]["prompt"] = params["prompt"]
        if "length" in params and params["length"]:
            workflow["103"]["inputs"]["length"] = int(params["length"])
        if "duration" in params and params["duration"] is not None:
            dur = float(params["duration"])
            # Node 109 PrimitiveFloat 控制音频截取与视频总帧数 (默认15s，建议3-15s)
            if "109" in workflow and "inputs" in workflow["109"]:
                workflow["109"]["inputs"]["value"] = dur
            elif "105" in workflow and "inputs" in workflow["105"]:
                workflow["105"]["inputs"]["duration"] = dur
        if "112" in workflow and "inputs" in workflow["112"]:
            if "aspect_ratio" in params and params["aspect_ratio"]:
                workflow["112"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if "megapixels" in params and params["megapixels"] is not None:
                workflow["112"]["inputs"]["megapixels"] = float(params["megapixels"])

    else:
        raise ValueError(f"Unknown video workflow type: {workflow_type}")

    video_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('gifs', 'videos'))

    if OUTPUT_VIDEO_DIR and os.path.exists(OUTPUT_VIDEO_DIR):
        try:
            with open(os.path.join(OUTPUT_VIDEO_DIR, output_filename), "wb") as f:
                f.write(video_data)
        except Exception as e:
            print(f"Warning: Failed to save copy in {OUTPUT_VIDEO_DIR}: {e}")

    return video_data, output_filename


def run_music_workflow(params):
    """ACE STEP 1.5XL 音乐生成"""
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template("music")
    seed = params.get("seed") or random.randint(1, 10**15)

    if "32" in workflow and "inputs" in workflow["32"]:
        workflow["32"]["inputs"]["seed"] = seed
        if "steps" in params and params["steps"] is not None:
            workflow["32"]["inputs"]["steps"] = int(params["steps"])

    # Node 36: TextEncodeAceStepAudio1.5
    if "36" in workflow and "inputs" in workflow["36"]:
        workflow["36"]["inputs"]["tags"] = params.get("tags", "")
        workflow["36"]["inputs"]["lyrics"] = params.get("lyrics", "")
        workflow["36"]["inputs"]["seed"] = seed
        if "bpm" in params and params["bpm"]:
            workflow["36"]["inputs"]["bpm"] = int(params["bpm"])
        if "duration" in params and params["duration"]:
            dur = float(params["duration"])
            workflow["36"]["inputs"]["duration"] = dur
            if "29" in workflow and "inputs" in workflow["29"]:
                workflow["29"]["inputs"]["seconds"] = dur
        if "language" in params and params["language"]:
            workflow["36"]["inputs"]["language"] = params["language"]
        if "keyscale" in params and params["keyscale"]:
            workflow["36"]["inputs"]["keyscale"] = params["keyscale"]

    audio_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('audio',))

    if OUTPUT_AUDIO_DIR and os.path.exists(OUTPUT_AUDIO_DIR):
        try:
            with open(os.path.join(OUTPUT_AUDIO_DIR, output_filename), "wb") as f:
                f.write(audio_data)
        except Exception as e:
            print(f"Warning: Failed to save copy in {OUTPUT_AUDIO_DIR}: {e}")

    return audio_data, output_filename


# ==================== HTTP 路由 ====================

# ---------- 图像类 ----------

@app.route('/api/text2img', methods=['POST'])
@app.route('/api/image/text2img', methods=['POST'])
def api_text2img():
    """Qwen-Image 2.1 文生图接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        img_data, output_filename = run_image_workflow(
            "text2img", [], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/edit', methods=['POST'])
@app.route('/api/image/edit', methods=['POST'])
def api_edit():
    """Qwen-Image 2.1 单图编辑接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        if 'image' in request.files:
            filename = upload_to_comfyui(request.files['image'])
        elif 'image' in request.form:
            filename = request.form['image'].strip()
        else:
            return jsonify({"success": False, "error": "Missing 'image' file or filename"}), 400

        img_data, output_filename = run_image_workflow(
            "edit", [filename], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/blend', methods=['POST'])
@app.route('/api/image/dual_blend', methods=['POST'])
def api_blend():
    """Qwen-Image 2.1 双图融合/编辑接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        filename1 = upload_to_comfyui(request.files['image1']) if 'image1' in request.files else request.form.get('image1', '').strip()
        filename2 = upload_to_comfyui(request.files['image2']) if 'image2' in request.files else request.form.get('image2', '').strip()

        if not filename1 or not filename2:
            return jsonify({"success": False, "error": "Both 'image1' and 'image2' are required"}), 400

        img_data, output_filename = run_image_workflow(
            "dual_blend", [filename1, filename2], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/triple_blend', methods=['POST'])
@app.route('/api/image/tri_blend', methods=['POST'])
def api_triple_blend():
    """Qwen-Image 2.1 三图融合/编辑接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        filename1 = upload_to_comfyui(request.files['image1']) if 'image1' in request.files else request.form.get('image1', '').strip()
        filename2 = upload_to_comfyui(request.files['image2']) if 'image2' in request.files else request.form.get('image2', '').strip()
        filename3 = upload_to_comfyui(request.files['image3']) if 'image3' in request.files else request.form.get('image3', '').strip()

        if not filename1 or not filename2 or not filename3:
            return jsonify({"success": False, "error": "'image1', 'image2' and 'image3' are all required"}), 400

        img_data, output_filename = run_image_workflow(
            "tri_blend", [filename1, filename2, filename3], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/quad_blend', methods=['POST'])
@app.route('/api/image/quad_blend', methods=['POST'])
def api_quad_blend():
    """Qwen-Image 2.1 四图融合/编辑接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        images = []
        for i in range(1, 5):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            images.append(fn)

        img_data, output_filename = run_image_workflow(
            "quad_blend", images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/nona_blend', methods=['POST'])
@app.route('/api/image/nona_blend', methods=['POST'])
def api_nona_blend():
    """Qwen-Image 2.1 九图融合/编辑接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '16:9 (Widescreen)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        images = []
        for i in range(1, 10):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            images.append(fn)

        img_data, output_filename = run_image_workflow(
            "nona_blend", images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/image/multi_edit', methods=['POST'])
def api_image_multi_edit():
    """通用多图编辑接口 (自动识别 1/2/3/4/9 张图片)"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0
        megapixels = float(request.form.get('megapixels', 1.0))

        images = []
        uploaded_files = request.files.getlist('images')
        if uploaded_files:
            for f in uploaded_files:
                images.append(upload_to_comfyui(f))
        else:
            for k in ['image'] + [f'image{i}' for i in range(1, 10)]:
                if k in request.files:
                    images.append(upload_to_comfyui(request.files[k]))
                elif request.form.get(k):
                    images.append(request.form.get(k).strip())

        count = len(images)
        if count == 1:
            wf = "edit"
        elif count == 2:
            wf = "dual_blend"
        elif count == 3:
            wf = "tri_blend"
        elif count == 4:
            wf = "quad_blend"
        elif count == 9:
            wf = "nona_blend"
        else:
            return jsonify({
                "success": False,
                "error": f"Unsupported image count: {count}. Qwen-Image 2.1 支持 1, 2, 3, 4 或 9 张图片。"
            }), 400

        img_data, output_filename = run_image_workflow(
            wf, images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ---------- 视频类 ----------

@app.route('/api/video/image2video', methods=['POST'])
@app.route('/api/image2video', methods=['POST'])
def api_image2video():
    """Minimax-H3 图生视频 (支持 duration 与 scale_to_length)"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "scale_to_length": int(request.form.get('scale_to_length', 704)),
            "scale_to_side": request.form.get('scale_to_side', 'shortest').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 6,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        if 'image' in request.files:
            params['image'] = upload_to_comfyui(request.files['image'])
        elif 'image' in request.form:
            params['image'] = request.form['image'].strip()
        else:
            return jsonify({"success": False, "error": "Missing 'image' file or filename"}), 400

        video_data, output_filename = run_video_workflow("image2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/single_ref', methods=['POST'])
def api_video_single_ref():
    """Minimax-H3 单图参考生视频"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        if 'image' in request.files:
            params['image'] = upload_to_comfyui(request.files['image'])
        elif 'image' in request.form:
            params['image'] = request.form['image'].strip()
        else:
            return jsonify({"success": False, "error": "Missing 'image' file or filename"}), 400

        video_data, output_filename = run_video_workflow("single_ref2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/dual_ref', methods=['POST'])
def api_video_dual_ref():
    """Minimax-H3 双图参考生视频"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        params['image1'] = upload_to_comfyui(request.files['image1']) if 'image1' in request.files else request.form.get('image1', '').strip()
        params['image2'] = upload_to_comfyui(request.files['image2']) if 'image2' in request.files else request.form.get('image2', '').strip()

        if not params['image1'] or not params['image2']:
            return jsonify({"success": False, "error": "Both 'image1' and 'image2' are required"}), 400

        video_data, output_filename = run_video_workflow("dual_ref2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/tri_ref', methods=['POST'])
def api_video_tri_ref():
    """Minimax-H3 三图参考生视频"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        params['image1'] = upload_to_comfyui(request.files['image1']) if 'image1' in request.files else request.form.get('image1', '').strip()
        params['image2'] = upload_to_comfyui(request.files['image2']) if 'image2' in request.files else request.form.get('image2', '').strip()
        params['image3'] = upload_to_comfyui(request.files['image3']) if 'image3' in request.files else request.form.get('image3', '').strip()

        if not params['image1'] or not params['image2'] or not params['image3']:
            return jsonify({"success": False, "error": "'image1', 'image2' and 'image3' are all required"}), 400

        video_data, output_filename = run_video_workflow("tri_ref2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/quad_ref', methods=['POST'])
def api_video_quad_ref():
    """Minimax-H3 四图参考生视频"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        for i in range(1, 5):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            params[k] = fn

        video_data, output_filename = run_video_workflow("quad_ref2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/nona_ref', methods=['POST'])
def api_video_nona_ref():
    """Minimax-H3 九图参考生视频"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        for i in range(1, 10):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            params[k] = fn

        video_data, output_filename = run_video_workflow("nona_ref2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/multi_ref', methods=['POST'])
def api_video_multi_ref():
    """Minimax-H3 智能多图参考生视频 (根据上传图片数 1/2/3/4/9 自动匹配工作流)"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        duration = float(request.form.get('duration', 15.0))
        megapixels = float(request.form.get('megapixels', 0.9))
        aspect_ratio = request.form.get('aspect_ratio', '16:9 (Widescreen)').strip()
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None

        images = []
        uploaded_files = request.files.getlist('images')
        if uploaded_files:
            for f in uploaded_files:
                images.append(upload_to_comfyui(f))
        else:
            for k in ['image'] + [f'image{i}' for i in range(1, 10)]:
                if k in request.files:
                    images.append(upload_to_comfyui(request.files[k]))
                elif request.form.get(k):
                    images.append(request.form.get(k).strip())

        count = len(images)
        params = {
            "prompt": prompt_text,
            "duration": duration,
            "megapixels": megapixels,
            "aspect_ratio": aspect_ratio,
            "steps": steps,
            "seed": seed
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        if count == 1:
            params["image"] = images[0]
            wf = "single_ref2video"
        elif count == 2:
            params["image1"], params["image2"] = images[0], images[1]
            wf = "dual_ref2video"
        elif count == 3:
            params["image1"], params["image2"], params["image3"] = images[0], images[1], images[2]
            wf = "tri_ref2video"
        elif count == 4:
            for i in range(4):
                params[f"image{i+1}"] = images[i]
            wf = "quad_ref2video"
        elif count == 9:
            for i in range(9):
                params[f"image{i+1}"] = images[i]
            wf = "nona_ref2video"
        else:
            return jsonify({
                "success": False,
                "error": f"Unsupported reference image count: {count}. 支持 1, 2, 3, 4 或 9 张参考图。"
            }), 400

        video_data, output_filename = run_video_workflow(wf, params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/edit', methods=['POST'])
@app.route('/api/video/video_edit', methods=['POST'])
@app.route('/api/video/image_video2video', methods=['POST'])
def api_video_edit():
    """Minimax-H3 视频编辑 (参考图 + 原视频 -> 生成新视频，无需设置时长，支持 scale_to_length)"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "scale_to_length": int(request.form.get('scale_to_length', 704)),
            "scale_to_side": request.form.get('scale_to_side', 'shortest').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        # 接收参考图
        if 'image' in request.files:
            params['image'] = upload_to_comfyui(request.files['image'])
        elif 'image' in request.form:
            params['image'] = request.form['image'].strip()
        else:
            return jsonify({"success": False, "error": "Missing reference 'image'"}), 400

        # 接收源视频
        if 'video' in request.files:
            params['video'] = upload_to_comfyui(request.files['video'])
        elif 'video' in request.form:
            params['video'] = request.form['video'].strip()
        else:
            return jsonify({"success": False, "error": "Missing source 'video'"}), 400

        video_data, output_filename = run_video_workflow("video_edit", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/digital_human', methods=['POST'])
@app.route('/api/video/image_audio2video', methods=['POST'])
def api_video_digital_human():
    """Minimax-H3 数字人 (人像图 + 驱动音频 -> 生成人物说话视频)"""
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "length": int(request.form.get('length', 124)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }

        # 接收人物肖像图
        if 'image' in request.files:
            params['image'] = upload_to_comfyui(request.files['image'])
        elif 'image' in request.form:
            params['image'] = request.form['image'].strip()
        else:
            return jsonify({"success": False, "error": "Missing avatar 'image'"}), 400

        # 接收音频
        if 'audio' in request.files:
            params['audio'] = upload_to_comfyui(request.files['audio'])
        elif 'audio' in request.form:
            params['audio'] = request.form['audio'].strip()
        else:
            return jsonify({"success": False, "error": "Missing speech 'audio'"}), 400

        video_data, output_filename = run_video_workflow("digital_human", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ---------- 音乐类 ----------

@app.route('/api/music', methods=['POST'])
@app.route('/api/music/acestep', methods=['POST'])
def api_music():
    """ACE STEP 1.5XL 音乐生成接口"""
    try:
        params = {
            "tags": request.form.get('tags', '').strip(),
            "lyrics": request.form.get('lyrics', '').strip(),
            "bpm": int(request.form['bpm']) if 'bpm' in request.form and request.form['bpm'].isdigit() else 125,
            "duration": float(request.form.get('duration', 60.0)),
            "language": request.form.get('language', 'zh').strip(),
            "keyscale": request.form.get('keyscale', 'E minor').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        }

        audio_data, output_filename = run_music_workflow(params)

        buffer = BytesIO(audio_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='audio/mp3', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ---------- 状态与元信息 ----------

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查"""
    try:
        resp = requests.get(f"http://{SERVER_ADDRESS}/system_stats", timeout=3)
        comfy_status = "connected" if resp.status_code == 200 else f"http_{resp.status_code}"
    except Exception as e:
        comfy_status = f"unreachable: {e}"

    return jsonify({
        "status": "ok",
        "service": "ComfyUI Multi-Modal Bridge API Service",
        "comfyui": comfy_status,
        "server_address": SERVER_ADDRESS
    })


@app.route('/', methods=['GET'])
def index():
    """全接口目录与能力说明"""
    return jsonify({
        "service": "ComfyUI Multi-Modal Bridge API Service",
        "version": "2.1",
        "guidelines_for_ai_agents": {
            "image_megapixels_advice": {
                "default_and_preferred": 1.0,
                "high_detail": 2.0,
                "balanced": 1.5,
                "strongly_discouraged": "< 1.0 (blurry/lacks detail) or > 2.0 (artifacts/distortion/high VRAM)",
                "note": "AI agents calling image generation/editing workflows are strongly advised to select 1.0 MP by default, 2.0 MP for ultra-detail, or 1.5 MP as a balanced compromise."
            },
            "video_generation_advice": {
                "scale_to_length": {
                    "default_and_preferred": 704,
                    "fast_mode": 480,
                    "high_quality_upper_bound": 768,
                    "strongly_discouraged": "> 768 (drastically increases generation time and VRAM usage)",
                    "scale_to_side": "shortest"
                },
                "duration_seconds": {
                    "default": 15.0,
                    "recommended_range": [3.0, 15.0],
                    "note": "Minimax-H3 video duration defaults to 15s. Suggested range is between 3s and 15s."
                },
                "ref2video_and_digital_human_megapixels": {
                    "default_and_preferred": 0.9,
                    "fast_mode": 0.4,
                    "recommended_range": [0.4, 0.9],
                    "strongly_discouraged": "< 0.4 or > 0.9 (out of safe generation bounds)",
                    "note": "For ref2video (1/2/3/4/9 ref) and ImageAudio2Video (digital human), megapixels should be 0.9 by default, or 0.4 for fast mode. Do not exceed this range."
                }
            }
        },
        "endpoints": {
            "image": {
                "/api/text2img": "Qwen-Image 2.1 文生图 (prompt, aspect_ratio, megapixels[1.0/1.5/2.0], seed, steps, cfg)",
                "/api/edit": "Qwen-Image 2.1 单图编辑 (image, prompt, aspect_ratio, megapixels)",
                "/api/blend": "Qwen-Image 2.1 双图融合 (image1, image2, prompt, aspect_ratio, megapixels)",
                "/api/triple_blend": "Qwen-Image 2.1 三图融合 (image1~image3, prompt, aspect_ratio, megapixels)",
                "/api/quad_blend": "Qwen-Image 2.1 四图融合 (image1~image4, prompt, aspect_ratio, megapixels)",
                "/api/nona_blend": "Qwen-Image 2.1 九图融合 (image1~image9, prompt, aspect_ratio, megapixels)",
                "/api/image/multi_edit": "Qwen-Image 2.1 动态多图编辑 (自动按图数 1/2/3/4/9 路由, 支持 megapixels)"
            },
            "video": {
                "/api/video/image2video": "Minimax-H3 图生视频 (image, prompt, duration[3-15s, def 15s], scale_to_length[480/704/768, def 704])",
                "/api/video/single_ref": "Minimax-H3 单图参考生视频 (image, prompt, duration[3-15s], megapixels[0.4-0.9, def 0.9], aspect_ratio)",
                "/api/video/dual_ref": "Minimax-H3 双图参考生视频 (image1, image2, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/tri_ref": "Minimax-H3 三图参考生视频 (image1~image3, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/quad_ref": "Minimax-H3 四图参考生视频 (image1~image4, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/nona_ref": "Minimax-H3 九图参考生视频 (image1~image9, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/multi_ref": "Minimax-H3 智能多图参考生视频 (自动按图数 1/2/3/4/9 路由, 支持 duration[3-15s], megapixels[0.4-0.9])",
                "/api/video/edit": "Minimax-H3 视频编辑 (image 参考图 + video 源视频 + prompt 指令, scale_to_length[480/704/768, def 704], 时长自动继承原视频无需设置)",
                "/api/video/digital_human": "Minimax-H3 数字人 (image 角色图 + audio 声音文件 + prompt, duration[3-15s, def 15s], megapixels[0.4-0.9, def 0.9])"
            },
            "music": {
                "/api/music": "ACE STEP 1.5XL 音乐生成 (tags, lyrics, bpm, duration, language, keyscale)"
            },
            "system": {
                "/health": "服务与 ComfyUI 连通性状态检查"
            }
        }
    })


if __name__ == "__main__":
    print("=" * 60)
    print("ComfyUI Multi-Modal Bridge API Service v2.1")
    print("=" * 60)
    print(f"ComfyUI Server:  {SERVER_ADDRESS}")
    print(f"Service URL:     http://{HOST}:{PORT}")
    print("=" * 60)

    ensure_dir(COMFYUI_INPUT_DIR)
    ensure_dir(OUTPUT_IMAGE_DIR)
    ensure_dir(OUTPUT_VIDEO_DIR)
    ensure_dir(OUTPUT_AUDIO_DIR)
    app.run(host=HOST, port=PORT, threaded=True, debug=False)
