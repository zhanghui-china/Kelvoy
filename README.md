# Kelvoy 可旅

![kelvoy-travel-hero](apps/web/public/images/kelvoy-travel-hero.jpg)

**中文** | [English](README_en.md)

**可旅（Kelvoy）——AI 旅行 Vlog 生产工作台。可旅，让每一场旅行都有 vlog。** 本项目为第三届 NVIDIA DGX Spark 黑客松参赛项目。

## 📖项目简介

**项目起名：**

Kelvoy - AI 旅行 Vlog 生产工作台，中文名称为"可旅"。Kelvoy 源于 *Key* 与 *Voyage* 的结合：*Key* 象征角色资产的锁定与一致性，*Voyage* 寓意旅程、探索与目的地叙事。中文"可旅"既表达"可以出发"的动作感，也暗含"可复制的旅行内容生产方式"。

**项目内容：**

Kelvoy 是一个面向"虚拟角色 × 真实目的地"旅行内容生产的多模态创作项目，围绕"角色资产 → 目的地符号包 → 分镜脚本 → 关键帧 / 直出视频 → 固定一秒剪辑 → 成片分享"构建完整闭环。用户定一个虚拟出镜角色、选一个景区级旅游目的地，在脚本、关键帧（传统路径）、片段三个人工节点做选择，得到一期 24–30 镜、每镜 1 秒、约 30 秒、9:16 竖屏（默认）或 16:9 横屏的目的地 Vlog；同一角色走遍不同目的地，形成一个旅行账号的内容。

**项目背景与动机：**

- **行业痛点**：虚拟旅游博主、文旅机构与代运营团队需要持续产出目的地内容，但真人出镜成本高、人设跨期难一致；通用视频工具又缺乏"角色 + 目的地"的垂直能力；
- **现有 AI 方案不足**：市面工具要么是"一键生成一条视频"的黑盒，要么是"通用剪辑器"，没有人把"一个角色持续生产 Vlog"做成产品；
- **机会**：NVIDIA DGX Spark 128GB 统一内存使得脚本、图像、视频多模型协同推理可以在单机流水线中完成，实现"角色 + 目的地进、旅行 Vlog 出"的可控生产。

本仓库包含基于 Bun/TypeScript monorepo 的 Web 工作台、GPU Worker、推理适配服务与流水线引擎，实现从建期到成片的全链路自动化生成：

- **虚拟角色 × 真实目的地垂直体裁**：角色是账号级资产（人设、外形跨期一致，每期可换穿搭），目的地是共享资产（官方维护景区级符号包 + 地标实景参考图）；
- **两条创作路径**：新项目默认"人物参考图 + 地标实景图"双参考图直出视频（MiniMax H3），省去图片生成；传统路径支持每镜 1–3 张关键帧候选（Qwen-Image 2.1）逐镜挑选；
- **三个人工审核点**：脚本审核（可改、可删、可按指令重生成）、关键帧审核（传统路径）、片段审核（质量红线逐条确认），不确定性压在便宜的静帧阶段；
- **固定一秒剪辑**：每镜严格 30 帧 @30fps，字幕烧录、2 帧片内转场、LUT、片头片尾、AI 标识全部在 ffmpeg 合成阶段完成；
- **成本可控与积分核算**：本地 DGX Spark 自部署为主、国内 API 弹性溢出；动作级积分原子预留 / 结算 / 释放，成片版本化 + ffprobe 验证 + 用量页；
- **本地优先架构**：SQLite 唯一真源 + 本地磁盘产物 + 无 Redis / Postgres / 对象存储（ADR-0004）。

> 详细产品方案见 [PRD v0.2](docs/AI旅行Vlog生产工作台_PRD_v0.2.md)；项目报告书、[Web 技术白皮书](docs/Web技术白皮书.md)与 [Web 端操作手册](docs/Web端操作手册.md)见 `docs/` 目录，DEMO 演示文稿（V0.1–V0.3）在 `docs/demo/`。

## 一句话 Pitch

**选一个角色，去一个真实的地方，一期旅行 Vlog 自动生成。**

## 流水线（六阶段 + 三个人工审核点）

```
角色（三视图参考，账号级资产） + 目的地（景区级符号包）
  → [Brief] 新建一期：季节 / 语气 / 画幅 / 模板 / 创作方式
  → [S1] 脚本生成 24–30 镜分镜 JSON（含逐镜字幕）── 审核 1：改脚本
  → [S2] 角色资产版本快照
  → [S3] 关键帧生成（传统路径，每镜 1–3 候选）── 审核 2：挑关键帧
  → [S4] 视频生成（双参考直出 / 图生视频）── 审核 3：挑片段
  → [S5] 合成设置 → 合成输出：每镜 1 秒 + LUT + 字幕 + 转场 + AI 标识 MP4
```

**直出路径（新项目默认）**：脚本审核通过后，角色参考图 + 地标实景图直接送 MiniMax H3 双参考图生视频工作流，从素材检查直达片段审核，不产生图片候选与关键帧审核。

## 🗺️技术架构

本项目专为 **NVIDIA DGX Spark (GB10 128G 统一内存)** 量身定制，采用 **"本地 SQLite 唯一真源 + 任务队列消费 + ComfyUI 推理适配 + 分时加载"** 架构（无云基础设施，ADR-0004）。

### 模块职责

| 模块 | 职责 | 核心能力 |
| --- | --- | --- |
| `apps/web` | Hono API + React/Vite 前端 | 建期表单、审片台、进度轮询、用量、分享页、官网单页 |
| `apps/worker` | GPU Worker（TS） | 轮询任务队列（租约 + 优雅停机）、调推理服务、产物归档、ffmpeg 合成 |
| `services/inference` | 常驻 Python 推理服务 | `/image` `/video` 适配 ComfyUI，流式下载 + 媒体完整性校验 |
| `packages/engine` | 流水线核心（无 IO） | stages / providers / schema / state / rules，Worker 与 CLI 共用 |
| `packages/store` | 唯一拥有 SQLite 的地方 | 期 / 角色 / 目的地 / 模板 / 任务 + 积分四表，乐观锁 |
| `packages/cli` | 内部工具 | run / import-* / seed-catalog / create-user / grant-credits |
| `comfyui-bridge` | ComfyUI 工作流与桥接服务 | 图像 10 条（Qwen-Image 2.1：纯文生 + 1–9 参考图）、视频 12 条（MiniMax H3：图生视频 + 1–9 参考 + 图 / 音组合）、音乐 1 条（ACE-STEP），另含桥接服务脚本与 Spark GB10 / RTX 4090 参考图数量基准报告 |
| `infra/dgx` | DGX 部署笔记 | 双机侦察记录、端口规划、systemd user 服务与发布流程 |
| `assets` | 演示与共享素材 | `demo/`：官方角色与五目的地实景参考图；`shared/`：授权音乐、LUT、片头片尾 |
| `scripts` | 基准与验收脚本 | 队列 / 并发 / 期列表 / 用量等性能基准，DGX 工作流验收与演示音乐生成 |
| `spike` | 一次性硬件验证 | M0 阶段 ComfyUI 冒烟、Worker 单镜 / 三镜链路验证与评测记录 |

### 仓库结构

```
Kelvoy/
├── apps/
│   ├── web/              # Hono API + React/Vite 前端（工作台）
│   └── worker/           # GPU Worker：任务消费 + ffmpeg 合成
├── packages/
│   ├── engine/           # 流水线核心（无 IO）
│   ├── store/            # SQLite 唯一真源 + 积分
│   └── cli/              # 内部工具（run / import / seed / 账号与积分）
├── services/inference/   # 常驻 Python 推理适配（ComfyUI）
├── comfyui-bridge/       # 23 条 ComfyUI 工作流 + 桥接服务 + 基准报告
├── infra/dgx/            # DGX 侦察记录与部署笔记
├── assets/
│   ├── demo/             # 官方角色 / 目的地实景参考图与 catalog.json
│   └── shared/           # 共享音乐、LUT、片头片尾
├── scripts/              # 性能基准与 DGX 验收脚本
├── spike/                # 一次性硬件验证（M0）
└── docs/                 # PRD / 报告书 / 白皮书 / 手册 / ADR / DEMO PPT
```

### 技术栈

- **脚本模型**：StepFun API（结构化分镜 JSON + 按指令优化重生成）
- **图像模型**：Qwen-Image 2.1（ComfyUI，单参考 = 角色、双参考 = 角色 + 地标）
- **视频模型**：MiniMax H3（ComfyUI，双参考直出 / 单参考图生视频）
- **音乐**：授权素材库检索（MVP 不生成）
- **合成**：FFmpeg（每镜 30 帧整数窗口、LUT、ASS 字幕、2 帧转场、AI 标识）
- **框架**：Bun + TypeScript monorepo、Hono、React 18 + Vite 5、FastAPI + Pydantic、SQLite

## 🚀 快速开始

### 1. 环境要求

- **硬件**：NVIDIA DGX Spark (GB10 128G 统一内存) 或等效 GPU
- **运行时**：[Bun](https://bun.sh) 1.4+、Python 3.12+ 与 [uv](https://docs.astral.sh/uv/)
- **媒体**：ffmpeg / ffprobe 在 PATH 上，且构建带 `libfreetype`（`ffmpeg -filters | grep drawtext` 有输出）
- **ComfyUI**：默认 `http://127.0.0.1:8188`，需预装 Qwen-Image 2.1 / MiniMax H3 权重
- **字体**：一个 CJK 字体文件（drawtext 标题与 AI 标识渲染必需）

### 2. 安装

```bash
git clone https://github.com/zhanghui-china/Kelvoy.git
cd Kelvoy
make install        # bun install + services/inference 的 uv sync
```

### 3. 初始化数据

```bash
# 导入官方角色（阿澄 / 阿岚）、五个目的地（南长街 / 拈花湾 / 灵山大佛 / 泰山 / 黄山）、
# 六个模板与共用音乐、LUT、片头片尾
bun run packages/cli/src/index.ts seed-catalog

# 预置账号（比赛期间不开放注册）并发放演示积分
bun run packages/cli/src/index.ts create-user <用户名> <密码>
bun run packages/cli/src/index.ts grant-credits <用户名> <额度> <发放ID>
```

### 4. 配置环境变量

```bash
export KELVOY_PROJECTS_ROOT=/data/kelvoy/projects          # 产物根目录（默认 projects）
export KELVOY_FONT_FILE=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
export KELVOY_COMFYUI_BASE_URL=http://127.0.0.1:8188       # ComfyUI
export INFERENCE_BASE_URL=http://127.0.0.1:8100            # services/inference
export STEPFUN_API_KEY=<你的密钥>                           # 脚本生成
```

### 5. 启动服务

```bash
make inference    # services/inference :8100
make worker       # apps/worker 消费循环
make web-api      # apps/web :3000（生产模式另执行 apps/web 的 build 后由其托管静态文件）
make web-app      # Vite dev server（开发模式前端）
```

浏览器访问 `http://localhost:3000`，用预置账号登录后从"新建一期"开始创作。

### 6. 测试与质量

```bash
make typecheck    # 五个 TS 包类型检查
make test         # bun test + pytest（SQLite 测试用 :memory:，无需起服务）
make lint         # ruff（Python 侧）
```

## 📆项目团队

| 成员                                        | 职责                                         |
| ------------------------------------------- | -------------------------------------------- |
| [张小白](https://github.com/zhanghui-china) | 队长、项目策划、PRD 编写、环境部署、演示准备 |
| 小腾子                                      | 队员、原型设计、测试、DEMO 视频录制          |
| [般度五子](https://github.com/Bandukids)    | 队员、ComfyUI 服务部署与开发、图像/视频管线  |
| [馄饨](https://github.com/nativeas)         | 队员、Web 前后台开发、审片台与积分系统       |

## 💖特别鸣谢

感谢 NVIDIA 主办第三届 DGX Spark 黑客松。

![1372c345249308e6df60e9bc13346ab8](nvidia-logo.png)

感谢赞奇提供 Spark 云节点算力。

![78a608fc18d7f23073836da07417fe68](zanqi-logo.png)

感谢 StepFun（阶跃星辰）提供Coding Plan算力支持。

![stepfun-logo](stepfun-logo.png)

感谢 Qwen-Image、MiniMax H3、ComfyUI、FFmpeg 等开源模型与项目生态。



## 开源协议

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。
