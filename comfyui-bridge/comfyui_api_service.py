# -*- coding: utf-8 -*-
"""
ComfyUI Unified Multi-Modal API Service
=======================================
统一的 ComfyUI HTTP 中间件桥接服务，支持：
1. Qwen-Image 2.1 文生图 (/api/text2img)
2. Qwen-Image 2.1 单图编辑 (/api/edit, /api/image/edit)
3. Qwen-Image 2.1 1-10 图融合/编辑 (/api/blend, /api/triple_blend, /api/quad_blend, /api/nona_blend, /api/deca_blend, /api/image/multi_edit)
4. Minimax-H3 图生视频 (/api/video/image2video, /api/image2video)
5. Minimax-H3 1-9 多图参考生视频 (/api/video/single_ref, /api/video/dual_ref, /api/video/tri_ref, /api/video/quad_ref, /api/video/penta_ref, /api/video/hexa_ref, /api/video/hepta_ref, /api/video/octa_ref, /api/video/nona_ref, /api/video/multi_ref)
6. Minimax-H3 多模态参考生视频 (/api/video/multi_modal)：最多 9 图 + 3 视频 + 3 音频，总文件数 ≤ 12
7. Minimax-H3 视频编辑/图+视频生视频 (/api/video/edit, /api/video/video_edit, /api/video/image_video2video)
8. Minimax-H3 数字人/图+音频生视频 (/api/video/digital_human, /api/video/image_audio2video)
9. 语音合成 Voice Design (/api/tts) — Qwen3-TTS
10. 音色克隆 Voice Clone (/api/voice_clone) — Qwen3-TTS
11. 音乐生成 (/api/music) — MinimaxMusic 3 & ACE-STEP 1.5
12. LTX-2.5 图生视频 (/api/video/ltx)
13. 健康检查与接口规范 (/health, /)

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
    "penta_blend": {
        "template": os.path.join(BASE_DIR, "1_5_PentaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_5_PentaRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "hexa_blend": {
        "template": os.path.join(BASE_DIR, "1_6_HexaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_6_HexaRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "hepta_blend": {
        "template": os.path.join(BASE_DIR, "1_7_HeptaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_7_HeptaRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "octa_blend": {
        "template": os.path.join(BASE_DIR, "1_8_OctaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_8_OctaRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "nona_blend": {
        "template": os.path.join(BASE_DIR, "1_9_NonaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_9_NonaRef2IMG_QwenImage2_1.json"),
        "type": "image"
    },
    "deca_blend": {
        "template": os.path.join(BASE_DIR, "1_10_DecaRef2IMG_QwenImage2_1_api.json"),
        "ui_template": os.path.join(BASE_DIR, "1_10_DecaRef2IMG_QwenImage2_1.json"),
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
    "penta_ref2video": {
        "template": os.path.join(BASE_DIR, "2_5_PentaRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_5_PentaRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "hexa_ref2video": {
        "template": os.path.join(BASE_DIR, "2_6_HexaRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_6_HexaRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "hepta_ref2video": {
        "template": os.path.join(BASE_DIR, "2_7_HeptaRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_7_HeptaRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "octa_ref2video": {
        "template": os.path.join(BASE_DIR, "2_8_OctaRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_8_OctaRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "nona_ref2video": {
        "template": os.path.join(BASE_DIR, "2_9_NonaRef2Video_MinimaxH3_api.json"),
        "ui_template": os.path.join(BASE_DIR, "2_9_NonaRef2Video_MinimaxH3.json"),
        "type": "video"
    },
    "multi_modal2video": {
        # 以 2_9 为基座：保留 9 图槽位与完整管线，视频/音频槽位按请求动态注入
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
    },

    # 语音合成 (Qwen3-TTS Voice Design)
    "tts": {
        "template": os.path.join(BASE_DIR, "VoiceDesign-QwenTTS.json"),
        "type": "audio"
    },

    # 音色克隆 (Qwen3-TTS Voice Clone)
    "voice_clone": {
        "template": os.path.join(BASE_DIR, "VoiceClone-QwenTTS.json"),
        "type": "audio"
    },

    # MinimaxMusic 3 音乐生成
    "music_minimax": {
        "template": os.path.join(BASE_DIR, "MusicCreation-MiniMaxMusic3_api.json"),
        "type": "audio"
    },

    # LTX-2.5 图生视频
    "ltx_video": {
        "template": os.path.join(BASE_DIR, "LTX25-ImageToVideo_api.json"),
        "type": "video"
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


def check_node_errors(result):
    """检查 ComfyUI 返回的 node_errors（HTTP 200 但节点校验失败时静默跳过节点）"""
    if isinstance(result, dict) and result.get("node_errors"):
        errors = result["node_errors"]
        # 构建简洁的错误摘要
        summary = []
        for node_id, node_err in errors.items():
            if isinstance(node_err, dict):
                details = node_err.get("errors", [])
                for e in details:
                    summary.append(f"Node#{node_id}: {e.get('message', 'unknown error')}")
            else:
                summary.append(f"Node#{node_id}: {node_err}")
        if summary:
            raise RuntimeError(f"ComfyUI node validation failed: {'; '.join(summary[:5])}")


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
        # 刷新剩余超时，确保长时间任务不被中途 socket 超时打断
        ws.settimeout(max(1, timeout - (time.time() - start_time)))
        try:
            out = ws.recv()
        except websocket.WebSocketTimeoutException:
            # socket 超时不等于任务失败，继续等待
            continue
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
        # connect(timeout=10) sets the socket timeout for ALL subsequent
        # recv()/send() calls to 10 seconds. Long-running ComfyUI nodes
        # (e.g. TextEncoder processing 5+ reference images at 0.9MP) can
        # easily exceed 10s without emitting a WebSocket progress message,
        # causing a false "Connection timed out" and killing a generation
        # that would have succeeded. Raise the socket timeout to match
 # GENERATION_TIMEOUT so wait_for_completion's elapsed-time check is
        # the sole authority on when to give up.
        ws.settimeout(GENERATION_TIMEOUT)
        result = queue_prompt(workflow, client_id)
        check_node_errors(result)
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

    elif workflow_type in ("penta_blend", "hexa_blend", "hepta_blend", "octa_blend"):
        # Node order matches images.image_1 ... images.image_N in the generated
        # 5/6/7/8-reference API workflows.
        multi_ref_nodes = ["489", "491", "497", "493", "494", "498", "495", "496"]
        for idx, nid in enumerate(multi_ref_nodes):
            if idx < len(image_filenames) and nid in workflow:
                workflow[nid]["inputs"]["image"] = image_filenames[idx]
        if "501" in workflow and "inputs" in workflow["501"]:
            workflow["501"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["501"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "nona_blend":
        nona_nodes = ["489", "491", "493", "494", "495", "496", "497", "498", "499"]
        for idx, nid in enumerate(nona_nodes):
            if idx < len(image_filenames):
                workflow[nid]["inputs"]["image"] = image_filenames[idx]
        if "501" in workflow and "inputs" in workflow["501"]:
            workflow["501"]["inputs"]["aspect_ratio"] = aspect_ratio
            if megapixels is not None:
                workflow["501"]["inputs"]["megapixels"] = float(megapixels)

    elif workflow_type == "deca_blend":
        # Node order matches images.image_1 ... images.image_10 in the generated
        # 10-reference API workflow (503 is the appended DecaRef loader).
        deca_nodes = ["489", "491", "493", "494", "495", "496", "497", "498", "499", "503"]
        for idx, nid in enumerate(deca_nodes):
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

    # 2-6. One through nine reference-image to video workflows.
    elif workflow_type in (
        "single_ref2video", "dual_ref2video", "tri_ref2video", "quad_ref2video",
        "penta_ref2video", "hexa_ref2video", "hepta_ref2video", "octa_ref2video",
        "nona_ref2video",
    ):
        conditioning = workflow.get("77", {}).get("inputs", {})
        for index in range(9):
            key = f"ref_images.ref_image_{index}"
            image_key = (
                "image"
                if index == 0 and workflow_type == "single_ref2video"
                else f"image{index + 1}"
            )
            if key in conditioning and image_key in params:
                source_node = str(conditioning[key][0])
                workflow[source_node]["inputs"]["image"] = params[image_key]
        if params.get("prompt"):
            conditioning["prompt"] = params["prompt"]
        if params.get("duration") is not None and "76" in workflow:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        elif params.get("length"):
            conditioning["length"] = int(params["length"])
        if "82" in workflow:
            if params.get("aspect_ratio"):
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if params.get("megapixels") is not None:
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

    # 9. 多模态参考生视频 (9 图 + 3 视频 + 3 音频, 总数 ≤ 12)
    elif workflow_type == "multi_modal2video":
        conditioning = workflow["77"]["inputs"]
        images = params.get("images", [])
        videos = params.get("videos", [])
        audios = params.get("audios", [])

        # 图片槽位: 接前 N 张, 未用的 ref_image_k 从 API 工作流中摘除 (可选输入)
        for index in range(9):
            key = f"ref_images.ref_image_{index}"
            if index < len(images) and key in conditioning:
                source_node = str(conditioning[key][0])
                workflow[source_node]["inputs"]["image"] = images[index]
            else:
                conditioning.pop(key, None)

        # 视频槽位: VHS_LoadVideo(200+i) -> ImageScale(210+i) -> ref_video_i;
        # loader 的 AUDIO 输出(2)按同序号配对到 ref_video_audio_i
        for vi, vfile in enumerate(videos):
            loader_id = str(200 + vi)
            scale_id = str(210 + vi)
            workflow[loader_id] = {
                "class_type": "VHS_LoadVideo",
                "inputs": {
                    "video": vfile,
                    "force_rate": 24,
                    "custom_width": 0,
                    "custom_height": 0,
                    "frame_load_cap": 0,
                    "skip_first_frames": 0,
                    "select_every_nth": 1,
                    "format": "AnimateDiff",
                },
            }
            workflow[scale_id] = {
                "class_type": "LayerUtility: ImageScaleByAspectRatio V2",
                "inputs": {
                    "aspect_ratio": "original",
                    "proportional_width": 1,
                    "proportional_height": 1,
                    "fit": "letterbox",
                    "method": "lanczos",
                    "round_to_multiple": "32",
                    "scale_to_side": params.get("scale_to_side", "shortest"),
                    "scale_to_length": int(params.get("scale_to_length", 704)),
                    "background_color": "#000000",
                    "image": [loader_id, 0],
                },
            }
            conditioning[f"ref_videos.ref_video_{vi}"] = [scale_id, 0]
            if params.get("pair_video_audio", True):
                conditioning[f"ref_video_audios.ref_video_audio_{vi}"] = [loader_id, 2]

        # 独立音频槽位: LoadAudio(220+j) -> ref_audio_j
        for ai, afile in enumerate(audios):
            aloader_id = str(220 + ai)
            workflow[aloader_id] = {
                "class_type": "LoadAudio",
                "inputs": {"audio": afile},
            }
            conditioning[f"ref_audios.ref_audio_{ai}"] = [aloader_id, 0]

        if params.get("prompt"):
            conditioning["prompt"] = params["prompt"]
        if params.get("duration") is not None and "76" in workflow:
            workflow["76"]["inputs"]["value"] = int(round(float(params["duration"])))
        if "82" in workflow:
            if params.get("aspect_ratio"):
                workflow["82"]["inputs"]["aspect_ratio"] = params["aspect_ratio"]
            if params.get("megapixels") is not None:
                workflow["82"]["inputs"]["megapixels"] = float(params["megapixels"])

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


def run_tts_workflow(params):
    """Qwen3-TTS 语音合成 (Voice Design)"""
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template("tts")

    if "75" in workflow and "inputs" in workflow["75"]:
        workflow["75"]["inputs"]["text"] = params.get("text", "")
    if "76" in workflow and "inputs" in workflow["76"]:
        workflow["76"]["inputs"]["text"] = params.get("voice_description", "")
    if "73" in workflow and "inputs" in workflow["73"]:
        workflow["73"]["inputs"]["seed"] = params.get("seed") or random.randint(1, 10**15)

    audio_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('audio',))
    return audio_data, output_filename


def run_voice_clone_workflow(params):
    """Qwen3-TTS 音色克隆 (FB_Qwen3TTSVoiceClone + Whisper 自动转写)"""
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template("voice_clone")

    # Node 151: LoadAudio — 参考音频
    if "151" in workflow and "inputs" in workflow["151"]:
        workflow["151"]["inputs"]["audio"] = params["ref_audio"]

    # Node 153: Text Multiline — 目标文本
    if "153" in workflow and "inputs" in workflow["153"]:
        workflow["153"]["inputs"]["text"] = params.get("text", "")

    # Node 150: FB_Qwen3TTSVoiceClone — 种子
    if "150" in workflow and "inputs" in workflow["150"]:
        workflow["150"]["inputs"]["seed"] = params.get("seed") or random.randint(1, 10**15)

    # Node 152 自动用 Whisper 转写参考音频，无需手动提供 ref_text

    audio_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('audio',))
    return audio_data, output_filename


def run_music_minimax_workflow(params):
    """MinimaxMusic 3 音乐生成 (MusicCreation-MiniMaxMusic3)"""
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template("music_minimax")
    seed = params.get("seed") or random.randint(1, 10**15)

    # Node 15: Text Multiline — 风格描述 (caption)
    if "15" in workflow and "inputs" in workflow["15"]:
        workflow["15"]["inputs"]["text"] = params.get("style", params.get("prompt", ""))

    # Node 16: Text Multiline — 歌词
    if "16" in workflow and "inputs" in workflow["16"]:
        workflow["16"]["inputs"]["text"] = params.get("lyrics", "[inst][verse]\n[chorus]\n[/inst]")

    # Node 14: PrimitiveFloat — 时长(秒)
    if "14" in workflow and "inputs" in workflow["14"]:
        workflow["14"]["inputs"]["value"] = float(params.get("duration", 60.0))

    # Node 6: MiniMaxMusic3TextEncode — 种子与 CFG
    if "6" in workflow and "inputs" in workflow["6"]:
        workflow["6"]["inputs"]["seed"] = seed
        if params.get("cfg_scale"):
            workflow["6"]["inputs"]["cfg_scale"] = float(params["cfg_scale"])

    # Node 4: KSampler — 种子与步数
    if "4" in workflow and "inputs" in workflow["4"]:
        workflow["4"]["inputs"]["seed"] = seed
        if params.get("steps"):
            workflow["4"]["inputs"]["steps"] = int(params["steps"])

    audio_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('audio',))
    return audio_data, output_filename


def run_ltx_video_workflow(params):
    """LTX-2.5 图生视频 (Image2Video LTX-2.5)"""
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template("ltx_video")
    seed = params.get("seed") or random.randint(1, 10**15)

    # Node 9: LoadImage — 输入图片
    if "9" in workflow and "inputs" in workflow["9"]:
        workflow["9"]["inputs"]["image"] = params["image"]

    # Node 181: CLIPTextEncode — 提示词
    if "181" in workflow and "inputs" in workflow["181"]:
        workflow["181"]["inputs"]["text"] = params.get("prompt", "")

    # Node 183: PrimitiveInt — 时长(秒)
    if "183" in workflow and "inputs" in workflow["183"]:
        workflow["183"]["inputs"]["value"] = int(params.get("duration", 15))

    # Node 51: KSampler — 第一阶段采样
    if "51" in workflow and "inputs" in workflow["51"]:
        workflow["51"]["inputs"]["seed"] = seed
        if params.get("steps"):
            workflow["51"]["inputs"]["steps"] = int(params["steps"])
        if params.get("cfg"):
            workflow["51"]["inputs"]["cfg"] = float(params["cfg"])

    # Node 155: KSampler — 第二阶段时序细化
    if "155" in workflow and "inputs" in workflow["155"]:
        workflow["155"]["inputs"]["seed"] = seed
        if params.get("refine_steps"):
            workflow["155"]["inputs"]["steps"] = int(params["refine_steps"])

    # Node 5: ImageScaleByAspectRatio — 画面缩放
    if "5" in workflow and "inputs" in workflow["5"]:
        if params.get("scale_to_length"):
            workflow["5"]["inputs"]["scale_to_length"] = int(params["scale_to_length"])

    video_data, output_filename = execute_and_fetch_output(workflow, client_id, expected_types=('gifs', 'videos', 'images'))

    if OUTPUT_VIDEO_DIR and os.path.exists(OUTPUT_VIDEO_DIR):
        try:
            with open(os.path.join(OUTPUT_VIDEO_DIR, output_filename), "wb") as f:
                f.write(video_data)
        except Exception as e:
            print(f"Warning: Failed to save copy in {OUTPUT_VIDEO_DIR}: {e}")

    return video_data, output_filename


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


def _api_fixed_multi_blend(image_count: int):
    """Shared handler for 5-8 reference Qwen-Image 2.1 generation."""
    prefixes = {5: "penta", 6: "hexa", 7: "hepta", 8: "octa"}
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
        for i in range(1, image_count + 1):
            key = f'image{i}'
            filename = upload_to_comfyui(request.files[key]) if key in request.files else request.form.get(key, '').strip()
            if not filename:
                return jsonify({"success": False, "error": f"'{key}' is required"}), 400
            images.append(filename)

        img_data, output_filename = run_image_workflow(
            f"{prefixes[image_count]}_blend", images, prompt_text,
            aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )
        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/penta_blend', methods=['POST'])
@app.route('/api/image/penta_blend', methods=['POST'])
@app.route('/api/five_blend', methods=['POST'])
def api_penta_blend():
    """Qwen-Image 2.1 five-reference blend/edit endpoint."""
    return _api_fixed_multi_blend(5)


@app.route('/api/hexa_blend', methods=['POST'])
@app.route('/api/image/hexa_blend', methods=['POST'])
@app.route('/api/six_blend', methods=['POST'])
def api_hexa_blend():
    """Qwen-Image 2.1 six-reference blend/edit endpoint."""
    return _api_fixed_multi_blend(6)


@app.route('/api/hepta_blend', methods=['POST'])
@app.route('/api/image/hepta_blend', methods=['POST'])
@app.route('/api/seven_blend', methods=['POST'])
def api_hepta_blend():
    """Qwen-Image 2.1 seven-reference blend/edit endpoint."""
    return _api_fixed_multi_blend(7)


@app.route('/api/octa_blend', methods=['POST'])
@app.route('/api/image/octa_blend', methods=['POST'])
@app.route('/api/eight_blend', methods=['POST'])
def api_octa_blend():
    """Qwen-Image 2.1 eight-reference blend/edit endpoint."""
    return _api_fixed_multi_blend(8)


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


@app.route('/api/deca_blend', methods=['POST'])
@app.route('/api/image/deca_blend', methods=['POST'])
@app.route('/api/ten_blend', methods=['POST'])
def api_deca_blend():
    """Qwen-Image 2.1 十图融合/编辑接口"""
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
        for i in range(1, 11):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            images.append(fn)

        img_data, output_filename = run_image_workflow(
            "deca_blend", images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/image/multi_edit', methods=['POST'])
def api_image_multi_edit():
    """通用多图编辑接口 (自动识别 1-10 张图片)"""
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
            for k in ['image'] + [f'image{i}' for i in range(1, 11)]:
                if k in request.files:
                    images.append(upload_to_comfyui(request.files[k]))
                elif request.form.get(k):
                    images.append(request.form.get(k).strip())

        count = len(images)
        workflow_by_count = {
            1: "edit",
            2: "dual_blend",
            3: "tri_blend",
            4: "quad_blend",
            5: "penta_blend",
            6: "hexa_blend",
            7: "hepta_blend",
            8: "octa_blend",
            9: "nona_blend",
            10: "deca_blend",
        }
        wf = workflow_by_count.get(count)
        if wf is None:
            return jsonify({
                "success": False,
                "error": f"Unsupported image count: {count}. Qwen-Image 2.1 supports 1-10 images."
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

@app.route('/api/video/multi_modal', methods=['POST'])
@app.route('/api/video/full_ref', methods=['POST'])
def api_video_multi_modal():
    """Minimax-H3 多模态参考生视频：最多 9 图 + 3 视频 + 3 音频，总文件数 ≤ 12"""
    try:
        def collect(kind, max_count):
            items = []
            uploads = request.files.getlist(kind)
            if uploads:
                for f in uploads:
                    items.append(upload_to_comfyui(f))
            else:
                for i in range(1, max_count + 1):
                    k = f"{'image' if kind == 'images' else kind[:-1]}{i}"
                    if k in request.files:
                        items.append(upload_to_comfyui(request.files[k]))
                    elif request.form.get(k, '').strip():
                        items.append(request.form.get(k).strip())
            return items

        # 每类多读一个字段（10/4/4）用于让上限校验能看到并拒绝超额请求
        images = collect('images', 10)
        videos = collect('videos', 4)
        audios = collect('audios', 4)

        if len(images) > 9:
            return jsonify({"success": False, "error": f"Too many images: {len(images)}. MiniMax H3 supports at most 9 reference images."}), 400
        if len(videos) > 3:
            return jsonify({"success": False, "error": f"Too many videos: {len(videos)}. MiniMax H3 supports at most 3 reference videos."}), 400
        if len(audios) > 3:
            return jsonify({"success": False, "error": f"Too many audios: {len(audios)}. MiniMax H3 supports at most 3 reference audios."}), 400
        total = len(images) + len(videos) + len(audios)
        if total < 1 or total > 12:
            return jsonify({"success": False, "error": f"Invalid total reference files: {total}. MiniMax H3 accepts 1-12 files (<=9 images + <=3 videos + <=3 audios)."}), 400

        pair_video_audio = request.form.get('pair_video_audio', 'true').strip().lower() != 'false'
        params = {
            "images": images,
            "videos": videos,
            "audios": audios,
            "pair_video_audio": pair_video_audio,
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None,
            "scale_to_side": request.form.get('scale_to_side', 'shortest').strip(),
            "scale_to_length": int(request.form.get('scale_to_length', 704)),
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        video_data, output_filename = run_video_workflow("multi_modal2video", params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

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


def _api_video_fixed_ref(image_count: int):
    prefixes = {
        5: "penta",
        6: "hexa",
        7: "hepta",
        8: "octa",
    }
    try:
        params = {
            "prompt": request.form.get('prompt', '').strip(),
            "duration": float(request.form.get('duration', 15.0)),
            "megapixels": float(request.form.get('megapixels', 0.9)),
            "aspect_ratio": request.form.get('aspect_ratio', '16:9 (Widescreen)').strip(),
            "steps": int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 8,
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None,
        }
        if 'length' in request.form and request.form['length'].isdigit():
            params['length'] = int(request.form['length'])

        for index in range(1, image_count + 1):
            key = f'image{index}'
            filename = upload_to_comfyui(request.files[key]) if key in request.files else request.form.get(key, '').strip()
            if not filename:
                return jsonify({"success": False, "error": f"'{key}' is required"}), 400
            params[key] = filename

        video_data, output_filename = run_video_workflow(f"{prefixes[image_count]}_ref2video", params)
        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/video/penta_ref', methods=['POST'])
@app.route('/api/video/five_ref', methods=['POST'])
def api_video_penta_ref():
    """Minimax-H3 five-reference image to video."""
    return _api_video_fixed_ref(5)


@app.route('/api/video/hexa_ref', methods=['POST'])
@app.route('/api/video/six_ref', methods=['POST'])
def api_video_hexa_ref():
    """Minimax-H3 six-reference image to video."""
    return _api_video_fixed_ref(6)


@app.route('/api/video/hepta_ref', methods=['POST'])
@app.route('/api/video/seven_ref', methods=['POST'])
def api_video_hepta_ref():
    """Minimax-H3 seven-reference image to video."""
    return _api_video_fixed_ref(7)


@app.route('/api/video/octa_ref', methods=['POST'])
@app.route('/api/video/eight_ref', methods=['POST'])
def api_video_octa_ref():
    """Minimax-H3 eight-reference image to video."""
    return _api_video_fixed_ref(8)


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

        workflow_by_count = {
            1: "single_ref2video",
            2: "dual_ref2video",
            3: "tri_ref2video",
            4: "quad_ref2video",
            5: "penta_ref2video",
            6: "hexa_ref2video",
            7: "hepta_ref2video",
            8: "octa_ref2video",
            9: "nona_ref2video",
        }
        wf = workflow_by_count.get(count)
        if wf is None:
            return jsonify({
                "success": False,
                "error": f"Unsupported reference image count: {count}. 支持 1, 2, 3, 4 或 9 张参考图。"
            }), 400

        for index, image in enumerate(images):
            params["image" if count == 1 and index == 0 else f"image{index + 1}"] = image

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


# ==================== 语音合成 (Voice Design) ====================

@app.route('/api/tts', methods=['POST'])
def api_tts():
    """Qwen3-TTS 语音合成 (Voice Design)"""
    try:
        data = request.get_json(silent=True) or {}
        text = data.get('text', '').strip()
        voice_description = data.get('voice_description', '').strip()

        if not text:
            return jsonify({"success": False, "error": "Missing 'text'"}), 400
        if not voice_description:
            return jsonify({"success": False, "error": "Missing 'voice_description' (must be English)"}), 400

        params = {"text": text, "voice_description": voice_description, "seed": data.get("seed")}
        audio_data, output_filename = run_tts_workflow(params)

        buffer = BytesIO(audio_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='audio/mp3', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== 音色克隆 (Voice Clone) ====================

@app.route('/api/voice_clone', methods=['POST'])
def api_voice_clone():
    """Qwen3-TTS 音色克隆"""
    try:
        ref_audio_fn = None
        if 'audio' in request.files:
            ref_audio_fn = upload_to_comfyui(request.files['audio'])
        elif request.form.get('audio', '').strip():
            ref_audio_fn = request.form.get('audio').strip()
        elif request.get_json(silent=True) and request.get_json(silent=True).get('audio'):
            ref_audio_fn = request.get_json(silent=True).get('audio')

        if not ref_audio_fn:
            return jsonify({"success": False, "error": "Missing reference 'audio' file or filename"}), 400

        text = request.form.get('text') or (request.get_json(silent=True) or {}).get('text', '')
        if not text.strip():
            return jsonify({"success": False, "error": "Missing 'text' (target speech)"}), 400

        params = {
            "ref_audio": ref_audio_fn,
            "text": text.strip(),
            "seed": request.form.get('seed') or (request.get_json(silent=True) or {}).get('seed'),
        }
        audio_data, output_filename = run_voice_clone_workflow(params)

        buffer = BytesIO(audio_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='audio/wav', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== MinimaxMusic 3 ====================

@app.route('/api/music/minimax', methods=['POST'])
def api_music_minimax():
    """MinimaxMusic 3 音乐生成"""
    try:
        data = request.get_json(silent=True) or {}
        style = data.get('style', data.get('prompt', '')).strip()
        if not style:
            return jsonify({"success": False, "error": "Missing 'style'"}), 400

        params = {
            "style": style,
            "lyrics": data.get('lyrics', ''),
            "duration": data.get('duration', 60.0),
            "cfg_scale": data.get('cfg_scale', 7.0),
            "steps": data.get('steps', 28),
            "seed": data.get('seed'),
        }
        audio_data, output_filename = run_music_minimax_workflow(params)

        buffer = BytesIO(audio_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='audio/mp3', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== LTX-2.5 图生视频 ====================

@app.route('/api/video/ltx', methods=['POST'])
@app.route('/api/video/ltx_image2video', methods=['POST'])
def api_video_ltx():
    """LTX-2.5 图生视频"""
    try:
        image_fn = None
        if 'image' in request.files:
            image_fn = upload_to_comfyui(request.files['image'])
        elif request.form.get('image', '').strip():
            image_fn = request.form.get('image').strip()

        if not image_fn:
            return jsonify({"success": False, "error": "Missing 'image'"}), 400

        prompt = request.form.get('prompt', '').strip()
        if not prompt:
            return jsonify({"success": False, "error": "Missing 'prompt'"}), 400

        params = {
            "image": image_fn,
            "prompt": prompt,
            "duration": request.form.get('duration', 15),
            "steps": request.form.get('steps', 6),
            "refine_steps": request.form.get('refine_steps', 4),
            "cfg": request.form.get('cfg', 1.0),
            "scale_to_length": request.form.get('scale_to_length', 720),
            "seed": int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None,
        }
        video_data, output_filename = run_ltx_video_workflow(params)

        buffer = BytesIO(video_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='video/mp4', as_attachment=False, download_name=output_filename)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


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
                    "note": "For ref2video (1-9 refs) and ImageAudio2Video (digital human), megapixels should be 0.9 by default, or 0.4 for fast mode. Do not exceed this range."
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
                "/api/penta_blend": "Qwen-Image 2.1 五图融合 (image1~image5, prompt, aspect_ratio, megapixels)",
                "/api/hexa_blend": "Qwen-Image 2.1 六图融合 (image1~image6, prompt, aspect_ratio, megapixels)",
                "/api/hepta_blend": "Qwen-Image 2.1 七图融合 (image1~image7, prompt, aspect_ratio, megapixels)",
                "/api/octa_blend": "Qwen-Image 2.1 八图融合 (image1~image8, prompt, aspect_ratio, megapixels)",
                "/api/nona_blend": "Qwen-Image 2.1 九图融合 (image1~image9, prompt, aspect_ratio, megapixels)",
                "/api/image/multi_edit": "Qwen-Image 2.1 动态多图编辑 (自动支持 1-9 张参考图, 支持 megapixels)"
            },
            "video": {
                "/api/video/image2video": "Minimax-H3 图生视频 (image, prompt, duration[3-15s, def 15s], scale_to_length[480/704/768, def 704])",
                "/api/video/single_ref": "Minimax-H3 单图参考生视频 (image, prompt, duration[3-15s], megapixels[0.4-0.9, def 0.9], aspect_ratio)",
                "/api/video/dual_ref": "Minimax-H3 双图参考生视频 (image1, image2, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/tri_ref": "Minimax-H3 三图参考生视频 (image1~image3, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/quad_ref": "Minimax-H3 四图参考生视频 (image1~image4, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/penta_ref": "Minimax-H3 五图参考生视频 (image1~image5, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/hexa_ref": "Minimax-H3 六图参考生视频 (image1~image6, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/hepta_ref": "Minimax-H3 七图参考生视频 (image1~image7, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/octa_ref": "Minimax-H3 八图参考生视频 (image1~image8, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/nona_ref": "Minimax-H3 九图参考生视频 (image1~image9, prompt, duration[3-15s], megapixels[0.4-0.9], aspect_ratio)",
                "/api/video/multi_ref": "Minimax-H3 智能多图参考生视频 (自动支持 1-9 张参考图, 支持 duration[3-15s], megapixels[0.4-0.9])",
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
