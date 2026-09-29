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
   - **九图编辑**：上传九张图片 + 融合提示词 (`/api/nona_blend`)。
   - **通用动态多图编辑**：自动根据传入图片数 (1/2/3/4/9) 自动路由调用对应工作流 (`/api/image/multi_edit`)。
4. **Minimax-H3 图生视频 (Image to Video)**：单张图片 + 动态提示词生成带声画的高质量 720p 视频 (`/api/video/image2video`)。
5. **Minimax-H3 1/2/3/4/9 多图参考生视频 (Multi-Ref Video Generation)**：
   - **单图参考**：单张参考图 + 故事动作描述 (`/api/video/single_ref`)。
   - **双图参考**：两张角色/场景参考图 + 交互描述 (`/api/video/dual_ref`)。
   - **三图参考**：三张参考图 + 剧情描述 (`/api/video/tri_ref`)。
   - **四图参考**：四张参考图 + 场景描述 (`/api/video/quad_ref`)。
   - **九图参考**：九张参考图多视角/多元素融合生视频 (`/api/video/nona_ref`)。
   - **智能多图参考**：自动根据上传图片数匹配对应参考生视频工作流 (`/api/video/multi_ref`)。
6. **Minimax-H3 视频编辑 (图+视频生视频 / Video Editing & Character Transfer)**：
   - 上传目标角色参考图 + 待替换源视频 + 替换指令提示词，生成保留原视频音轨与动作节奏的新视频 (`/api/video/edit`)。
7. **Minimax-H3 数字人 (图+音频生视频 / Digital Human & Talking Avatar)**：
   - 上传角色人像图片 + 驱动语音音频，生成角色口型与神态同步说话的视频 (`/api/video/digital_human`)。
8. **ACE STEP 1.5XL 音乐生成 (Music Creation)**：
   - 基于风格标签 (Tags)、歌词 (Lyrics)、节拍 (BPM)、时长 (Duration)、调式 (Key Scale) 生成高品质完整音乐 MP3 (`/api/music`)。

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

#### 6. 九图融合/编辑 (`POST /api/nona_blend`)
- **Content-Type**: `multipart/form-data`
- **请求参数**:
  - `image1` ~ `image9` (File 或 文件名, 必填): 九张参考图
  - `prompt` (Text, 必填): 融合提示词
  - `aspect_ratio` (Text, 可选): 画面比例，默认 `"16:9 (Widescreen)"`
  - `megapixels` (Float, 可选): 百万像素值，默认 `1.0`（推荐 `1.0` / `1.5` / `2.0`）
- **返回响应**: 二进制图片流 (`image/png`)

#### 7. 通用动态多图编辑 (`POST /api/image/multi_edit`)
- **Content-Type**: `multipart/form-data`
- **说明**: 自动检测上传的图片数量，若为 1 张自动调用单图编辑，2 张调用双图，3 张调用三图，4 张调用四图，9 张调用九图。
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
- ⏱️ **默认时长**: **`15 秒`** (`duration=15.0`)。适用于 `image2video`、`ref2video` (单/双/三/四/九图参考) 以及 `ImageAudio2Video` (数字人)。
- 📊 **建议范围**: **`3.0 秒 ~ 15.0 秒`**（强烈建议不低于 3 秒，不高于 15 秒）。
- 🧮 **自动帧数对齐**: 底层工作流通过公式 `max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17` 自动换算为 24fps 下符合 17 帧 chunk 的精确帧数（如 15 秒对应约 362 帧，5 秒对应约 124 帧），调用方直接传递秒数即可，无需手工计算复杂帧数对齐。
- 🚫 **视频编辑除外**: `video_edit`（图+视频生视频）无需设置时长，输出时长直接继承源视频。

#### 3. 分辨率选择器百万像素准则 (ResolutionSelector - ref2video & ImageAudio2Video)
在多图参考生视频（1/2/3/4/9 图参考）及数字人（图+音频生视频）工作流中，分辨率由 `ResolutionSelector` 节点（Node `#82` 与 `#112`）控制：
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

#### 10. 2/3/4/9 多图参考生视频 (`POST /api/video/dual_ref`, `/tri_ref`, `/quad_ref`, `/nona_ref`)
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
- **说明**: 自动统计上传的参考图数量（1/2/3/4/9 张），无缝路由至对应的 Minimax-H3 多图参考工作流。
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

## 4. ComfyUI 工作流 JSON 节点映射速查表 (Node Mappings)

若 AI Agent 需要直接读取、修改或自动化装配工作流 JSON，请严格参考下表的节点 ID 与字段映射规范：

| 工作流类型 | 工作流文件名 | 关键节点 ID | 节点类名 (Class Type) | 目标字段 (Field Path) | 业务作用 |
| :--- | :--- | :--- | :--- | :--- | :--- |
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
| **Minimax 2/3/4/9 参考** | `2_2`, `2_3`, `2_4`, `2_9` | `#7`, `#92`, `#93`, `#94`... | `LoadImage` | `inputs.image` | 多张参考图对应节点 |
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
   - Qwen-Image 2.1 图像编辑在官方工作流中按 `1` (单图), `2` (双图), `3` (三图), `4` (四图), `9` (九图) 规划。
   - Minimax-H3 多图参考生视频同样按 `1`, `2`, `3`, `4`, `9` 张提供模型权重与节点连接。
   - 使用 `/api/image/multi_edit` 或 `/api/video/multi_ref` 端点时，桥接器会自动计算传入图片数量并精准路由。
3. **媒体流与本地双重保存**：
   - 任务完成后，服务不仅会以二进制数据流的形式直接流式返回给请求方 (`send_file`)，还会同步在本地的 `output_image/`, `output_video/`, `output_audio/` 目录持久化一份带时间戳或模型前缀的文件副本，便于随时复查和日志回溯。
