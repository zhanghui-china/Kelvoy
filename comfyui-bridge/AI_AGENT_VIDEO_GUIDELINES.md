# AI Agent 视频生成缩放与时长决策规范
## (Minimax-H3 Video Generation Guidelines for AI Agents)

> **文档适用对象**：所有协同开发、接口集成、智能调用此项目视频生成（图生视频、多图参考生视频）工作流的 **AI Agent、LLM 智能体及开发者**。  
> **制定背景**：基于 Minimax-H3 架构与 ComfyUI 原生节点的实测生成效果与显存/算力平衡经验，旨在为 AI Agent 自动化调度提供统一、稳定且高质量的视频生成决策准则。

---

## 1. 核心决策准则 (Core Decision Heuristics)

在所有基于 **Minimax-H3** 的视频生成工作流中，画面缩放节点（`LayerUtility: ImageScaleByAspectRatio V2`）中的 **最短边目标长度 (`scale_to_length`)** 以及时长控制节点（`PrimitiveInt` + `ComfyMathExpression`）中的 **生成时长 (`duration`)** 对视频画质、运动平滑度、显存占用与推理耗时具有决定性影响。

### (1) 按宽高比缩放准则 (Scale to Length)
当前工作流严格遵循**按最短边进行缩放** (`scale_to_side: "shortest"`):

| 缩放长度 (`scale_to_length`) | 定位与推荐度 | 适用场景与 AI 决策依据 | 显存与速度表现 |
| :---: | :--- | :--- | :--- |
| **`704`** | 🎯 **首选推荐 (Preferred Default)** | **最推荐的默认基准**。标准 720p 级别高画质，构图清晰饱满、细节纹理丰富、运动平滑，处于画质与耗时的最佳黄金平衡点。 | 性能与显存表现最优，推荐缺省值 |
| **`480`** | ⚡ **快速预览模式 (Fast Preview)** | **快速验证与迭代场景**。分辨率较低，适合快速测试动作描述提示词、镜头运镜设计或动作连贯性验证。 | 生成速度大幅提升，显存占用最低 |
| **`768`** | 🔍 **高清上限 (High-Quality Limit)** | **极限高质展示**。最高支持上限，画面毛发与背景微距更清晰，但会显著拉长生成耗时。 | 计算耗时增加约 40%~70%，需充足显存 |
| **`> 768`**<br>(如 800~1024) | ❌ **强烈不建议 (Strongly Discouraged)** | 画面畸变风险上升，且极易导致 GPU 显存溢出 (OOM) 崩溃或接口响应超时。 | 耗时与显存剧增，收益极低 |

---

### (2) 生成时长准则 (Duration)

- ⏱️ **默认时长**: **`15 秒`** (`duration=15.0`)。
- 📊 **建议范围**: **`3.0 秒 ~ 15.0 秒`**（强烈建议不低于 3 秒，不高于 15 秒）：
  - **`< 3.0 秒`**：动作往往尚未充分舒展即戛然而止，首尾容易显得局促突兀。
  - **`> 15.0 秒`**：模型长程注意力机制容易发散，可能出现动作停滞、画面闪烁或重复动作循环。
- 🧮 **自动帧数对齐**: 底层工作流通过公式节点（Node `#81` `ComfyMathExpression`）自动换算为与 Minimax-H3 17 帧 chunk 严格对齐的帧数：
  $$\text{frames} = \max(5, \text{round}(a \times 24)) + (5 - (\max(5, \text{round}(a \times 24)) \bmod 17)) \bmod 17$$
  调用方**直接传递秒数浮点数即可**，系统会自动代入 $a$ 计算，无需客户端手工换算复杂的帧数对其。

---

### (3) 多图参考 (Ref2Video) 与 数字人 (Digital Human) 百万像素与时长准则

对于 **多图参考生视频** (`2_1` ~ `2_9` Ref2Video) 以及 **数字人说话视频** (`2_11_ImageAudio2Video_MinimaxH3`)：
- ⏱️ **生成时长 (`duration`)**: 建议 **`3.0 ~ 15.0 秒`**（默认 **`15.0 秒`**）。
- 🖼️ **分辨率选择器 (`ResolutionSelector`)**: 控制百万像素值 (`megapixels`)：
  - **`0.9` (首选推荐)**：🎯 画面清晰自然、动作与口型表达稳定，综合效果最佳。
  - **`0.4` (快速预览)**：⚡ 针对轻量测试或需快速交付时选用，显著缩短推理时间。
  - ❌ **范围边界限制**：**强烈不建议超出 `[0.4, 0.9]` 范围**。低于 0.4 画面严重模糊糊斑，高于 0.9 容易引发显存剧增、长序列注意力畸变或 OOM。

---

### (4) 视频编辑特殊规则 (Video Editing - `2_10_ImageVideo2Video_MinimaxH3`)

- 🎯 **缩放准则完全一致**：按宽高比缩放 V2 节点（Node `#102`）同样遵循**按最短边缩放**（`scale_to_side: "shortest"`），首选 `scale_to_length: 704`，快速预览选 `480`，清晰上限选 `768`，不建议超过 `768`。
- 🚫 **免设时长原则 (No Duration Required)**：与生成类工作流不同，视频编辑任务**不需要设置视频时长**。输出视频的长度、帧数与帧率完全自动继承自上传的源视频文件（Node `#101` `VHS_LoadVideo`），AI Agent 与调用方切勿向此接口注入额外时长设定。

---

## 2. AI Agent 自动决策流程 (Agent Decision Flow)

```
                              [接收用户视频生成/处理请求]
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
[图生视频 2_0 Image2Video]       [多图参考/数字人 2_1~2_9, 2_11]   [视频编辑 2_10 ImageVideo2Video]
        |                                 |                                 |
  +-----+-----+                     +-----+-----+                     +-----+-----+
  |           |                     |           |                     |           |
缩放最短边   时长 (s)             分辨率选择器  时长 (s)             缩放最短边   时长 (s)
scale_len   duration              megapixels   duration              scale_len   自动继承源视频
默认 704    默认 15s              默认 0.9     默认 15s              默认 704    (切勿传入 duration)
(480/768)   [3.0 ~ 15.0]          (快速 0.4)   [3.0 ~ 15.0]          (480/768)
(不超 768)                        [0.4 ~ 0.9]                        (不超 768)
```

---

## 3. 工作流节点映射速查表 (Node Mappings)

在直接操控底层工作流 JSON 时，缩放、分辨率与时长参数对应的具体节点如下：

| 工作流文件 | 业务功能 | 关键节点 ID | 节点类名 (Class Type) | 控制字段 (Field Path) | 业务作用与推荐取值 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `2_0_Image2Video_MinimaxH3.json` | 图生视频 | `#9` | `LayerUtility: ImageScaleByAspectRatio V2` | `inputs.scale_to_length`<br>`inputs.scale_to_side` | 最短边缩放长度 (默认 704, 快速 480, 上限 768)<br>基准边 (固定 "shortest") |
| | | `#71` | `PrimitiveInt` | `inputs.value` | 生成时长秒数 (默认 15s，建议 3~15s) |
| | | `#81` | `ComfyMathExpression` | `inputs.expression` | 自动计算 17 帧 chunk 对齐帧数 |
| | | `#74` | `MiniMaxH3ImageToVideo` | `inputs.prompt`, `inputs.length` | 动作提示词与动态帧数 |
| `2_1_SingleRef2Video_MinimaxH3.json` | 单图参考 | `#76` | `PrimitiveInt` | `inputs.value` | 时长秒数 (默认 15s，建议 3~15s) |
| | | `#82` | `ResolutionSelector` | `inputs.aspect_ratio`<br>`inputs.megapixels` | 画面比例 (默认 16:9)<br>百万像素 (默认 0.9, 快速 0.4, 范围 [0.4, 0.9]) |
| | | `#77` | `MiniMaxH3ReferenceToVideo` | `inputs.prompt`, `inputs.length` | 剧情提示词与动态帧数 |
| `2_2` ~ `2_9` 多图参考工作流 | 多图参考 | `#76` | `PrimitiveInt` | `inputs.value` | 时长秒数 (默认 15s，建议 3~15s) |
| | | `#82` | `ResolutionSelector` | `inputs.aspect_ratio`<br>`inputs.megapixels` | 画面比例<br>百万像素 (默认 0.9, 快速 0.4, 范围 [0.4, 0.9]) |
| | | `#77` | `MiniMaxH3ReferenceToVideo` | `inputs.prompt`, `inputs.length` | 剧情提示词与动态帧数 |
| `2_10_ImageVideo2Video_MinimaxH3.json` | 视频编辑 | `#101` | `VHS_LoadVideo` | `inputs.video` | 待修改源视频 (**时长完全自动继承，无需设置时长**) |
| | | `#102` | `LayerUtility: ImageScaleByAspectRatio V2` | `inputs.scale_to_length`<br>`inputs.scale_to_side` | 最短边缩放长度 (默认 704, 快速 480, 上限 768)<br>基准边 (固定 "shortest") |
| | | `#77` | `MiniMaxH3ReferenceToVideo` | `inputs.prompt`, `inputs.length` | 替换/编辑提示词与帧数 |
| `2_11_ImageAudio2Video_MinimaxH3.json` | 数字人说话视频 | `#7` | `LoadImage` | `inputs.image` | 角色肖像人像图 |
| | | `#104` | `LoadAudio` | `inputs.audio` | 驱动语音音频文件 (MP3/WAV) |
| | | `#109` | `PrimitiveFloat` | `inputs.value` | 生成时长秒数 (默认 15s，建议 3~15s，联动截取音频与计算帧数) |
| | | `#105` | `TrimAudioDuration` | `inputs.duration` | 音频截取时长 (由 Node 109 驱动) |
| | | `#112` | `ResolutionSelector` | `inputs.aspect_ratio`<br>`inputs.megapixels` | 画面比例 (默认 16:9)<br>百万像素 (默认 0.9, 快速 0.4, 范围 [0.4, 0.9]) |
| | | `#103` | `MiniMaxH3AudioConditioningT8` | `inputs.prompt`, `inputs.length` | 表情神态提示词与总帧数 |

---

## 4. HTTP API 接口调用示例

所有视频接口均已内建 `duration` 与 `scale_to_length` 参数支持：

### 1) Python 调用示例 (使用 requests)
```python
import requests

url = "http://127.0.0.1:6000/api/video/image2video"

# 准备参数
data = {
    "prompt": "微风吹拂女子秀发，女子转过头温柔微笑，眼神灵动自然",
    "duration": 15.0,           # 默认 15 秒，建议范围 [3.0, 15.0]
    "scale_to_length": 704,     # 首选 704，快速预览填 480，极限细节填 768
    "scale_to_side": "shortest",# 最短边缩放
    "steps": 6
}

files = {
    "image": open("input/character.png", "rb")
}

response = requests.post(url, data=data, files=files)
if response.status_code == 200:
    with open("output_video/gentle_smile.mp4", "wb") as f:
        f.write(response.content)
```

### 2) Curl 命令行调用示例
```bash
# 默认首选模式 (704 最短边，15秒时长)
curl -X POST http://127.0.0.1:6000/api/video/image2video \
     -F "image=@input/character.png" \
     -F "prompt=女子转头微笑，发丝随风飘动" \
     -F "duration=15.0" \
     -F "scale_to_length=704" \
     -o output_video/smile_704_15s.mp4

# 快速验证模式 (480 最短边，5秒轻量验证)
curl -X POST http://127.0.0.1:6000/api/video/image2video \
     -F "image=@input/character.png" \
     -F "prompt=快速奔跑并挥手示意" \
     -F "duration=5.0" \
     -F "scale_to_length=480" \
     -o output_video/quick_test_5s.mp4

# 视频编辑模式 (704 最短边，时长自动继承源视频，无需传 duration)
curl -X POST http://127.0.0.1:6000/api/video/edit \
     -F "image=@input/target_actor.png" \
     -F "video=@input/source_scene.mp4" \
     -F "prompt=将原视频中的主角替换为图片中的女子" \
     -F "scale_to_length=704" \
     -o output_video/edited_video.mp4

# 多图参考生视频模式 (0.9 MP 首选, 15秒时长)
curl -X POST http://127.0.0.1:6000/api/video/single_ref \
     -F "image=@input/character.png" \
     -F "prompt=人物在繁华古风集市中漫步，镜头缓缓拉远" \
     -F "duration=15.0" \
     -F "megapixels=0.9" \
     -o output_video/char_ref_15s.mp4

# 数字人说话视频模式 (0.9 MP 首选, 15秒时长截取与视频生成)
curl -X POST http://127.0.0.1:6000/api/video/digital_human \
     -F "image=@input/avatar.png" \
     -F "audio=@input/speech.mp3" \
     -F "prompt=神态自信从容，眼神坚定地看向镜头" \
     -F "duration=15.0" \
     -F "megapixels=0.9" \
     -o output_video/avatar_talking_15s.mp4
```

