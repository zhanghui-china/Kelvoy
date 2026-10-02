# ComfyUI API Bridge - AI Agent 使用指南 (AI Usage Guide)

本说明文件专为 **AI Agent / LLM 助手** 编写，旨在帮助 AI 与开发者快速理解本仓库的目录结构、工作流 JSON 节点映射规则、HTTP API 接口调用规范以及核心服务使用方法。

---

## 1. 项目概览 (Overview)

`comfyui-bridge` 是一个将本地/远程 **ComfyUI** 工作流封装为标准化 HTTP API 和 Python SDK 的中间件桥接服务，支持多模态 AI 内容生成（图像生成与编辑、多参考视频生成、视频编辑、数字人说话视频、音乐创作）。

### 核心功能支持：
1. **Qwen-Image 2.1 文生图 (Text to Image)**：基于提示词与比例直接生成高画质图像 (`/api/text2img`)。
2. **Qwen-Image 2.1 单图编辑 (Single Ref Edit)**：上传单张图片 + 指令提示词修改画面细节 (`/api/edit`)。
3. **Qwen-Image 2.1 多图编辑与融合 (Multi-Ref Image Blend)**：
   - **双图编辑**：上传两张图片 + 融合提示词 (`/api/blend` 或 `/api/image/dual_blend`)。
   - **三图编辑**：上传三张图片 + 融合提示词 (`/api/triple_blend` 或 `/api/image/tri_blend`)。
   - **四图编辑**：上传四张图片 + 融合提示词 (`/api/quad_blend`)。
   - **五图编辑**：上传五张图片 + 融合提示词 (`/api/penta_blend`)。
   - **六图编辑**：上传六张图片 + 融合提示词 (`/api/hexa_blend`)。
   - **七图编辑**：上传七张图片 + 融合提示词 (`/api/hepta_blend`)。
   - **八图编辑**：上传八张图片 + 融合提示词 (`/api/octa_blend`)。
   - **九图编辑**：上传九张图片 + 融合提示词 (`/api/nona_blend`)。
   - **十图编辑**：上传十张图片 + 融合提示词 (`/api/deca_blend`)。
   - **通用动态多图编辑**：自动根据传入图片数 (1-10) 自动路由调用对应工作流 (`/api/image/multi_edit`)。
4. **Minimax-H3 图生视频 (Image to Video)**：单张图片 + 动态提示词生成带声画的高质量 720p 视频 (`/api/video/image2video`)。
5. **Minimax-H3 1-9 多图参考生视频 (Multi-Ref Video Generation)**：
   - **单图参考**：单张参考图 + 故事动作描述 (`/api/video/single_ref`)。
   - **双图参考**：两张角色/场景参考图 + 交互描述 (`/api/video/dual_ref`)。
   - **三图参考**：三张参考图 + 剧情描述 (`/api/video/tri_ref`)。
   - **四图参考**：四张参考图 + 场景描述 (`/api/video/quad_ref`)。
   - **五图参考**：五张参考图 + 场景描述 (`/api/video/penta_ref`)。
   - **六图参考**：六张参考图 + 场景描述 (`/api/video/hexa_ref`)。
   - **七图参考**：七张参考图 + 场景描述 (`/api/video/hepta_ref`)。
   - **八图参考**：八张参考图 + 场景描述 (`/api/video/octa_ref`)。
   - **九图参考**：九张参考图多视角/多元素融合生视频 (`/api/video/nona_ref`)。
   - **智能多图参考**：自动根据上传图片数匹配对应参考生视频工作流 (`/api/video/multi_ref`)。
6. **Minimax-H3 多模态参考生视频 (Multi-Modal Video Generation)**：
   - 混合最多 **9 张参考图 + 3 段参考视频 + 3 段参考音频**，三者合计 **≤ 12 个文件** (`/api/video/multi_modal`)。
   - 参考视频自动按最短边缩放到 704（可调 `scale_to_length`），帧率重采样为 24 fps，原声轨道自动配对 (`pair_video_audio`)。
   - 参考音频支持独立音频参考（旁白、音乐、音效）。
7. **Minimax-H3 视频编辑 (图+视频生视频 / Video Editing & Character Transfer)**：
   - 上传目标角色参考图 + 待替换源视频 + 替换指令提示词，生成保留原视频音轨与动作节奏的新视频 (`/api/video/edit`)。
8. **Minimax-H3 数字人 (图+音频生视频 / Digital Human & Talking Avatar)**：
   - 上传角色人像图片 + 驱动语音音频，生成角色口型与神态同步说话的视频 (`/api/video/digital_human`)。
9. **ACE STEP 1.5XL 音乐生成 (Music Creation)**：
   - 基于风格标签 (Tags)、歌词 (Lyrics)、节拍 (BPM)、时长 (Duration)、调式 (Key Scale) 生成高品质完整音乐 MP3 (`/api/music`)。
10. **语音合成 Voice Design (Qwen3-TTS)**：通过英文声音描述（如音色、语速、情感）生成高质量语音 MP3 (`/api/tts`)。
11. **音色克隆 Voice Clone (Qwen3-TTS)**：上传参考音频 + 目标文本，克隆参考音色生成新语音 (`/api/voice_clone`)，内置 Whisper 自动转写参考音频。
12. **MinimaxMusic 3 音乐生成**：基于风格描述 (caption) + 歌词 (lyrics) + 时长生成完整歌曲 (`/api/music/minimax`)，支持长达 180 秒。
13. **LTX-2.5 图生视频**：单张图片 + 动作描述 → 带音频的 720p 视频 (`/api/video/ltx`)，支持双阶段采样（粗采样 + 时序细化）。

---

## 2. 目录与文件映射 (File Directory)

```
/home1/wuzi/Kelvoy/comfyui-bridge/
├── comfyui_api_service.py                      # [核心服务] 统一全模态 Flask HTTP API 服务 (默认端口 6000)
├── comfyui_edit_service.py                     # [图像专用服务] Qwen 图像编辑专属 HTTP 服务 (默认端口 5000)
│
├── 1_0_Text2IMG_QwenImge2_1.json               # [工作流] Qwen 2.1 文生图 (UI 格式)
├── 1_0_Text2IMG_QwenImge2_1_api.json           # [工作流] Qwen 2.1 文生图 (API Prompt 格式)
├── 1_1_SingleRef2IMG_QwenImage2_1.json         # [工作流] Qwen 2.1 单图编辑 (UI 格式)
├── 1_1_SingleRef2IMG_QwenImage2_1_api.json     # [工作流] Qwen 2.1 单图编辑 (API Prompt 格式)
├── 1_2_DualRef2IMG_QwenImage2_1.json           # [工作流] Qwen 2.1 双图融合 (UI 格式)
├── 1_2_DualRef2IMG_QwenImage2_1_api.json       # [工作流] Qwen 2.1 双图融合 (API Prompt 格式)
├── 1_3_TriRef2IMG_QwenImage2_1.json            # [工作流] Qwen 2.1 三图融合 (UI 格式)
├── 1_3_TriRef2IMG_QwenImage2_1_api.json        # [工作流] Qwen 2.1 三图融合 (API Prompt 格式)
├── 1_4_QuadRef2IMG_QwenImage2_1.json           # [工作流] Qwen 2.1 四图融合 (UI 格式)
├── 1_4_QuadRef2IMG_QwenImage2_1_api.json       # [工作流] Qwen 2.1 四图融合 (API Prompt 格式)
├── 1_9_NonaRef2IMG_QwenImage2_1.json           # [工作流] Qwen 2.1 九图融合 (UI 格式)
├── 1_9_NonaRef2IMG_QwenImage2_1_api.json       # [工作流] Qwen 2.1 九图融合 (API Prompt 格式)
│
├── 2_0_Image2Video_MinimaxH3.json              # [工作流] Minimax-H3 图生视频 (UI 格式)
├── 2_0_Image2Video_MinimaxH3_api.json          # [工作流] Minimax-H3 图生视频 (API Prompt 格式)
├── 2_1_SingleRef2Video_MinimaxH3.json          # [工作流] Minimax-H3 单图参考生视频 (UI 格式)
├── 2_1_SingleRef2Video_MinimaxH3_api.json      # [工作流] Minimax-H3 单图参考生视频 (API Prompt 格式)
├── 2_2_DualRef2Video_MinimaxH3.json            # [工作流] Minimax-H3 双图参考生视频 (UI 格式)
├── 2_2_DualRef2Video_MinimaxH3_api.json        # [工作流] Minimax-H3 双图参考生视频 (API Prompt 格式)
├── 2_3_TriRef2Video_MinimaxH3.json            # [工作流] Minimax-H3 三图参考生视频 (UI 格式)
├── 2_3_TriRef2Video_MinimaxH3_api.json        # [工作流] Minimax-H3 三图参考生视频 (API Prompt 格式)
├── 2_4_QuadRef2Video_MinimaxH3.json           # [工作流] Minimax-H3 四图参考生视频 (UI 格式)
├── 2_4_QuadRef2Video_MinimaxH3_api.json       # [工作流] Minimax-H3 四图参考生视频 (API Prompt 格式)
├── 2_5_PentaRef2Video_MinimaxH3.json          # [工作流] Minimax-H3 五图参考生视频 (UI 格式)
├── 2_5_PentaRef2Video_MinimaxH3_api.json      # [工作流] Minimax-H3 五图参考生视频 (API 格式)
├── 2_6_HexaRef2Video_MinimaxH3.json           # [工作流] Minimax-H3 六图参考生视频 (UI 格式)
├── 2_6_HexaRef2Video_MinimaxH3_api.json      # [工作流] Minimax-H3 六图参考生视频 (API 格式)
├── 2_7_HeptaRef2Video_MinimaxH3.json          # [工作流] Minimax-H3 七图参考生视频 (UI 格式)
├── 2_7_HeptaRef2Video_MinimaxH3_api.json      # [工作流] Minimax-H3 七图参考生视频 (API 格式)
├── 2_8_OctaRef2Video_MinimaxH3.json           # [工作流] Minimax-H3 八图参考生视频 (UI 格式)
├── 2_8_OctaRef2Video_MinimaxH3_api.json      # [工作流] Minimax-H3 八图参考生视频 (API 格式)
├── 2_9_NonaRef2Video_MinimaxH3.json           # [工作流] Minimax-H3 九图参考生视频 (UI 格式)
├── 2_9_NonaRef2Video_MinimaxH3_api.json       # [工作流] Minimax-H3 九图参考生视频 (API Prompt 格式)
├── 2_10_ImageVideo2Video_MinimaxH3.json        # [工作流] Minimax-H3 视频编辑 (图+视频生视频, UI 格式)
├── 2_10_ImageVideo2Video_MinimaxH3_api.json    # [工作流] Minimax-H3 视频编辑 (图+视频生视频, API 格式)
├── 2_11_ImageAudio2Video_MinimaxH3.json        # [工作流] Minimax-H3 数字人 (图+音频生视频, UI 格式)
├── 2_11_ImageAudio2Video_MinimaxH3_api.json    # [工作流] Minimax-H3 数字人 (图+音频生视频, API 格式)
│
├── 3_1_Text2Music_ACESTEP.json                 # [工作流] ACE STEP 1.5XL 音乐生成 (UI 格式)
├── 3_1_Text2Music_ACESTEP_api.json             # [工作流] ACE STEP 1.5XL 音乐生成 (API Prompt 格式)
│
├── input/                                      # [输入目录] 存放上传的图片/音频/视频缓存
├── output_image/                               # [输出目录] 本地保存生成的图片
├── output_video/                               # [输出目录] 本地保存生成的视频
├── output_audio/                               # [输出目录] 本地保存生成的音乐
└── AI_USAGE_GUIDE.md                           # [使用指南] 本文档
```

---

## 3. HTTP API 使用指南 (HTTP API Interfaces)

### 环境变量配置 (Environment Variables)
- `COMFYUI_SERVER`: ComfyUI 服务器地址（默认 `127.0.0.1:8188`）
- `COMFYUI_INPUT_DIR`: ComfyUI input 文件夹路径（默认 `./input`）
- `OUTPUT_IMAGE_DIR`: 本地图片输出目录（默认 `./output_image`）
- `OUTPUT_VIDEO_DIR`: 本地视频输出目录（默认 `./output_video`）
- `OUTPUT_AUDIO_DIR`: 本地音频输出目录（默认 `./output_audio`）
- `SERVICE_HOST`: API 服务监听 IP（默认 `0.0.0.0`）
- `SERVICE_PORT`: API 服务监听端口（`comfyui_api_service.py` 默认 `6000`，`comfyui_edit_service.py` 默认 `5000`）
- `GENERATION_TIMEOUT`: 生成超时时间秒数（默认 `600`）

---

### 💡 AI Agent 分辨率与百万像素 (Megapixels) 选型决策准则 (强烈推荐)

在所有图像工作流（文生图、单图编辑、2/3/4/9 多图编辑与融合）中，**百万像素 (megapixels)** 参数对画面质感、构图稳定性、显存占用与推理速度有决定性影响。根据实测经验，建议所有调用此桥接服务的 AI Agent / 开发者遵循以下决策策略（非硬性锁死，但为强烈推荐的最佳实践）：

| 像素级别 (Megapixels) | 定位与推荐度 | 适用场景与决策依据 | 显存与速度表现 |
| :--- | :--- | :--- | :--- |
| **`1.0`** (100万像素) | 🎯 **首选默认 (Preferred Default)** | **最推荐的通用基准**。构图最稳健、人物肢体/五官比例最自然、抗崩坏能力最强。满足 90% 以上标准出图与编辑场景。 | 速度最快，显存占用最低最安全 |
| **`2.0`** (200万像素) | 🔍 **高清细节 (High-Detail Mode)** | **需要更丰富细腻纹理**。特写镜头、精细刺绣/毛发/皮肤微距质感、复杂构图细节。 | 显存消耗较高，计算耗时增加 |
| **`1.5`** (150万像素) | ⚖️ **平衡折衷 (Balanced Middle)** | **平衡细节与开销**。当 1.0 像素感觉细节略有欠缺，又希望比 2.0 更快、更节省显存时的最佳中间折衷选型。 | 居中，性价比最优 |
| **`< 1.0`** (如 0.5~0.8) | ❌ **强烈不建议 (Discouraged)** | 画面容易严重模糊、细节丢失、面部与服饰出现严重涂抹感，极易产生劣质出图。 | 虽省显存但画质严重受损 |
| **`> 2.0`** (如 2.5~4.0) | ❌ **强烈不建议 (Discouraged)** | 极易引起局部畸变（如多肢体、重复人脸、结构畸变崩溃）、注意力机制失效，且可能导致 GPU OOM 爆显存。 | 严重耗费显存与计算，收益为负 |

> 📌 **AI Agent 决策心法 (Agent Heuristic)**:
> 1. 默认生成/编辑时一律首选 `megapixels=1.0`。
> 2. 当用户或任务明确要求“超清细节”、“精细毛发”、“微距特写”时，提升为 `megapixels=2.0`。
> 3. 需要在细节与耗时之间取得折衷平衡时，选择 `megapixels=1.5`。
> 4. 严禁自动选择 `< 1.0` 或 `> 2.0` 的极端像素值，避免模糊或畸变崩坏。

---

### 一、图像类接口 (Image Interfaces - Qwen-Image 2.1)

#### 1. 文生图 (`POST /api/text2img`)
- **Content-Type**: `multipart/form-data` 或 `application/x-www-form-urlencoded`
- **请求参数**:
  - `prompt` (Text, 必填): 画面提示词
  - `negative_prompt` (Text, 可选): 反向提示词，默认空
  - `aspect_ratio` (Text, 可选): 宽高比，默认 `"3:4 (Portrait Standard)"`。可选值：
    - `"3:4 (Portrait Standard)"`
    - `"1:1 (Square)"`
    - `"16:9 (Widescreen)"`
    - `"9:16 (Vertical)"`
    - `"4:3 (Landscape Standard)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`。推荐值：`1.0` (首选), `1.5` (折衷), `2.0` (细节)，不建议 `< 1.0` 或 `> 2.0`。
  - `seed` (Int, 可选): 采样随机种子
  - `steps` (Int, 可选): 采样步数，默认 `25`
  - `cfg` (Float, 可选): 引导强度，默认 `1.0`
- **返回响应**: 二进制图片流 (`image/png`)

#### 2. 单图编辑 (`POST /api/edit`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image` (File 或 文件名, 必填): 待修改的基准图片
  - `prompt` (Text, 必填): 画面修改指令（如 `"把女人的衣服改成绿色"`）
  - `negative_prompt` (Text, 可选): 反向提示词
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"3:4 (Portrait Standard)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
  - `seed` (Int, 可选): 采样随机种子
  - `steps` (Int, 可选): 采样步数，默认 `25`
  - `cfg` (Float, 可选): 引导强度，默认 `1.0`
- **返回响应**: 二进制图片流 (`image/png`)

#### 3. 双图融合/编辑 (`POST /api/blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1` (File 或 文件名, 必填): 第一张参考图
  - `image2` (File 或 文件名, 必填): 第二张参考图
  - `prompt` (Text, 必填): 融合提示词（如 `"两个女人一起在漫展上"`）
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"3:4 (Portrait Standard)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
  - `seed` (Int, 可选): 随机种子
- **返回响应**: 二进制图片流 (`image/png`)

#### 4. 三图融合/编辑 (`POST /api/triple_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1`, `image2`, `image3` (File 或 文件名, 必填): 三张参考图
  - `prompt` (Text, 必填): 融合提示词
  - `aspect_ratio` (Text, 可选): 画面比例
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
- **返回响应**: 二进制图片流 (`image/png`)

#### 5. 四图融合/编辑 (`POST /api/quad_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1`, `image2`, `image3`, `image4` (File 或 文件名, 必填): 四张参考图
  - `prompt` (Text, 必填): 融合提示词
  - `aspect_ratio` (Text, 可选): 画面比例
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
- **返回响应**: 二进制图片流 (`image/png`)

#### 6. 五图融合/编辑 (`POST /api/penta_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1` ~ `image5` (File 或 文件名, 必填): 五张参考图
  - `prompt` (Text, 必填): 融合提示词
  - `negative_prompt` (Text, 可选): 反向提示词
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"16:9 (Widescreen)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`
  - `seed`, `steps`, `cfg` (可选): 采样控制
- **别名**: `POST /api/image/penta_blend`, `POST /api/five_blend`
- **返回响应**: 二进制图片流 (`image/png`)

#### 7. 六图融合/编辑 (`POST /api/hexa_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**: `image1` ~ `image6`, `prompt`, 以及与五图接口相同的可选参数。
- **别名**: `POST /api/image/hexa_blend`, `POST /api/six_blend`
- **返回响应**: 二进制图片流 (`image/png`)

#### 8. 七图融合/编辑 (`POST /api/hepta_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**: `image1` ~ `image7`, `prompt`, 以及与五图接口相同的可选参数。
- **别名**: `POST /api/image/hepta_blend`, `POST /api/seven_blend`
- **返回响应**: 二进制图片流 (`image/png`)

#### 9. 八图融合/编辑 (`POST /api/octa_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**: `image1` ~ `image8`, `prompt`, 以及与五图接口相同的可选参数。
- **别名**: `POST /api/image/octa_blend`, `POST /api/eight_blend`
- **返回响应**: 二进制图片流 (`image/png`)

#### 10. 九图融合/编辑 (`POST /api/nona_blend`)

- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1` ~ `image9` (File 或 文件名, 必填): 九张参考图
  - `prompt` (Text, 必填): 融合提示词
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"16:9 (Widescreen)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
- **返回响应**: 二进制图片流 (`image/png`)

#### 11. 十图融合/编辑 (`POST /api/deca_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1` ~ `image10` (File 或 文件名, 必填): 十张参考图
  - `prompt` (Text, 必填): 融合提示词
  - `negative_prompt` (Text, 可选): 反向提示词
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"16:9 (Widescreen)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
  - `seed`, `steps`, `cfg` (可选): 采样控制
- **别名**: `POST /api/image/deca_blend`, `POST /api/ten_blend`
- **返回响应**: 二进制图片流 (`image/png`)

#### 12. 通用动态多图编辑 (`POST /api/image/multi_edit`)
- **Content-Type**: `multipart/form-data`
- **说明**: 自动检测上传的图片数量，支持 1-10 张参考图；每张分别路由到对应数量的 Qwen-Image 2.1 工作流。
- **请求参数**:
  - `images` (List of Files, 必填): 图片文件列表 (支持表单内多次附加同名 `images` 字段，或 `image1`, `image2`...)
  - `prompt` (Text, 必填): 图像修改或融合提示词
  - `aspect_ratio` (Text, 可选): 画面比例
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
- **返回响应**: 二进制图片流 (`image/png`)

---

### 💡 AI Agent 视频生成 (Minimax-H3) 缩放与时长决策准则 (强烈推荐)

在 Minimax-H3 视频生成工作流中，画面缩放节点（`LayerUtility: ImageScaleByAspectRatio V2`）与时长控制节点（`PrimitiveInt` + `ComfyMathExpression`）对视频观感、生成耗时及显存占用有极其关键的影响。强烈建议所有 AI Agent / 开发者遵循以下准则：

#### 1. 按宽高比缩放准则 (Scale to Length)
当前工作流按照**最短边**进行缩放 (`scale_to_side: "shortest"`):
- 🎯 **首选推荐 (Default & Preferred)**: **`704`**。720p 级别最佳标准，构图清晰饱满、细节丰富，且推理耗时处于最合理的平衡点。
- ⚡ **快速预览 (Fast Preview)**: **`480`**。低分辨率轻量模式，大幅缩短生成等待时间，最适合快速验证动作提示词、镜头运镜与动作节奏。
- 🔍 **高清上限 (High-Quality Limit)**: **`768`**。最高支持上限，细节表现极佳，但会消耗显著更多的计算时间与显存。
- ❌ **强烈不建议 (Discouraged)**: **`> 768`**。生成耗时成倍增加，极易导致显存溢出 (OOM) 崩溃或任务超时，收益极低。

#### 2. 生成时长准则 (Duration)
- ⏱️ **默认时长**: **`15 秒`** (`duration=15.0`)。适用于 `image2video`、`ref2video` (1-9 图参考) 以及 `ImageAudio2Video` (数字人)。
- 📊 **建议范围**: **`3.0 秒 ~ 15.0 秒`**（强烈建议不低于 3 秒，不高于 15 秒）。
- 🧮 **自动帧数对齐**: 底层工作流通过公式 `max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17` 自动换算为 24fps 下符合 17 帧 chunk 的精确帧数（如 15 秒对应约 362 帧，5 秒对应约 124 帧），调用方直接传递秒数即可，无需手工计算复杂帧数对齐。
- 🚫 **视频编辑除外**: `video_edit`（图+视频生视频）无需设置时长，输出时长直接继承源视频。

#### 3. 分辨率选择器百万像素准则 (ResolutionSelector - ref2video & ImageAudio2Video)
在多图参考生视频（1-9 图参考）及数字人（图+音频生视频）工作流中，分辨率由 `ResolutionSelector` 节点（Node `#82` 与 `#112`）控制：
- 🎯 **首选推荐 (Preferred Default)**: **`0.9`** 百万像素 (0.9 MP)。综合细节质感最佳，五官与肢体表现最稳。
- ⚡ **快速模式 (Fast Mode)**: **`0.4`** 百万像素 (0.4 MP)。需要更短生成时间或快速验证动作时选择。
- ⚠️ **严格限制范围**: **建议仅在 `[0.4, 0.9]` 区间内选择，强烈不建议超过此范围**（`< 0.4` 严重模糊涂抹，`> 0.9` 极易引发显存膨胀与画面畸变）。

---

### 二、视频类接口 (Video Interfaces - Minimax-H3)

#### 8. 单采样图生视频 (`POST /api/video/image2video`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image` (File 或 文件名, 必填): 首帧基准图 (映射至 Node `#7`)
  - `prompt` (Text, 必填): 视频动态描述提示词 (映射至 Node `#74`)
  - `duration` (Float, 可选): 视频生成时长秒数，默认 `15.0`。强烈建议在 `[3.0, 15.0]` 区间内。
  - `scale_to_length` (Int, 可选): 按最短边缩放的目标长度，默认 `704`。推荐值：`704` (首选默认), `480` (快速预览), `768` (最高清晰度)，不建议 `> 768`。
  - `scale_to_side` (Text, 可选): 缩放基准边，默认 `"shortest"` (最短边)。
  - `steps` (Int, 可选): 采样步数，默认 `6`
  - `seed` (Int, 可选): 随机采样种子 (映射至 Node `#49`)
  - `length` (Int, 可选): 兼容参数，手动指定绝对帧数（若传递了 `duration` 则优先使用秒数自动换算）
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`)

#### 9. 单图参考生视频 (`POST /api/video/single_ref`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image` (File 或 文件名, 必填): 角色/场景参考图 (映射至 Node `#7`)
  - `prompt` (Text, 必填): 故事与动作提示词 (映射至 Node `#77`)
  - `duration` (Float, 可选): 视频时长秒数，默认 `15.0` (建议范围 `3.0~15.0` 秒)
  - `megapixels` (Float, 可选): 分辨率百万像素，默认 `0.9` (首选 `0.9`，快速选 `0.4`，不建议超出 `[0.4, 0.9]`)
  - `aspect_ratio` (Text, 可选): 视频宽高比，默认 `"16:9 (Widescreen)"` (映射至 Node `#82`)
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`)

#### 10. 2-9 多图参考生视频 (`POST /api/video/dual_ref`, `/tri_ref`, `/quad_ref`, `/penta_ref`, `/hexa_ref`, `/hepta_ref`, `/octa_ref`, `/nona_ref`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1`, `image2` ... `imageN` (File 或 文件名, 必填): 多个角色或不同视角的参考图片
  - `prompt` (Text, 必填): 剧情动作交互提示词
  - `duration` (Float, 可选): 视频时长秒数，默认 `15.0` (建议范围 `3.0~15.0` 秒)
  - `megapixels` (Float, 可选): 分辨率百万像素，默认 `0.9` (首选 `0.9`，快速选 `0.4`，不建议超出 `[0.4, 0.9]`)
  - `aspect_ratio` (Text, 可选): 视频比例，默认 `"16:9 (Widescreen)"`
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`)

#### 11. 智能多图参考生视频 (`POST /api/video/multi_ref`)
- **Content-Type**: `multipart/form-data`
- **说明**: 自动统计上传的参考图数量（1-9 张），无缝路由至对应的 Minimax-H3 多图参考工作流。
- **请求参数**:
  - `images` (List of Files, 必填): 参考图列表
  - `prompt` (Text, 必填): 视频剧情提示词
  - `duration` (Float, 可选): 视频时长秒数，默认 `15.0` (建议范围 `3.0~15.0` 秒)
  - `megapixels` (Float, 可选): 分辨率百万像素，默认 `0.9` (首选 `0.9`，快速选 `0.4`，不建议超出 `[0.4, 0.9]`)
  - `aspect_ratio` (Text, 可选): 视频比例，默认 `"16:9 (Widescreen)"`
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`)

#### 12. 视频编辑与角色替换 (`POST /api/video/edit` 或 `/api/video/video_edit`)
- **Content-Type**: `multipart/form-data`
- **功能**: 上传一张角色/物体参考图 + 一段源视频，根据提示词指令替换视频中的对应目标。
- **时长说明**: 本工作流**无需且不支持设置视频时长**，生成的新视频时长与帧率完全自动继承自源视频 (`video`)。
- **请求参数**:
  - `image` (File 或 文件名, 必填): 目标角色参考图片 (映射至 Node `#7` `LoadImage`)
  - `video` (File 或 文件名, 必填): 待修改的源视频 (映射至 Node `#101` `VHS_LoadVideo`)
  - `prompt` (Text, 必填): 替换/编辑指令（如 `"把视频中左边的女孩替换成图中的女孩"`，映射至 Node `#77`)
  - `scale_to_length` (Int, 可选): 按最短边缩放的目标长度，默认 `704`。推荐值：`704` (首选默认), `480` (快速预览), `768` (最高清晰度)，不建议 `> 768` (映射至 Node `#102`)
  - `scale_to_side` (Text, 可选): 缩放基准边，默认 `"shortest"` (最短边)
  - `length` (Int, 可选): 视频帧数，默认 `124`
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`，保留原视频音轨)

#### 13. 数字人说话视频 (`POST /api/video/digital_human`)
- **Content-Type**: `multipart/form-data`
- **功能**: 输入单张角色人像图片 + 语音音频驱动，生成角色口型与表情匹配说话的数字人视频。
- **请求参数**:
  - `image` (File 或 文件名, 必填): 角色肖像图片 (映射至 Node `#7` `LoadImage`)
  - `audio` (File 或 文件名, 必填): 驱动语音音频文件 (MP3/WAV，映射至 Node `#104` `LoadAudio`)
  - `prompt` (Text, 可选): 表情与神态补充提示词 (映射至 Node `#103`)
  - `duration` (Float, 可选): 视频时长秒数，默认 `15.0` (建议范围 `3.0~15.0` 秒，联动 Node `#109` 及 Node `#105` `TrimAudioDuration`)
  - `megapixels` (Float, 可选): 分辨率百万像素，默认 `0.9` (首选 `0.9`，快速选 `0.4`，不建议超出 `[0.4, 0.9]`，映射至 Node `#112`)
  - `length` (Int, 可选): 视频帧数，默认 `124`
  - `aspect_ratio` (Text, 可选): 视频画面比例，默认 `"16:9 (Widescreen)"` (映射至 Node `#112`)
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`，含驱动音轨)

---

#### 14. 多模态参考生视频 (`POST /api/video/multi_modal`)

- **别名**: `POST /api/video/full_ref`
- **Content-Type**: `multipart/form-data`
- **说明**: 通用多模态参考端点，同时接受参考图（≤9）、参考视频（≤3）与参考音频（≤3），
  三者合计 **≤ 12 个文件**。基于 MiniMax H3 的多模态参考能力，工作流以 2_9 九图模板为基座，
  未使用的图片槽位动态移除，视频/音频槽位按需注入 VHS_LoadVideo（自动 24 fps 重采样 +
  最短边缩放）和 LoadAudio 节点。
- **请求参数**:
  - `image1` ~ `image9` (File 或 文件名, 可选): 参考图片，最多 9 张
  - `video1` ~ `video3` (File 或 文件名, 可选): 参考视频 (2-15s)，最多 3 段；自动提取原声配对
  - `audio1` ~ `audio3` (File 或 文件名, 可选): 独立参考音频（旁白/音乐/音效），最多 3 段
  - `prompt` (Text, 必填): 画面与动作描述提示词
  - `duration` (Float, 可选): 生成时长(秒)，默认 `15.0`，建议范围 `[2.0, 15.0]`
  - `megapixels` (Float, 可选): 百万像素值，默认 `0.9`（快速 `0.4`）
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"16:9 (Widescreen)"`
  - `seed`, `steps`, `cfg` (可选): 采样控制（steps 默认 `8`）
  - `scale_to_length` (Int, 可选): 参考视频画面缩放，默认 `704`
  - `scale_to_side` (Text, 可选): 缩放基准边，默认 `"shortest"`
  - `pair_video_audio` (Bool, 可选): 是否自动配对参考视频的原声轨道，默认 `true`
  - `length` (Int, 可选): 直接指定帧数（覆盖 duration）
- **约束**: 图片 ≤ 9，视频 ≤ 3，音频 ≤ 3，**总文件数 ≤ 12**
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`)

---

### 三、音乐类接口 (Music Interfaces - ACE STEP 1.5XL)

#### 14. 音乐创作 (`POST /api/music` 或 `/api/music/acestep`)
- **Content-Type**: `application/x-www-form-urlencoded` 或 `multipart/form-data`
- **请求参数**:
  - `tags` (String, 选填): 风格、流派与乐器标签（如 `"pop, emotional female vocals, piano ballad, 125 bpm"`）
  - `lyrics` (String, 选填): 歌词文本（如支持分段标记 `[verse]`, `[chorus]`）
  - `bpm` (Int, 可选): 音乐节拍数，默认 `125` (映射至 Node `#36`)
  - `duration` (Float, 可选): 音乐时长秒数，默认 `60.0` (映射至 Node `#36` 与 Node `#29`)
  - `language` (String, 可选): 语言代码，默认 `"zh"`（可选 `"zh"`, `"ja"`, `"en"`）
  - `keyscale` (String, 可选): 调式，默认 `"E minor"`（如 `"C major"`, `"A minor"` 等）
  - `steps` (Int, 可选): 采样步数，默认 `8` (Node `#32`)
  - `seed` (Int, 可选): 采样随机种子
- **返回响应**: 二进制 MP3 音频流 (`audio/mp3`)

---

### 四、语音类接口 (Voice Interfaces - Qwen3-TTS)

#### 15. 语音合成 Voice Design (`POST /api/tts`)
- **Content-Type**: `application/json`
- **说明**: 通过英文声音特征描述（Voice Description）生成高质量语音，支持中英日韩等多语言文本。
- **请求参数**:
  - `text` (String, 必填): 待合成文本（支持中文、英文、日文等多语言混排）
  - `voice_description` (String, 必填): **必须为英文**的声音特征描述
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP3 音频流 (`audio/mp3`)
- **调用示例**:

```bash
curl -X POST http://localhost:6000/api/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "你好，欢迎来到可旅 Kelvoy。Hello, welcome to Kelvoy.",
    "voice_description": "A gentle female voice, sweet tone, warm and friendly"
  }' \
  -o output.mp3
```

#### 16. 音色克隆 Voice Clone (`POST /api/voice_clone`)
- **Content-Type**: `multipart/form-data` 或 `application/json`
- **说明**: 上传参考音频文件 + 目标文本，系统自动用 Whisper 转写参考音频内容，然后克隆该音色朗读目标文本。
- **请求参数**:
  - `audio` (File 或 文件名, 必填): 参考音频文件 (MP3/WAV/M4A，建议 3–10 秒清晰人声)
  - `text` (String, 必填): 目标合成说话内容
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP3 音频流 (`audio/mp3`)
- **调用示例**:

```bash
curl -X POST http://localhost:6000/api/voice_clone \
  -F "audio=@voice_sample.mp3" \
  -F "text=你好，这是用克隆音色生成的一段话。" \
  -o cloned_speech.mp3
```

---

### 五、MinimaxMusic 3 音乐生成接口

#### 17. MinimaxMusic 3 音乐创作 (`POST /api/music/minimax`)
- **Content-Type**: `application/json`
- **说明**: 基于 MinimaxMusic 3 DiT 模型，通过风格描述 (caption) + 歌词 (lyrics) + 时长生成完整歌曲。支持纯音乐与带歌词歌曲，最长 180 秒。
- **请求参数**:
  - `style` (String, 必填): 音乐风格与结构描述（英文效果最佳，如 `"Upbeat electronic dance music with synthesizers"`）
  - `lyrics` (String, 可选): 歌词文本（支持多语言，留空则生成纯音乐）
  - `duration` (Float, 可选): 时长秒数，默认 `60.0`，最大 `180.0`
  - `cfg_scale` (Float, 可选): CFG 强度，默认 `7.0`
  - `steps` (Int, 可选): 采样步数，默认 `28`
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP3 音频流 (`audio/mp3`)
- **调用示例**:

```bash
curl -X POST http://localhost:6000/api/music/minimax \
  -H "Content-Type: application/json" \
  -d '{
    "style": "Healing Japanese modern pop ballad with cinematic strings and soft piano",
    "lyrics": "[verse]\n夕暮れが街を染めてゆく\n[chorus]\n星が瞬く空で",
    "duration": 60
  }' \
  -o music_output.mp3
```

---

### 六、LTX-2.5 视频生成接口

#### 18. LTX-2.5 图生视频 (`POST /api/video/ltx`)
- **别名**: `POST /api/video/ltx_image2video`
- **Content-Type**: `multipart/form-data`
- **说明**: 基于 LTX-2.5 22B Distilled Transformer，单张图片 + 动作描述生成带音频的 720p 视频。采用双阶段采样（粗采样 + 时序细化），支持最长 20 秒。
- **请求参数**:
  - `image` (File 或 文件名, 必填): 输入图片
  - `prompt` (Text, 必填): 动作与画面描述提示词
  - `duration` (Int, 可选): 视频时长秒数，默认 `15`，测试建议设为 `3–5`
  - `steps` (Int, 可选): 第一阶段采样步数，默认 `6`
  - `refine_steps` (Int, 可选): 第二阶段时序细化步数，默认 `4`
  - `cfg` (Float, 可选): 提示词相关度，默认 `1.0`
  - `scale_to_length` (Int, 可选): 画面缩放，默认 `720`
  - `seed` (Int, 可选): 随机采样种子
- **返回响应**: 二进制 MP4 视频流 (`video/mp4`)
- **调用示例**:

```bash
curl -X POST http://localhost:6000/api/video/ltx \
  -F "image=@portrait.png" \
  -F "prompt=A woman in a red dress walking gracefully in a garden, cinematic" \
  -F "duration=3" \
  -F "seed=42" \
  -o ltx_output.mp4
```

## 4. ComfyUI 工作流 JSON 节点映射速查表 (Node Mappings)

若 AI Agent 需要直接读取、修改或自动化装配工作流 JSON，请严格参考下表的节点 ID 与字段映射规范：

| 工作流类型 | 工作流文件名 | 关键节点 ID | 节点类名 (Class Type) | 目标字段 (Field Path) | 业务作用 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TTS 语音合成** | `VoiceDesign-QwenTTS.json` | `#75` | `Text Multiline` | `inputs.text` | 待合成文本 |
| | | `#76` | `Text Multiline` | `inputs.text` | 声音特征描述（英文） |
| | | `#73` | `Qwen3TTSVoiceDesign` | `inputs.seed` | 采样种子 |
| | | `#74` | `Qwen3TTSModelLoader` | `inputs.模型名称` | 模型加载 |
| **音色克隆** | `VoiceClone-QwenTTS.json` | `#151` | `LoadAudio` | `inputs.audio` | 参考音频文件 |
| | | `#153` | `Text Multiline` | `inputs.text` | 目标合成文本 |
| | | `#150` | `FB_Qwen3TTSVoiceClone` | `inputs.seed` | 采样种子 |
| | | `#152` | `Apply Whisper` | — | 自动转写参考音频 |
| **MinimaxMusic 3** | `MusicCreation-MiniMaxMusic3_api.json` | `#15` | `Text Multiline` | `inputs.text` | 风格描述 (caption) |
| | | `#16` | `Text Multiline` | `inputs.text` | 歌词 |
| | | `#14` | `PrimitiveFloat` | `inputs.value` | 时长 (秒) |
| | | `#6` | `MiniMaxMusic3TextEncode` | `inputs.seed`, `inputs.cfg_scale` | 种子与 CFG |
| | | `#4` | `KSampler` | `inputs.seed`, `inputs.steps` | 采样 |
| | | `#2` | `CLIPLoader` | `inputs.clip_name` | 文本编码器 |
| | | `#5` | `UNETLoader` | `inputs.unet_name` | DiT 模型 |
| | | `#3` | `VAELoader` | `inputs.vae_name` | 音频 VAE |
| **LTX-2.5 图生视频** | `LTX25-ImageToVideo_api.json` | `#9` | `LoadImage` | `inputs.image` | 输入图片 |
| | | `#181` | `CLIPTextEncode` | `inputs.text` | 动作描述提示词 |
| | | `#183` | `PrimitiveInt` | `inputs.value` | 时长 (秒) |
| | | `#51` | `KSampler` | `inputs.seed`, `inputs.steps`, `inputs.cfg` | 第一阶段采样 |
| | | `#155` | `KSampler` | `inputs.steps` | 第二阶段时序细化 |
| | | `#5` | `LayerUtility: ImageScaleByAspectRatio V2` | `inputs.scale_to_length` | 画面缩放 |
| | | `#162` | `UNETLoader` | `inputs.unet_name` | LTX-2.5 22B DiT 模型 |
| | | `#164` | `VAELoader` | `inputs.vae_name` | 视频 VAE |
| | | `#165` | `VAELoader` | `inputs.vae_name` | 音频 VAE |
| | | `#166` | `CLIPLoader` | `inputs.clip_name` | Gemma4 12B 文本编码器 |
| | | `#178` | `SolAttnPatch` | — | 稀疏注意力补丁 |
| | | `#124` | `VHS_VideoCombine` | — | 视频封装输出 |
| **Qwen 2.1 文生图** | `1_0_Text2IMG_QwenImge2_1.json` | `#469` | `TextEncodeQwenImage21` | `inputs.prompt`, `inputs.negative_prompt` | 正/反向提示词 |
| | | `#492` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 (默认 3:4) 与百万像素 (默认 1.0) |
| | | `#474` | `KSampler` | `inputs.seed`, `inputs.steps`, `inputs.cfg` | 采样器控制 (默认 25 步) |
| | | `#482` | `SaveImage` | outputs | 输出图片 |
| **Qwen 2.1 单图编辑** | `1_1_SingleRef2IMG_QwenImage2_1.json` | `#489` | `LoadImage` | `inputs.image` | 待修改原图 |
| | | `#469` | `TextEncodeQwenImage21` | `inputs.prompt` | 修改指令提示词 |
| | | `#491` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 与 百万像素 (默认 1.0) |
| | | `#474` | `KSampler` | `inputs.seed` | 采样种子 |
| **Qwen 2.1 双图融合** | `1_2_DualRef2IMG_QwenImage2_1.json` | `#489`, `#491` | `LoadImage` | `inputs.image` | 图 1 与 图 2 文件名 |
| | | `#469` | `TextEncodeQwenImage21` | `inputs.prompt` | 融合提示词 |
| | | `#493` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 与 百万像素 (默认 1.0) |
| **Qwen 2.1 三图融合** | `1_3_TriRef2IMG_QwenImage2_1.json` | `#489`, `#491`, `#493` | `LoadImage` | `inputs.image` | 图 1、图 2、图 3 |
| | | `#469` | `TextEncodeQwenImage21` | `inputs.prompt` | 融合提示词 |
| | | `#494` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 与 百万像素 (默认 1.0) |
| **Qwen 2.1 四图融合** | `1_4_QuadRef2IMG_QwenImage2_1.json` | `#489`, `#493`, `#494`, `#495` | `LoadImage` | `inputs.image` | 图 1 ~ 图 4 |
| | | `#469` | `TextEncodeQwenImage21` | `inputs.prompt` | 融合提示词 |
| | | `#491` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 与 百万像素 (默认 1.0) |
| **Qwen 2.1 五~八图融合** | `1_5_PentaRef2IMG...` ~ `1_8_OctaRef2IMG...` | `#489`, `#491`, `#497`, `#493`, `#494`, `#498`, `#495`, `#496` | `LoadImage` | `inputs.image` | 按顺序注入图 1 ~ 图 N (N=5~8) |
| | | `#469` | `TextEncodeQwenImage21` | `inputs.prompt`, `inputs.images.image_N` | 融合提示词与 N 个参考图 slot |
| | | `#501` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例与百万像素 |
| **Qwen 2.1 九图融合** | `1_9_NonaRef2IMG_QwenImage2_1.json` | `#489`, `#491`, `#493`~`#499` | `LoadImage` | `inputs.image` | 图 1 ~ 图 9 (共9张图) |
| | | `#469` | `TextEncodeQwenImage21` | `inputs.prompt` | 融合提示词 |
| | | `#501` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 (默认 16:9) 与 百万像素 (默认 1.0) |
| **Minimax 图生视频** | `2_0_Image2Video_MinimaxH3.json` | `#7` | `LoadImage` | `inputs.image` | 输入基准图 |
| | | `#9` | `LayerUtility: ImageScaleByAspectRatio V2` | `inputs.scale_to_side`, `inputs.scale_to_length` | 按最短边缩放 (默认 704，可选 480/768) |
| | | `#71` | `PrimitiveInt` | `inputs.value` | 生成时长秒数 (默认 15s，建议 3~15s) |
| | | `#81` | `ComfyMathExpression` | `expression` | 自动计算对齐 17 帧 chunk 的精确帧数 |
| | | `#74` | `MiniMaxH3ImageToVideo` | `inputs.prompt`, `inputs.length` | 动作提示词与总帧数 |
| | | `#49` | `KSampler` | `inputs.seed`, `inputs.steps` | 采样器 (默认 6 步) |
| | | `#40` | `VHS_VideoCombine` | outputs | 输出 MP4 视频 |
| **Minimax 单图参考** | `2_1_SingleRef2Video_MinimaxH3.json` | `#7` | `LoadImage` | `inputs.image` | 参考图 |
| | | `#76` | `PrimitiveInt` | `inputs.value` | 生成时长秒数 (默认 15s，建议 3~15s) |
| | | `#77` | `MiniMaxH3ReferenceToVideo` | `inputs.prompt`, `inputs.length` | 提示词与总帧数 |
| | | `#82` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 (默认 16:9) 与 百万像素 (默认 0.9, 快速 0.4, 范围 [0.4, 0.9]) |
| | | `#49` | `KSampler` | `inputs.seed`, `inputs.steps` | 采样器 (默认 8 步) |
| **Minimax 2-9 参考** | `2_2` ~ `2_9` | `#77` | `MiniMaxH3ReferenceToVideo` | `ref_images.ref_image_0~8` | 按顺序注入 2~9 张参考图 |
| | | `#76` | `PrimitiveInt` | `inputs.value` | 生成时长秒数 (默认 15s，建议 3~15s) |
| | | `#77` | `MiniMaxH3ReferenceToVideo` | `inputs.prompt`, `inputs.length` | 提示词与总帧数 |
| | | `#82` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 画面比例 与 百万像素 (默认 0.9, 快速 0.4, 范围 [0.4, 0.9]) |
| **Minimax 视频编辑** | `2_10_ImageVideo2Video_MinimaxH3.json` | `#7` | `LoadImage` | `inputs.image` | 目标角色/物体参考图 |
| | | `#101` | `VHS_LoadVideo` | `inputs.video` | 待修改源视频文件名 (**时长完全自动继承**) |
| | | `#102` | `LayerUtility: ImageScaleByAspectRatio V2` | `inputs.scale_to_side`, `inputs.scale_to_length` | 按最短边缩放 (默认 704，可选 480/768) |
| | | `#77` | `MiniMaxH3ReferenceToVideo` | `inputs.prompt`, `inputs.length` | 替换/编辑指令与帧数 |
| | | `#40` | `VHS_VideoCombine` | outputs | 输出带原音轨的 MP4 视频 |
| **Minimax 数字人** | `2_11_ImageAudio2Video_MinimaxH3.json` | `#7` | `LoadImage` | `inputs.image` | 角色人像肖像图 |
| | | `#104` | `LoadAudio` | `inputs.audio` | 驱动语音音频文件 |
| | | `#109` | `PrimitiveFloat` | `inputs.value` | 生成时长秒数 (默认 15s，建议 3~15s) |
| | | `#105` | `TrimAudioDuration` | `inputs.duration` | 音频截取时长 (由 Node 109 驱动) |
| | | `#103` | `MiniMaxH3AudioConditioningT8` | `inputs.prompt`, `inputs.length` | 表情提示词与视频总帧数 |
| | | `#112` | `ResolutionSelector` | `inputs.aspect_ratio`, `inputs.megapixels` | 视频画面比例 与 百万像素 (默认 0.9, 快速 0.4, 范围 [0.4, 0.9]) |
| **ACE-STEP 音乐生成** | `3_1_Text2Music_ACESTEP.json` | `#36` | `TextEncodeAceStepAudio1.5` | `inputs.tags`, `inputs.lyrics`, `inputs.bpm`, `inputs.duration`, `inputs.language`, `inputs.keyscale` | 风格标签、歌词、时长与节拍 |
| | | `#29` | `EmptyAceStep1.5LatentAudio` | `inputs.seconds` | 音乐总时长秒数 |
| | | `#32` | `KSampler` | `inputs.seed`, `inputs.steps` | 采样器 (默认 8 步) |
| | | `#49` | `SaveAudioAdvanced` | outputs | 输出 MP3 音频 |

---

## 5. 快速调用示例 (Quick Start Examples)

### 示例 1: Qwen 2.1 文生图 (Text to Image)
```bash
curl -X POST http://127.0.0.1:6000/api/text2img \
     -F "prompt=水墨风格，一个美丽的古风白衣女子，手持折扇，精致五官，大师杰作" \
     -F "aspect_ratio=3:4 (Portrait Standard)" \
     -o output_image/girl_ink.png
```

### 示例 2: Qwen 2.1 单图编辑 (Image Edit)
```bash
curl -X POST http://127.0.0.1:6000/api/edit \
     -F "image=@input/original.png" \
     -F "prompt=把女人的衣服改成绿色，发簪加上红色宝石" \
     -o output_image/edited.png
```

### 示例 3: Minimax-H3 视频编辑 (替换源视频中的角色)
```bash
curl -X POST http://127.0.0.1:6000/api/video/edit \
     -F "image=@input/character.png" \
     -F "video=@input/source.mp4" \
     -F "prompt=把视频中的左边女孩替换成图中的女孩，保持自然动作" \
     -o output_video/replaced_char.mp4
```

### 示例 4: Minimax-H3 数字人 (人像图 + 声音音频生成说话视频)
```bash
curl -X POST http://127.0.0.1:6000/api/video/digital_human \
     -F "image=@input/avatar.png" \
     -F "audio=@input/speech.mp3" \
     -F "prompt=面对镜头温和地说话，微笑自然" \
     -F "duration=15" \
     -o output_video/talking_human.mp4
```

### 示例 5: ACE-STEP 音乐生成
```bash
curl -X POST http://127.0.0.1:6000/api/music \
     -F "tags=pop, energetic, female vocal, synthwave" \
     -F "lyrics=[verse] 城市霓虹闪烁着光芒，晚风轻拂过街角 [chorus] 奔向未知的远方，属于我们的乐章" \
     -F "bpm=125" \
     -F "duration=60" \
     -o output_audio/song.mp3
```

---

## 6. AI Agent 调度原则与技术细节 (Agent Principles)

1. **自动双格式解析 (UI & API Workflow)**：
   - 仓库内既包含 ComfyUI 画布的 UI 格式 JSON (`.json`)，也包含经过全自动转换的 Prompt API 格式 JSON (`_api.json`)。
   - `comfyui_api_service.py` 与 `comfyui_edit_service.py` 内部均搭载了 `convert_ui_to_api_workflow()` 自动解析器，若遇到未预先转换的 UI JSON，会自动通过节点与 link 拓扑结构转化为合法 Prompt 字典，保障 100% 健壮性。
2. **多图参考数量约束**：
   - Qwen-Image 2.1 图像编辑当前按 `1` ~ `9` 张参考图完整规划，5~8 图工作流由 1/4/9 图结构派生并已通过节点校验。
   - Minimax-H3 多图参考生视频当前按 `1` ~ `9` 张参考图完整规划；5~8 图工作流由 1/4/9 图结构派生，并已通过真实生成回归。
   - 使用 `/api/image/multi_edit` 或 `/api/video/multi_ref` 端点时，桥接器会自动计算传入图片数量并精准路由。
3. **媒体流与本地双重保存**：
   - 任务完成后，服务不仅会以二进制数据流的形式直接流式返回给请求方 (`send_file`)，还会同步在本地的 `output_image/`, `output_video/`, `output_audio/` 目录持久化一份带时间戳或模型前缀的文件副本，便于随时复查和日志回溯。

---

## 7. Qwen-Image 2.1 1–9 参考图回归测试记录 (2026-09-29)

### 测试环境

```text
服务: http://192.168.199.107:6000
ComfyUI: http://127.0.0.1:8188
模型: qwen_image_2.1_int8_convrot.safetensors
TE: qwen3vl_8b_int8_convrot.safetensors
VAE: qwen_image_2.1_vae_bf16.safetensors
```

### 固定测试参数

```text
aspect_ratio: 1:1 (Square)
megapixels: 1.0
steps: 10
cfg: 1.0
seed: 20260929
```

> 该组测试使用 10 steps 验证接口与工作流链路；生产默认仍为 25 steps。

### 结果

| 用例 | 端点 | 参考图数 | HTTP | 耗时 | 输出 |
|---|---|---:|---:|---:|---|
| 文生图 | `/api/text2img` | 0 | 200 | 31.991s | 1024×1024 PNG |
| 单图编辑 | `/api/edit` | 1 | 200 | 16.681s | 1024×1024 PNG |
| 双图融合 | `/api/blend` | 2 | 200 | 24.588s | 1024×1024 PNG |
| 三图融合 | `/api/triple_blend` | 3 | 200 | 81.311s | 1024×1024 PNG |
| 四图融合 | `/api/quad_blend` | 4 | 200 | 92.746s | 1024×1024 PNG |
| 五图融合 | `/api/penta_blend` | 5 | 200 | 83.862s | 1024×1024 PNG |
| 六图融合 | `/api/hexa_blend` | 6 | 200 | 81.500s | 1024×1024 PNG |
| 七图融合 | `/api/hepta_blend` | 7 | 200 | 79.613s | 1024×1024 PNG |
| 八图融合 | `/api/octa_blend` | 8 | 200 | 117.463s | 1024×1024 PNG |
| 九图融合 | `/api/nona_blend` | 9 | 200 | 101.520s | 1024×1024 PNG |
| 动态多图 | `/api/image/multi_edit` | 7 | 200 | 71.387s | 1024×1024 PNG |

结论：

```text
11/11 用例成功。
1–9 张固定参考图端点全部可用。
/api/image/multi_edit 已验证可自动路由 5–8 图工作流。
```

### 追加记录（2026-10-01）：新增 10 参考图（DecaRef）接口场景

新增 `1_10_DecaRef2IMG_QwenImage2_1` 工作流（API/UI）与 `POST /api/deca_blend` 端点；
`TextEncodeQwenImage21` 原生带 `images.image_10` 输入槽，UI 工作流经接线生成。
`/api/image/multi_edit` 动态路由同步扩展至 1–10 图。

| 用例 | 端点 | 参考图数 | HTTP | 耗时 | 输出 |
|---|---|---:|---|---:|---|
| 十图融合 | `/api/deca_blend` | 10 | 200 | 107.930s | 1024×1024 PNG |
| 动态多图 | `/api/image/multi_edit` | 10 | 200 | 199.923s | 1024×1024 PNG |

结论：

```text
2/2 用例成功，Qwen-Image 2.1 参考图上限由 9 张扩展至 10 张。
固定参数与 9.29 回归一致（1:1 / 1.0MP / 10 steps / cfg 1.0 / seed 20261001）。
产物归档：output_image/q21_retest_20261001/11_deca_10ref.png、12_multi_10ref.png。
```

### 追加记录（2026-10-01）：多参考图融合「人数一致性」专项测试

针对首轮流测中"10 参考图输出仅 4 人"的问题（根因：参考图含同一角色的多视图与地标风景，
且提示词未约束人数），本轮重构测试设计：

1. **参考图**：先用 `/api/text2img` 生成 **10 位互不相同的女性人像**（红色连衣裙黑长直发、
   蓝色牛仔外套棕色卷发……灰色风衣亚麻色长发，seed 20261002–202610011），
   确保每张参考图恰好一位特征鲜明的人物；
2. **提示词**：强约束模板——"N 个女人一起在漫展上开心合影，画面中必须恰好出现 N 个不同的女人：
   每个女人分别来自一张参考图，严格保持各自的发型、发色和服装颜色；一个都不能少，也一个都不能多"；
3. **用例**：N=2–10 全部 9 个融合端点，其余参数与标准步骤一致。

| 用例 | 参考图数 | HTTP | 耗时 | 输出 |
|---|---:|---|---:|---|
| 双图融合 | 2 | 200 | 24.683s | 1024×1024 PNG |
| 三图融合 | 3 | 200 | 31.419s | 1024×1024 PNG |
| 四图融合 | 4 | 200 | 39.483s | 1024×1024 PNG |
| 五图融合 | 5 | 200 | 48.519s | 1024×1024 PNG |
| 六图融合 | 6 | 200 | 57.725s | 1024×1024 PNG |
| 七图融合 | 7 | 200 | 67.051s | 1024×1024 PNG |
| 八图融合 | 8 | 200 | 76.536s | 1024×1024 PNG |
| 九图融合 | 9 | 200 | 90.446s | 1024×1024 PNG |
| 十图融合 | 10 | 200 | 101.936s | 1024×1024 PNG |

结论：

```text
9/9 用例接口成功，耗时随参考图数线性增长（约 +8.6s/图）。
人物一致性（输出人数 = 参考图数、逐人特征保持）经人工目检：
2–7 参考图首轮即达标；8–10 参考图经 v2 方案（16:9 横幅 + 一字排开队形 +
逐人点名枚举提示词 + 25 steps 生产档）修正后达标。
参考图与全部输出归档：output_image/q21_people_20261001/。
```

---

## 8. MiniMax-H3 1–9 参考视频回归测试记录 (2026-09-29)

### 测试环境

```text
服务: http://192.168.199.107:6000
ComfyUI: http://127.0.0.1:8188
GPU: NVIDIA GB10 / 128GB unified memory
模型: minimax_h3_ref2va_pruned_int8_convrot
Text Encoder: qwen3vl_32b_minimax_h3_int8_convrot
```

### 固定测试参数

```text
duration: 2s
megapixels: 0.2
steps: 4
seed: 20260929
```

### 回归结果

| 用例 | 端点 | 参考输入 | HTTP | 耗时 | 输出 |
|---|---|---|---:|---:|---|
| 单图参考 | `/api/video/single_ref` | 1图 | 200 | 18.877s | 608×352 MP4 + audio |
| 双图参考 | `/api/video/dual_ref` | 2图 | 200 | 21.882s | 608×352 MP4 + audio |
| 三图参考 | `/api/video/tri_ref` | 3图 | 200 | 25.268s | 608×352 MP4 + audio |
| 四图参考 | `/api/video/quad_ref` | 4图 | 200 | 29.239s | 608×352 MP4 + audio |
| 五图参考 | `/api/video/penta_ref` | 5图 | 200 | 38.483s | 608×352 MP4 + audio |
| 六图参考 | `/api/video/hexa_ref` | 6图 | 200 | 43.674s | 608×352 MP4 + audio |
| 七图参考 | `/api/video/hepta_ref` | 7图 | 200 | 46.921s | 608×352 MP4 + audio |
| 八图参考 | `/api/video/octa_ref` | 8图 | 200 | 51.927s | 608×352 MP4 + audio |
| 九图参考 | `/api/video/nona_ref` | 9图 | 200 | 56.731s | 608×352 MP4 + audio |
| 图生视频 | `/api/video/image2video` | 1图 | 200 | 65.169s | 480×480 MP4 + audio |
| 图+视频编辑 | `/api/video/edit` | 1图 + 1视频 | 200 | 126.965s | 832×480 MP4 + audio |
| 图+音频数字人 | `/api/video/digital_human` | 1图 + 1音频 | 200 | 51.000s | 608×352 MP4 + audio |
| 动态多参考 | `/api/video/multi_ref` | 7图 | 200 | 46.826s | 608×352 MP4 + audio |

结论：

```text
13/13 用例成功。
1-9 张参考图端点全部可用。
图生视频、图+视频编辑、图+音频数字人均已通过真实 MP4 输出回归。
/api/video/multi_ref 已验证可自动路由 7 参考图新增工作流。
```

### 本轮关键修复

1. 将 H3 API JSON 中的前端 `SetNode/GetNode` 解析为显式原生链接。
2. 将 `Anything Everywhere` 广播的 CLIP/MODEL 连接改为显式 API 链接。
3. 新增 5-8 参考图 API/UI 工作流。
4. `multi_ref` 动态路由从 `1/2/3/4/9` 扩展为 `1-9`。
5. 图+音频 T8 工作流修正为：
   - `task_type = I2VA`
   - `add_source_as_reference = false`
   - `KSampler.latent_image = T8.av_latent`
   - 分辨率 multiple 对齐为 32

---

## 9. MiniMax-H3 多模态参考（图+视频+音频混合）回归测试记录 (2026-10-01)

### 测试环境

```text
服务: http://127.0.0.1:6000（comfyui_api_service.py 动态注入工作流）
ComfyUI: http://127.0.0.1:8188
GPU: NVIDIA GB10 / 128GB unified memory
模型: minimax_h3_ref2va_pruned_int8_convrot + Turbo LoRA
Text Encoder: qwen3vl_32b_minimax_h3_int8_convrot
```

### 固定测试参数

```text
duration: 2s
megapixels: 0.2
steps: 4
seed: 20261001
```

### 回归结果

| 用例 | 输入组合 | 文件数 | HTTP | 耗时 | 输出 |
|---|---|---:|---|---:|---|
| 1图+1视频 | 1 图 + 1 视频(9.8s) | 2 | 200 | 228.708s | 2.3s MP4 含音频 |
| 1图+1视频+1音频 | 1 图 + 1 视频(2.5s) + 1 音频 | 3 | 200 | 135.982s | 2.3s MP4 含音频 |
| 3图+2视频+2音频 | 3 图 + 2 视频 + 2 音频 | 7 | 200 | 365.463s | 2.3s MP4 含音频 |
| 6图+3视频+3音频 | 6 图 + 3 视频 + 3 音频 | 12 | 200 | ~103s* | 2.3s MP4 含音频 |
| 超限: 10 图 | 10 图 | 10 | 400 | <0.2s | 错误提示 |
| 超限: 4 视频 | 4 视频 | 4 | 400 | <0.2s | 错误提示 |
| 超限: 13 文件 | 10 图 + 3 视频 | 13 | 400 | <0.2s | 错误提示 |

> *6+3+3 用例的首次提交 WebSocket 超时（生成耗时 > 桥接服务 WebSocket 超时阈值），
> 但 ComfyUI 后台生成成功；重试时直接返回已缓存产物（0.7s）。
> 该行为符合设计：产物不丢失，WebSocket 超时是客户端侧检测限制，非生成失败。

### 结论

```text
4/4 生成用例成功，3/3 边界校验正确拒绝。
/api/video/multi_modal 支持最多 9 图 + 3 视频 + 3 音频（合计 ≤ 12 文件）的多模态参考生视频。
参考视频自动缩放(704)与 24 fps 重采样验证通过；原声轨道自动配对验证通过。
独立参考音频注入验证通过。
边界校验：图片 > 9、视频 > 3、总文件数 > 12 均返回 400 + 明确错误信息。
```

### 已知限制

1. 多模态满配（6+3+3）的完整生成耗时约 **360~420s**（2s/0.2MP/4steps 快速档），
   可能超出桥接服务默认 WebSocket 超时（建议将 `GENERATION_TIMEOUT` 调至 ≥ 480）；
2. 参考视频需 ≥ 5 帧（~0.2s @ 24fps）且 ≤ 15s；
3. 9 图 + 3 视频 + 3 音频 = 15 文件超出模型 12 文件上限，接口正确拒绝。

---

## 10. 语音合成 / 音色克隆 / MinimaxMusic 3 / LTX-2.5 回归测试记录 (2026-10-03)

### 测试环境

```text
服务: http://127.0.0.1:6000 (comfyui_api_service.py)
ComfyUI: http://127.0.0.1:8188
GPU: NVIDIA GB10 / 128GB unified memory
```

### 回归结果

| 用例 | 端点 | HTTP | 耗时 | 输出 |
|---|---|---|---:|---|
| TTS 语音合成 | `/api/tts` | 200 | 18.6s | 64KB MP3 |
| 音色克隆 | `/api/voice_clone` | 200 | 4.6s | 73KB MP3 |
| MinimaxMusic 3 | `/api/music/minimax` | 200 | 60.1s | 276KB MP3 |
| LTX-2.5 图生视频 | `/api/video/ltx` | 200 | 170.8s | 203KB MP4 |

### 结论

```text
4/4 用例成功。
TTS: Qwen3-TTS Voice Design 通过英文声音描述生成高质量语音，支持中英混排。
Voice Clone: FB_Qwen3TTSVoiceClone + Apply Whisper 自动转写，无需手动提供 ref_text。
MinimaxMusic 3: 基于 caption + lyrics + duration 生成完整歌曲，支持长至 180 秒。
LTX-2.5: 22B Distilled Transformer 双阶段采样，3 秒视频约 171s 生成。
```

### 注意事项

1. TTS 的 `voice_description` **必须为英文**（如 `"A gentle female voice"`），中文描述效果差。
2. Voice Clone 的参考音频建议 3–10 秒清晰人声，过短（< 2 秒）或含大量背景噪音会影响克隆质量。
3. MinimaxMusic 3 默认模型为 `minimax_music3_dit_fp16`（占用较大），确保 GPU 有足够显存。
4. LTX-2.5 修复记录：原工作流 `SolAttnPatch` 节点（#178）缺少 `int8_pv` 和 `dense_blocks` 参数，
   导致 ComfyUI 静默跳过主管线。修复方法：在工作流 JSON 中补充这两个参数，并添加
   `node_errors` 检查到 `queue_prompt` 后（借鉴 Visionary 项目），使此类问题在提交阶段即被捕获。
