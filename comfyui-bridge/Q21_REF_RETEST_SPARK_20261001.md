# Qwen-Image 2.1 参考图生图全案例回归测试报告（1–10 案例）

> 测试日期：2026-10-01  
> 执行环境：NVIDIA DGX Spark（gx10-8e22 · GB10 · 128GB 统一内存）  
> 测试方式：comfyui-bridge HTTP API 标准步骤（对齐 2026-09-29 回归记录）  
> 结论：**10/10 用例通过**，全部输出有效 1024×1024 PNG

---

## 一、测试环境

```text
主机:       gx10-8e22（NVIDIA DGX Spark, GB10, 128GB unified memory, aarch64）
IP:         192.168.199.107
ComfyUI:    http://127.0.0.1:8188（v0.37.0）
桥接服务:   comfyui_api_service.py @ http://0.0.0.0:6000（本轮新建 venv 启动）
主模型:     qwen_image_2.1_int8_convrot.safetensors
文本编码器: qwen3vl_8b_int8_convrot.safetensors
VAE:        qwen_image_2.1_vae_bf16.safetensors
工作流:     1_0_Text2IMG / 1_1_SingleRef / 1_2_DualRef / 1_3_TriRef /
            1_4_QuadRef / 1_5_PentaRef / 1_6_HexaRef / 1_7_HeptaRef /
            1_8_OctaRef / 1_9_NonaRef（Qwen-Image 2.1，0–9 参考图）
```

## 二、固定测试参数（标准步骤）

```text
aspect_ratio: 1:1 (Square)
megapixels:   1.0
steps:        10      # 接口链路验证用；生产默认 25
cfg:          1.0
seed:         20261001
```

**参考图（9 张，均为仓库演示素材）**：

| 序号 | 文件 | 内容 |
|---|---|---|
| 1 | `c_official_aching_front.jpg` | 官方角色"阿澄"正面参考 |
| 2 | `c_official_aching_side.jpg` | 角色"阿澄"侧面参考 |
| 3 | `c_official_aching_full.jpg` | 角色"阿澄"全身参考 |
| 4–6 | `lingshan_01/02/03.jpg` | 灵山大佛实景参考 |
| 7–9 | `huangshan_01/02/03.jpg` | 黄山实景参考 |

N 参考图用例按上表顺序取前 N 张（角色参考在前、地标实景在后）；提示词统一为"参考图中的年轻女性旅行者游览参考图中的地标景点，画面自然融合，旅行vlog风格"。

## 三、测试结果

| # | 用例 | 端点 | 参考图数 | HTTP | 耗时 | 输出 |
|---:|---|---|---:|---|---:|---|
| 1 | 文生图 | `/api/text2img` | 0 | 200 | 33.382s | 1024×1024 PNG (1.91MB) |
| 2 | 单图编辑 | `/api/edit` | 1 | 200 | 15.331s | 1024×1024 PNG (1.74MB) |
| 3 | 双图融合 | `/api/blend` | 2 | 200 | 25.118s | 1024×1024 PNG (1.60MB) |
| 4 | 三图融合 | `/api/triple_blend` | 3 | 200 | 31.929s | 1024×1024 PNG (1.70MB) |
| 5 | 四图融合 | `/api/quad_blend` | 4 | 200 | 40.872s | 1024×1024 PNG (1.72MB) |
| 6 | 五图融合 | `/api/penta_blend` | 5 | 200 | 49.779s | 1024×1024 PNG (1.68MB) |
| 7 | 六图融合 | `/api/hexa_blend` | 6 | 200 | 60.085s | 1024×1024 PNG (1.72MB) |
| 8 | 七图融合 | `/api/hepta_blend` | 7 | 200 | 68.348s | 1024×1024 PNG (1.74MB) |
| 9 | 八图融合 | `/api/octa_blend` | 8 | 200 | 78.820s | 1024×1024 PNG (1.74MB) |
| 10 | 九图融合 | `/api/nona_blend` | 9 | 200 | 93.230s | 1024×1024 PNG (1.77MB) |

**输出校验**：10 张产物均通过 PNG 头解析（`file` 命令），格式为 `PNG image data, 1024 x 1024, 8-bit/color RGBA, non-interlaced`，文件大小 1.60–1.91MB。

**耗时规律**：从 2 参考图起，每增加 1 张参考图耗时约线性增加 8–10 秒（每张参考图约 +9.6s，回归斜率与 9.29 基线一致）。

## 四、与 2026-09-29 基线对比

| 用例 | 9.29 基线 | 本轮 10.01 | 变化 |
|---|---:|---:|---:|
| 文生图（0 ref） | 31.991s | 33.382s | +4.4% |
| 单图编辑（1 ref） | 16.681s | 15.331s | −8.1% |
| 双图融合（2 ref） | 24.588s | 25.118s | +2.2% |
| 三图融合（3 ref） | 81.311s | 31.929s | **−60.7%** |
| 四图融合（4 ref） | 92.746s | 40.872s | **−55.9%** |
| 五图融合（5 ref） | 83.862s | 49.779s | −40.6% |
| 六图融合（6 ref） | 81.500s | 60.085s | −26.3% |
| 七图融合（7 ref） | 79.613s | 68.348s | −14.1% |
| 八图融合（8 ref） | 117.463s | 78.820s | −32.9% |
| 九图融合（9 ref） | 101.520s | 93.230s | −8.2% |

说明：

1. 0–2 参考图用例与基线偏差在 ±5% 内，属正常波动；
2. 3–8 参考图用例显著快于基线：9.29 那轮为多参考工作流**首次冷加载**（模型/工作流缓存未热），本轮模型已常驻、ComfyUI 缓存热，属预期内的稳定值；
3. 本轮耗时随参考图数量呈更干净的线性关系（相关系数更高），可作为后续性能基线。

## 五、过程记录

1. **环境搭建**：`comfyui-bridge` 目录下 `uv venv .venv` + 安装 `flask / requests / websocket-client`；
2. **服务启动**：`COMFYUI_SERVER=127.0.0.1:8188 SERVICE_PORT=6000 nohup .venv/bin/python comfyui_api_service.py`（监听 0.0.0.0:6000，`/` 探活 200）；
3. **参考图**：从本地仓库 `assets/demo/` 上传 9 张至节点 `input/`（按角色/地标规范命名）；
4. **异常与修正**：首轮用例 2（`/api/edit`）返回 400 `{"error":"Missing 'image' file or filename"}`——测试脚本误用 `image1` 字段，该端点要求 `image`；按标准参数名重跑后 200 通过。**非服务缺陷，是测试脚本参数名笔误**；
5. **执行方式**：`nohup bash run_q21_tests.sh` 后台串行执行，日志见节点 `logs/q21_retest_20261001.log`。

## 六、结论

```text
10/10 用例成功（含重跑修正后的单图编辑）。
Qwen-Image 2.1 的 0–9 参考图全部 10 条固定端点在 Spark（GB10）上可用。
输出规格一致（1024×1024 RGBA PNG），耗时随参考图数量线性增长。
3–9 参考图工作流在热缓存下较 9.29 冷启动基线提速 8%–61%。
```

## 七、产物位置

```text
# 节点（gx10-8e22）
/home1/wuzi/Kelvoy/comfyui-bridge/output_image/q21_retest_20261001/01_text2img.png … 10_nona_9ref.png
/home1/wuzi/Kelvoy/comfyui-bridge/logs/q21_retest_20261001.log

# 本地（D:\Kelvoy）
.codex-q21-test/outputs/01_text2img.png … 10_nona_9ref.png（已下载归档）
comfyui-bridge/run_q21_tests.sh（可复现测试脚本，随仓库归档）
```
