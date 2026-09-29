# -*- coding: utf-8 -*-
"""
ComfyUI Qwen-Image 2.1 Edit HTTP Service
========================================
基于 ComfyUI API 封装的 Qwen-Image 2.1 图像编辑与多图融合专用 HTTP 服务。

功能接口:
    1. 单图编辑     (/api/edit)
    2. 双图编辑     (/api/blend, /api/dual_blend)
    3. 三图编辑     (/api/triple_blend, /api/tri_blend)
    4. 四图编辑     (/api/quad_blend)
    5. 九图编辑     (/api/nona_blend)
    6. 动态多图编辑 (/api/multi_edit) - 依据传入图片数量(1/2/3/4/9)自动路由
    7. 健康检查     (/health)
    8. 接口说明     (/)

启动方式:
    python comfyui_edit_service.py

环境变量配置:
    COMFYUI_SERVER: ComfyUI 服务器地址 (默认: 127.0.0.1:8188)
    COMFYUI_INPUT_DIR: ComfyUI 输入目录 (默认: ./input)
    SERVICE_HOST: 服务监听地址 (默认: 0.0.0.0)
    SERVICE_PORT: 服务监听端口 (默认: 5000)
    GENERATION_TIMEOUT: 生成超时时间秒数 (默认: 300)
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
GENERATION_TIMEOUT = int(os.environ.get("GENERATION_TIMEOUT", "300"))
HOST = os.environ.get("SERVICE_HOST", "0.0.0.0")
PORT = int(os.environ.get("SERVICE_PORT", "5000"))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

WORKFLOW_FILES = {
    "single": {
        "api": os.path.join(BASE_DIR, "1_1_SingleRef2IMG_QwenImage2_1_api.json"),
        "ui": os.path.join(BASE_DIR, "1_1_SingleRef2IMG_QwenImage2_1.json"),
    },
    "dual": {
        "api": os.path.join(BASE_DIR, "1_2_DualRef2IMG_QwenImage2_1_api.json"),
        "ui": os.path.join(BASE_DIR, "1_2_DualRef2IMG_QwenImage2_1.json"),
    },
    "tri": {
        "api": os.path.join(BASE_DIR, "1_3_TriRef2IMG_QwenImage2_1_api.json"),
        "ui": os.path.join(BASE_DIR, "1_3_TriRef2IMG_QwenImage2_1.json"),
    },
    "quad": {
        "api": os.path.join(BASE_DIR, "1_4_QuadRef2IMG_QwenImage2_1_api.json"),
        "ui": os.path.join(BASE_DIR, "1_4_QuadRef2IMG_QwenImage2_1.json"),
    },
    "nona": {
        "api": os.path.join(BASE_DIR, "1_9_NonaRef2IMG_QwenImage2_1_api.json"),
        "ui": os.path.join(BASE_DIR, "1_9_NonaRef2IMG_QwenImage2_1.json"),
    },
}

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024


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
    config = WORKFLOW_FILES.get(workflow_type)
    if not config:
        raise ValueError(f"Unknown workflow type: {workflow_type}")

    api_path = config["api"]
    ui_path = config["ui"]

    if os.path.exists(api_path):
        with open(api_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return clean_workflow(data)
    elif os.path.exists(ui_path):
        with open(ui_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return convert_ui_to_api_workflow(data)
    else:
        raise FileNotFoundError(f"Workflow template not found for {workflow_type}: {api_path} or {ui_path}")


def queue_prompt(prompt, client_id):
    """向 ComfyUI 提交 Prompt 任务"""
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
    """从 ComfyUI 获取生成的文件"""
    view_url = f"http://{SERVER_ADDRESS}/view?filename={filename}&subfolder={subfolder}&type={file_type}"
    resp = requests.get(view_url, timeout=120)
    resp.raise_for_status()
    return resp.content


def upload_to_comfyui(file_obj, filename=None):
    """上传文件到 ComfyUI 内部存储"""
    upload_url = f"http://{SERVER_ADDRESS}/upload/image"
    name = filename or secure_filename(file_obj.filename)
    files = {"image": (name, file_obj.stream if hasattr(file_obj, 'stream') else file_obj, "application/octet-stream")}
    resp = requests.post(upload_url, files=files, timeout=30)
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


def execute_and_fetch_output(workflow, client_id):
    """执行工作流并拉取生成图像"""
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
            if 'images' in node_output and node_output['images']:
                img_info = node_output['images'][0]
                filename = img_info['filename']
                subfolder = img_info.get('subfolder', '')
                img_type = img_info.get('type', 'output')
                data = download_file(filename, subfolder, img_type)
                print(f"[{prompt_id}] Downloaded output image: {filename}")
                return data, filename

        raise RuntimeError("No image output found in workflow execution")
    finally:
        ws.close()


def run_qwen_image_workflow(workflow_type, image_filenames, prompt_text, aspect_ratio="3:4 (Portrait Standard)", seed=None, steps=25, cfg=1.0, negative_prompt="", megapixels=1.0):
    """
    Qwen-Image 2.1 图像编辑/多图融合执行逻辑
    
    像素/分辨率推荐 (megapixels):
        - 首选推荐: 1.0 (平衡度最高、构图稳定、显存友好)
        - 细节增强: 2.0 (微距特写、复杂纹理细节丰富)
        - 折衷推荐: 1.5 (速度与细节兼顾)
        - 不建议: < 1.0 (易出现模糊与涂抹) 或 > 2.0 (易导致畸变与显存激增)
    """
    client_id = str(uuid.uuid4())
    workflow = load_workflow_template(workflow_type)
    actual_seed = seed if seed is not None else random.randint(1, 10**15)

    # 1. 采样器参数注入 (Node 474 KSampler)
    if "474" in workflow and "inputs" in workflow["474"]:
        workflow["474"]["inputs"]["seed"] = actual_seed
        if steps is not None:
            workflow["474"]["inputs"]["steps"] = int(steps)
        if cfg is not None:
            workflow["474"]["inputs"]["cfg"] = float(cfg)

    # 2. 提示词注入 (Node 469 TextEncodeQwenImage21)
    if "469" in workflow and "inputs" in workflow["469"]:
        workflow["469"]["inputs"]["prompt"] = prompt_text
        if negative_prompt is not None:
            workflow["469"]["inputs"]["negative_prompt"] = negative_prompt

    # 3. 分辨率选择器映射与注入 (megapixels 推荐 1.0 / 1.5 / 2.0)
    res_node_map = {
        "single": "491",
        "dual": "493",
        "tri": "494",
        "quad": "491",
        "nona": "501"
    }
    res_nid = res_node_map.get(workflow_type)
    if res_nid and res_nid in workflow and "inputs" in workflow[res_nid]:
        if aspect_ratio:
            workflow[res_nid]["inputs"]["aspect_ratio"] = aspect_ratio
        if megapixels is not None:
            workflow[res_nid]["inputs"]["megapixels"] = float(megapixels)

    # 4. 各工作流图片输入连接
    if workflow_type == "single":
        workflow["489"]["inputs"]["image"] = image_filenames[0]

    elif workflow_type == "dual":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        workflow["491"]["inputs"]["image"] = image_filenames[1]

    elif workflow_type == "tri":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        workflow["491"]["inputs"]["image"] = image_filenames[1]
        workflow["493"]["inputs"]["image"] = image_filenames[2]

    elif workflow_type == "quad":
        workflow["489"]["inputs"]["image"] = image_filenames[0]
        workflow["493"]["inputs"]["image"] = image_filenames[1]
        workflow["494"]["inputs"]["image"] = image_filenames[2]
        workflow["495"]["inputs"]["image"] = image_filenames[3]

    elif workflow_type == "nona":
        nona_nodes = ["489", "491", "493", "494", "495", "496", "497", "498", "499"]
        for idx, nid in enumerate(nona_nodes):
            if idx < len(image_filenames):
                workflow[nid]["inputs"]["image"] = image_filenames[idx]
    else:
        raise ValueError(f"Unsupported workflow type: {workflow_type}")

    # 执行并拉取输出
    img_data, output_filename = execute_and_fetch_output(workflow, client_id)

    # 保存本地副本
    if OUTPUT_IMAGE_DIR and os.path.exists(OUTPUT_IMAGE_DIR):
        try:
            local_save_path = os.path.join(OUTPUT_IMAGE_DIR, output_filename)
            with open(local_save_path, "wb") as f:
                f.write(img_data)
        except Exception as e:
            print(f"Warning: Failed to save local copy to {OUTPUT_IMAGE_DIR}: {e}")

    return img_data, output_filename


# ==================== HTTP 路由 ====================

@app.route('/api/edit', methods=['POST'])
def api_edit():
    """单图编辑接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        megapixels = float(request.form.get('megapixels', 1.0))
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0

        if 'image' in request.files:
            filename = upload_to_comfyui(request.files['image'])
        elif 'image' in request.form:
            filename = request.form['image'].strip()
        else:
            return jsonify({"success": False, "error": "Missing 'image' file or filename"}), 400

        img_data, output_filename = run_qwen_image_workflow(
            "single", [filename], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/blend', methods=['POST'])
@app.route('/api/dual_blend', methods=['POST'])
def api_blend():
    """双图编辑/融合接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        megapixels = float(request.form.get('megapixels', 1.0))
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0

        filename1 = upload_to_comfyui(request.files['image1']) if 'image1' in request.files else request.form.get('image1', '').strip()
        filename2 = upload_to_comfyui(request.files['image2']) if 'image2' in request.files else request.form.get('image2', '').strip()

        if not filename1 or not filename2:
            return jsonify({"success": False, "error": "Both 'image1' and 'image2' are required"}), 400

        img_data, output_filename = run_qwen_image_workflow(
            "dual", [filename1, filename2], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/triple_blend', methods=['POST'])
@app.route('/api/tri_blend', methods=['POST'])
def api_triple_blend():
    """三图编辑/融合接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        megapixels = float(request.form.get('megapixels', 1.0))
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0

        filename1 = upload_to_comfyui(request.files['image1']) if 'image1' in request.files else request.form.get('image1', '').strip()
        filename2 = upload_to_comfyui(request.files['image2']) if 'image2' in request.files else request.form.get('image2', '').strip()
        filename3 = upload_to_comfyui(request.files['image3']) if 'image3' in request.files else request.form.get('image3', '').strip()

        if not filename1 or not filename2 or not filename3:
            return jsonify({"success": False, "error": "'image1', 'image2' and 'image3' are all required"}), 400

        img_data, output_filename = run_qwen_image_workflow(
            "tri", [filename1, filename2, filename3], prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/quad_blend', methods=['POST'])
def api_quad_blend():
    """四图编辑/融合接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        megapixels = float(request.form.get('megapixels', 1.0))
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0

        images = []
        for i in range(1, 5):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            images.append(fn)

        img_data, output_filename = run_qwen_image_workflow(
            "quad", images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/nona_blend', methods=['POST'])
def api_nona_blend():
    """九图编辑/融合接口"""
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '16:9 (Widescreen)').strip()
        megapixels = float(request.form.get('megapixels', 1.0))
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0

        images = []
        for i in range(1, 10):
            k = f'image{i}'
            fn = upload_to_comfyui(request.files[k]) if k in request.files else request.form.get(k, '').strip()
            if not fn:
                return jsonify({"success": False, "error": f"'{k}' is required"}), 400
            images.append(fn)

        img_data, output_filename = run_qwen_image_workflow(
            "nona", images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/multi_edit', methods=['POST'])
def api_multi_edit():
    """
    通用动态多图编辑接口:
    根据上传的图片数量 (1, 2, 3, 4, 9) 自动路由调用单图/双图/三图/四图/九图工作流。
    """
    try:
        prompt_text = request.form.get('prompt', '').strip()
        if not prompt_text:
            return jsonify({"success": False, "error": "Missing 'prompt' text"}), 400

        aspect_ratio = request.form.get('aspect_ratio', '3:4 (Portrait Standard)').strip()
        megapixels = float(request.form.get('megapixels', 1.0))
        negative_prompt = request.form.get('negative_prompt', '').strip()
        seed = int(request.form['seed']) if 'seed' in request.form and request.form['seed'].isdigit() else None
        steps = int(request.form['steps']) if 'steps' in request.form and request.form['steps'].isdigit() else 25
        cfg = float(request.form['cfg']) if 'cfg' in request.form else 1.0

        # 收集图片文件列表
        images = []
        uploaded_files = request.files.getlist('images')
        if uploaded_files:
            for f in uploaded_files:
                images.append(upload_to_comfyui(f))
        else:
            # 尝试 image, image1, image2 ...
            for k in ['image'] + [f'image{i}' for i in range(1, 10)]:
                if k in request.files:
                    images.append(upload_to_comfyui(request.files[k]))
                elif request.form.get(k):
                    images.append(request.form.get(k).strip())

        count = len(images)
        if count == 0:
            return jsonify({"success": False, "error": "No images provided"}), 400

        if count == 1:
            wf_type = "single"
        elif count == 2:
            wf_type = "dual"
        elif count == 3:
            wf_type = "tri"
        elif count == 4:
            wf_type = "quad"
        elif count == 9:
            wf_type = "nona"
        else:
            return jsonify({
                "success": False,
                "error": f"Unsupported image count: {count}. Qwen-Image 2.1 支持 1, 2, 3, 4 或 9 张图片。"
            }), 400

        img_data, output_filename = run_qwen_image_workflow(
            wf_type, images, prompt_text, aspect_ratio, seed, steps, cfg, negative_prompt, megapixels
        )

        buffer = BytesIO(img_data)
        buffer.seek(0)
        return send_file(buffer, mimetype='image/png', as_attachment=False, download_name=output_filename)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """健康检查接口"""
    try:
        resp = requests.get(f"http://{SERVER_ADDRESS}/system_stats", timeout=3)
        comfy_status = "connected" if resp.status_code == 200 else f"http_{resp.status_code}"
    except Exception as e:
        comfy_status = f"unreachable: {e}"

    return jsonify({
        "status": "ok",
        "service": "ComfyUI Qwen-Image 2.1 Edit Service",
        "comfyui": comfy_status,
        "server_address": SERVER_ADDRESS
    })


@app.route('/', methods=['GET'])
def index():
    """API 说明页"""
    return jsonify({
        "service": "ComfyUI Qwen-Image 2.1 Edit Service",
        "version": "2.1",
        "endpoints": {
            "/api/edit": "单图编辑 (image + prompt)",
            "/api/blend": "双图编辑/融合 (image1 + image2 + prompt)",
            "/api/triple_blend": "三图编辑/融合 (image1 + image2 + image3 + prompt)",
            "/api/quad_blend": "四图编辑/融合 (image1 ~ image4 + prompt)",
            "/api/nona_blend": "九图编辑/融合 (image1 ~ image9 + prompt)",
            "/api/multi_edit": "通用多图编辑 (自动识别 1/2/3/4/9 张图片)",
            "/health": "服务与 ComfyUI 状态检查"
        }
    })


if __name__ == "__main__":
    print("=" * 60)
    print("ComfyUI Qwen-Image 2.1 Edit Service v2.1")
    print("=" * 60)
    print(f"ComfyUI Server:  {SERVER_ADDRESS}")
    print(f"Service URL:     http://{HOST}:{PORT}")
    print("=" * 60)

    ensure_dir(COMFYUI_INPUT_DIR)
    ensure_dir(OUTPUT_IMAGE_DIR)
    app.run(host=HOST, port=PORT, threaded=True, debug=False)
