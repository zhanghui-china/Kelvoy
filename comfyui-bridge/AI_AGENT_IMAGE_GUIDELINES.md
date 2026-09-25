# AI Agent 图像生成与编辑分辨率决策规范
## (Image Generation & Editing Resolution Guidelines for AI Agents)

> **文档适用对象**：所有协同开发、接口集成、智能调用此项目生图/图生图/多图编辑工作流的 **AI Agent、LLM 智能体及开发者**。  
> **制定背景**：基于 Qwen-Image 2.1 架构与 ComfyUI 原生节点的实测生成效果与显存/算力平衡经验，旨在为 AI Agent 自动化调度提供统一且高质量的决策准则。

---

## 1. 核心决策准则 (Core Decision Heuristics)

在所有基于 **Qwen-Image 2.1** 的图像生成与编辑工作流中，分辨率选择器中的 **百万像素参数 (`megapixels`)** 对画面质感、五官肢体结构稳定性、显存占用及生成耗时具有关键影响。

AI Agent 在生成或调用接口时，应遵循以下分级策略（**强烈推荐优先采用**）：

| 选项级别 | 百万像素值 (`megapixels`) | 推荐定位 | 适用场景与 AI 决策依据 | 速度与资源消耗 |
| :--- | :---: | :--- | :--- | :--- |
| **首选推荐** | **`1.0`** | 🎯 **默认通用基准 (Preferred Default)** | **绝大多数场景的首选**。画面整体平衡度最高，构图最稳健，人物五官与肢体比例最自然，抗畸变能力最强。推荐作为 AI Agent 默认缺省值。 | 推理最快，显存占用最低最稳妥 |
| **细节增强** | **`2.0`** | 🔍 **高清微距模式 (High Detail Mode)** | **需要更丰富细腻纹理细节**。如人物微距特写、精细织物刺绣、毛发质感、珠宝反光、密集背景元素或高分辨率大幅面展示。 | 显存占用较高，推理耗时增加约 50%~80% |
| **折衷平衡** | **`1.5`** | ⚖️ **中间平衡方案 (Balanced Middle)** | **平衡细节与开销**。当任务或用户希望比 1.0 获得更好的细节，同时又希望兼顾速度与节省 GPU 显存时的最佳折衷选型。 | 居中，性价比较优 |
| **强烈不建议** | **`< 1.0`**<br>(如 0.5 ~ 0.8) | ❌ **画质劣化区间 (Strongly Discouraged)** | 画面严重模糊、细节丢失、面部与服饰出现明显的色块涂抹感，极易生成不达标废片。 | 虽略省显存，但完全牺牲画质 |
| **强烈不建议** | **`> 2.0`**<br>(如 2.5 ~ 4.0) | ❌ **畸变风险区间 (Strongly Discouraged)** | 极易引发局部畸变（多肢体、重复面孔、结构透视崩溃、注意力机制发散），且极易导致显存溢出 (OOM) 崩溃。 | 严重消耗显存算力，出图收益为负 |

---

## 2. AI Agent 自动决策流程 (Agent Decision Flow)

当 AI Agent 接收到用户的生成或修改请求时，可通过以下逻辑进行自动参数仲裁：

```
                    [接收用户生成/编辑请求]
                               |
            +------------------+------------------+
            |                                     |
   [用户显式指定像素/分辨率?]                [未显式指定分辨率]
            |                                     |
    +-------+-------+                             |
    |               |                             v
[数值安全?]     [数值越界?]               [判断提示词意图特征]
(1.0~2.0)     (<1.0 或 >2.0)                      |
    |               |                  +----------+----------+
 采用指定值    自动纠偏至安全边界        |          |          |
              (偏低->1.0, 偏高->2.0)  [特写/微距]  [高质量/精致] [标准/常规/多图融合]
                                       |          |          |
                                       v          v          v
                                  megapixels=2.0 megapixels=1.5 megapixels=1.0
                                    (高清细节)   (平衡折衷)   (首选默认)
```

### 提示词关键词映射参考：
- **触发 `2.0` (高清细节)**：用户输入包含 `"微距"`, `"面部特写"`, `"超清毛发"`, `"精细纹理"`, `"8k detail"`, `"close-up"`, `"macro lens"` 等。
- **触发 `1.5` (折衷平衡)**：用户输入包含 `"高清"`, `"精致画质"`, `"壁纸"`, `"high quality"`，但非微距特写。
- **触发 `1.0` (首选默认)**：全身照、双人/多人合影、多图融合（2/3/4/9 图编辑）、场景概念图，以及未特别说明画质的常规任务。

---

## 3. 工作流节点映射 (ResolutionSelector Nodes)

在直接操控底层工作流 JSON 时，百万像素通过 `ResolutionSelector` 节点的 `inputs.megapixels` 字段进行控制：

| 工作流文件 | 业务功能 | 关键 ResolutionSelector 节点 ID | 控制字段 | 默认推荐值 |
| :--- | :--- | :---: | :--- | :---: |
| `1_0_Text2IMG_QwenImge2_1.json` | 文生图 | `#492` | `inputs.aspect_ratio`, `inputs.megapixels` | `1.0` |
| `1_1_SingleRef2IMG_QwenImage2_1.json` | 单图编辑 | `#491` | `inputs.aspect_ratio`, `inputs.megapixels` | `1.0` |
| `1_2_DualRef2IMG_QwenImage2_1.json` | 双图融合 | `#493` | `inputs.aspect_ratio`, `inputs.megapixels` | `1.0` |
| `1_3_TriRef2IMG_QwenImage2_1.json` | 三图融合 | `#494` | `inputs.aspect_ratio`, `inputs.megapixels` | `1.0` |
| `1_4_QuadRef2IMG_QwenImage2_1.json` | 四图融合 | `#491` | `inputs.aspect_ratio`, `inputs.megapixels` | `1.0` |
| `1_9_NonaRef2IMG_QwenImage2_1.json` | 九图融合 | `#501` | `inputs.aspect_ratio`, `inputs.megapixels` | `1.0` |

---

## 4. HTTP API 接口调用示例

所有图像接口均已内建 `megapixels` 参数支持（表单字段或 JSON 字段），类型为浮点数：

### 1) Python 调用示例 (使用 requests)
```python
import requests

url = "http://127.0.0.1:6000/api/text2img"
data = {
    "prompt": "赛博朋克风格女刺客，特写镜头，机械义眼反射霓虹灯光",
    "aspect_ratio": "3:4 (Portrait Standard)",
    "megapixels": 2.0,  # 细节特写模式选择 2.0
    "steps": 25,
    "cfg": 1.0
}

response = requests.post(url, data=data)
if response.status_code == 200:
    with open("cyber_girl.png", "wb") as f:
        f.write(response.content)
```

### 2) Curl 命令行调用示例
```bash
# 默认首选模式 (1.0 MP)
curl -X POST http://127.0.0.1:6000/api/text2img \
     -F "prompt=水墨山水画，云雾缭绕中的古刹，意境悠远" \
     -F "aspect_ratio=16:9 (Widescreen)" \
     -F "megapixels=1.0" \
     -o output_image/ink_landscape.png

# 平衡折衷模式 (1.5 MP)
curl -X POST http://127.0.0.1:6000/api/edit \
     -F "image=@input/portrait.png" \
     -F "prompt=将人物头发改为银白色，长发飘逸" \
     -F "megapixels=1.5" \
     -o output_image/silver_hair.png
```

---

## 5. 灵活性与特殊约定

- **非死板锁定**：本规范为推荐最佳实践准则。若有专门的算法研究、压力测试或极限场景验证需要测试极端分辨率，底层服务未进行强制抛错阻断，但 Agent 需在日志中明确记录风险预期。
- **与宽高比 (Aspect Ratio) 的协同**：`ResolutionSelector` 节点会根据 `aspect_ratio`（如 `3:4`, `16:9`, `1:1`）与 `megapixels` 共同动态换算最终画布的宽与高（例如 `1.0 MP` 配合 `3:4` 会计算出约 `864x1152`，配合 `1:1` 会计算出约 `1024x1024`）。因此无需手动计算像素长宽，只需指定比例与百万像素即可。
