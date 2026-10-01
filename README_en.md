# Kelvoy

![kelvoy-travel-hero](apps/web/public/images/kelvoy-travel-hero.jpg)

[中文](README.md) | **English**

**Kelvoy — an AI travel vlog production workbench. Let every journey have its vlog.**

This project is an entry for the 3rd NVIDIA DGX Spark Hackathon.

## 📖 About the Project

**Naming:**

Kelvoy is an AI travel vlog production workbench, known in Chinese as "可旅" (Kě Lǚ, "travel-ready"). The name combines *Key* and *Voyage*: *Key* stands for locking character assets and consistency, while *Voyage* evokes journeys, exploration, and destination storytelling. The Chinese name expresses both the readiness to set off and a repeatable way to produce travel content.

**What it does:**

Kelvoy is a multimodal creation project focused on "virtual character × real destination" travel content, building a closed loop around: character assets → destination symbol packs → storyboard scripts → keyframes / direct video → per-shot cutting & compose → delivery and sharing. Pick one virtual on-camera character and one scenic-level destination, make choices at three human checkpoints (script, keyframes on the classic path, and clips), and get a 5–10-shot, 3–4-seconds-per-shot, ~30-second travel vlog in 9:16 portrait (default) or 16:9 landscape. The same character can travel across destinations, forming the content of a serialized travel account.

**Background and motivation:**

- **Industry pain points:** Virtual travel bloggers, destination marketing organizations, and agencies need to produce destination content continuously, but live-action filming is expensive and on-camera personas drift across episodes; general-purpose video tools lack vertical "character + destination" capabilities.
- **Existing AI tools fall short:** Today's tools are either one-shot "generate a video" black boxes or general-purpose editors — nobody has built "one character continuously producing vlogs" as a product.
- **The opportunity:** The NVIDIA DGX Spark's 128GB unified memory lets script, image, and video models cooperate in a single-machine pipeline, making controllable production of "character + destination in, travel vlog out" possible.

This repository contains a Bun/TypeScript monorepo with a web workbench, a GPU worker, an inference adapter service, and the pipeline engine, automating the full path from brief to final cut:

- **Vertical genre — virtual character × real destination:** Characters are account-level assets (persona and appearance stay consistent across episodes, outfits can change each time); destinations are shared assets (officially maintained scenic-level symbol packs + landmark reference photos).
- **Two creation paths:** New projects default to dual-reference direct video (character reference + landmark photo → MiniMax H3), skipping image generation; the classic path offers 1–3 keyframe candidates per shot (Qwen-Image 2.1) for manual selection.
- **Three human review gates:** Script review (edit, delete, or regenerate by instruction), keyframe review (classic path), and clip review (confirm the quality red lines item by item) — uncertainty is pushed into the cheap still-image stages.
- **Per-shot cutting & compose:** each shot runs 3–4 seconds; subtitle burn-in, 2-frame cross dissolves, LUT, intro/outro, and AI labeling are all done in the ffmpeg compose stage.
- **Controllable cost with credit accounting:** Self-hosted on DGX Spark first, with domestic API overflow; per-action credits are atomically reserved / settled / released, final cuts are versioned and ffprobe-verified, and a usage page shows the totals.
- **Local-first architecture:** SQLite as the single source of truth + artifacts on local disk + no Redis / Postgres / object storage (ADR-0004).

> For details, see the [PRD v0.2](docs/AI旅行Vlog生产工作台_PRD_v0.2.md) (Chinese); the [project report](docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md), the [Web technical whitepaper](docs/Web技术白皮书.md), and the [Web user manual](docs/Web端操作手册.md) live under `docs/`, and the demo decks (V0.1–V0.3) are in `docs/demo/`.

## One-line Pitch

**Pick a character, go to a real place, and a travel vlog is generated.**

## Pipeline (Six Stages + Three Human Review Gates)

```
Character (three-view references, account-level asset) + Destination (scenic-level symbol pack)
  → [Brief] New episode: season / tone / aspect / template / creation mode
  → [S1] Script generation: 5–10-shot storyboard JSON (with per-shot captions) ── Review 1: revise the script
  → [S2] Character asset version snapshot
  → [S3] Keyframe generation (classic path, 1–3 candidates per shot) ── Review 2: pick keyframes
  → [S4] Video generation (dual-reference direct / image-to-video) ── Review 3: pick clips
  → [S5] Compose setup → final render: 3–4s per shot + LUT + subtitles + transitions + AI label MP4
```

**Direct path (default for new projects):** after script review, the character reference image and the landmark photo are sent straight to the MiniMax H3 dual-reference image-to-video workflow. The flow goes from asset checks directly to clip review — no image candidates and no keyframe gate.

## 🗺️ Technical Architecture

Tailored for the **NVIDIA DGX Spark (GB10, 128GB unified memory)**, with a **"local SQLite single source of truth + task-queue consumption + ComfyUI inference adapter + time-sliced model loading"** architecture (no cloud infrastructure, ADR-0004).

### Modules

| Module | Role | Key capabilities |
| --- | --- | --- |
| `apps/web` | Hono API + React/Vite frontend | Brief form, review desk, progress polling, usage, share page, landing page |
| `apps/worker` | GPU worker (TS) | Task-queue consumption (leases + graceful shutdown), inference calls, artifact archival, ffmpeg compose |
| `services/inference` | Resident Python inference service | `/image` and `/video` adapters over ComfyUI, streaming downloads + media integrity checks |
| `packages/engine` | Pipeline core (IO-free) | stages / providers / schema / state / rules, shared by worker and CLI |
| `packages/store` | The only place that owns SQLite | Episodes / personas / destinations / templates / tasks + four credit tables, optimistic locking |
| `packages/cli` | Internal tooling | run / import-* / seed-catalog / create-user / grant-credits |
| `comfyui-bridge` | ComfyUI workflows & bridge services | 10 image workflows (Qwen-Image 2.1: text-to-image + 1–9 references), 12 video workflows (MiniMax H3: image-to-video + 1–9 references + image/audio combos), 1 music workflow (ACE-STEP), plus bridge service scripts and reference-count benchmarks on Spark GB10 / RTX 4090 |
| `infra/dgx` | DGX deployment notes | Dual-machine reconnaissance, port planning, systemd user services, release procedures |
| `assets` | Demo & shared assets | `demo/`: official characters and landmark reference photos; `shared/`: licensed music, LUTs, intro/outro |
| `scripts` | Benchmark & acceptance scripts | Queue / concurrency / episode-list / usage benchmarks, DGX workflow acceptance, demo music generation |
| `spike` | One-off hardware validation | M0 ComfyUI smoke tests, single-/three-shot worker runs, and evaluation records |

### Repository Layout

```
Kelvoy/
├── apps/
│   ├── web/              # Hono API + React/Vite frontend (workbench)
│   └── worker/           # GPU worker: task consumption + ffmpeg compose
├── packages/
│   ├── engine/           # Pipeline core (IO-free)
│   ├── store/            # SQLite single source of truth + credits
│   └── cli/              # Internal tooling (run / import / seed / accounts & credits)
├── services/inference/   # Resident Python inference adapter (ComfyUI)
├── comfyui-bridge/       # 23 ComfyUI workflows + bridge services + benchmarks
├── infra/dgx/            # DGX reconnaissance and deployment notes
├── assets/
│   ├── demo/             # Official characters / landmark photos + catalog.json
│   └── shared/           # Shared music, LUTs, intro/outro
├── scripts/              # Performance benchmarks & DGX acceptance scripts
├── spike/                # One-off hardware validation (M0)
└── docs/                 # PRD / report / whitepaper / manual / ADRs / demo decks
```

### Tech Stack

- **Script model:** StepFun API (structured storyboard JSON + instruction-based regeneration)
- **Image model:** Qwen-Image 2.1 (ComfyUI; single reference = character, dual reference = character + landmark)
- **Video model:** MiniMax H3 (ComfyUI; dual-reference direct generation / keyframe image-to-video)
- **Music:** licensed library retrieval (not generated in the MVP)
- **Compose:** FFmpeg (integer-frame windows per shot, LUT, ASS subtitles, 2-frame transitions, AI label)
- **Frameworks:** Bun + TypeScript monorepo, Hono, React 18 + Vite 5, FastAPI + Pydantic, SQLite

## 📚 Document Index

| Location                                                                                     | Content                                        |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [docs/AI旅行Vlog生产工作台_PRD_v0.2.md](docs/AI旅行Vlog生产工作台_PRD_v0.2.md)                | Product requirements document, PRD v0.2 (current) |
| [docs/AI旅行Vlog生产工作台_PRD_v0.1.md](docs/AI旅行Vlog生产工作台_PRD_v0.1.md)                | PRD v0.1 (historical)                          |
| [docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md](docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md) | Project report (Chinese)                       |
| [docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档_en.md](docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档_en.md) | Project report (English)                       |
| [docs/Web技术白皮书.md](docs/Web技术白皮书.md)                                                | Web technical whitepaper                       |
| [docs/Web端操作手册.md](docs/Web端操作手册.md)                                                | Web user manual                                |
| [docs/DGX Spark黑客松可旅（Kelvoy）十日谈开发历程.md](docs/DGX%20Spark黑客松可旅（Kelvoy）十日谈开发历程.md) | Ten-Day Diary dev story (hackathon essay, Chinese) |
| [docs/minimax_h3_acceleration_technical_specification.md](docs/minimax_h3_acceleration_technical_specification.md) | MiniMax H3 full-stack acceleration spec        |
| [docs/architecture.md](docs/architecture.md)                                                  | Architecture implementation-status doc         |
| [docs/decisions/](docs/decisions/)                                                           | Architecture decision records (ADR 0001–0007)  |
| [docs/guides/](docs/guides/)                                                                 | M0 handbook & release migration guide          |
| [docs/demo/](docs/demo/)                                                                     | Demo decks (V0.1–V0.3)                         |
| [docs/audit/](docs/audit/)                                                                   | Code audits & acceptance records               |
| [docs/ui/](docs/ui/)                                                                         | UI design drafts (v8 PR series)                |
| [docs/M3-0-备案路径调研.md](docs/M3-0-备案路径调研.md)                                        | Filing-path research (commercialization phase) |
| [comfyui-bridge/AI_USAGE_GUIDE.md](comfyui-bridge/AI_USAGE_GUIDE.md)                          | ComfyUI workflow usage guide                   |
| [infra/dgx/README.md](infra/dgx/README.md)                                                    | DGX recon notes & deployment                   |
| [apps/worker/README.md](apps/worker/README.md)                                                | Worker & compose environment notes             |
| [services/inference/README.md](services/inference/README.md)                                  | Inference service protocol & acceptance        |

## 🚀 Quick Start

### 1. Requirements

- **Hardware:** NVIDIA DGX Spark (GB10, 128GB unified memory) or an equivalent GPU
- **Runtimes:** [Bun](https://bun.sh) 1.4+, Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- **Media:** ffmpeg / ffprobe on PATH, built with `libfreetype` (`ffmpeg -filters | grep drawtext` must produce output)
- **ComfyUI:** defaults to `http://127.0.0.1:8188`, with Qwen-Image 2.1 / MiniMax H3 weights preinstalled
- **Fonts:** one CJK font file (required by drawtext for titles and the AI label)

### 2. Install

```bash
git clone https://github.com/zhanghui-china/Kelvoy.git
cd Kelvoy
make install        # bun install + uv sync for services/inference
```

### 3. Seed the catalog

```bash
# Imports the official characters (Acheng / Alan), five destinations
# (Nanchang Street / Nianhua Bay / Lingshan Buddha / Mount Tai / Huangshan),
# six templates, and the shared music / LUT / intro / outro assets.
bun run packages/cli/src/index.ts seed-catalog

# Provision accounts (registration is closed during the competition) and grant demo credits.
bun run packages/cli/src/index.ts create-user <username> <password>
bun run packages/cli/src/index.ts grant-credits <username> <amount> <grant-id>
```

### 4. Configure environment variables

```bash
export KELVOY_PROJECTS_ROOT=/data/kelvoy/projects          # artifact root (default: projects)
export KELVOY_FONT_FILE=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
export KELVOY_COMFYUI_BASE_URL=http://127.0.0.1:8188       # ComfyUI
export INFERENCE_BASE_URL=http://127.0.0.1:8100            # services/inference
export STEPFUN_API_KEY=<your-key>                           # script generation
```

### 5. Start the services

```bash
make inference    # services/inference :8100
make worker       # apps/worker consumption loop
make web-api      # apps/web :3000 (for production, run apps/web's build first; it serves the static files)
make web-app      # Vite dev server (frontend in dev mode)
```

Open `http://localhost:3000` in a browser, sign in with a provisioned account, and start from "New episode".

### 6. Tests and quality

```bash
make typecheck    # type-check the five TS packages
make test         # bun test + pytest (SQLite tests use :memory:, no services needed)
make lint         # ruff (Python side)
```

## 📆 Team & Project Timeline

| Member                                      | Role                                              |
| ------------------------------------------- | ------------------------------------------------- |
| [张小白](https://github.com/zhanghui-china) | Lead, product planning, environment setup, demo prep, demo video recording |
| 小腾子                                      | Prototype design, testing                          |
| [般度五子](https://github.com/Bandukids)    | ComfyUI deployment & development, image/video pipeline |
| [馄饨](https://github.com/nativeas)         | PRD writing, web frontend & backend, review desk & credit system |

[2026.9.29] **馄饨 (Huntun)** kept optimizing the code and shipped the third release. **张小白 (Zhang Xiaobai)** added the 4–8-reference image/video generation interfaces with [documentation](comfyui-bridge/AI_USAGE_GUIDE.md), produced the [demo deck](docs/demo/Kelvoy可旅_DEMO-V0.3.pptx) and the [demo video](https://www.bilibili.com/video/BV1PWaW6oEo1), wrote the ["Ten-Day Diary" hackathon essay](https://zhuanlan.zhihu.com/p/2088388112300892508), finalized the [project report](docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md), and submitted the entry.

[2026.9.28] **馄饨** found GPT extremely slow and opened a new Claude account (fingers crossed it won't be banned again).

[2026.9.27] **小腾子** delivered a new round of prototypes.

[2026.9.26] **馄饨** switched the vibe-coding tool to ChatGPT6 and kept developing and testing, spent a day building with sol medium, and deployed the second release. Team members tested it, discovered the product needed credits, and 100,000 credits were allocated to every member.

[2026.9.25] **馄饨**'s Claude Max account was banned and development nearly stalled — the project's first major blocker. **般度五子 (Bandukids)** wrote the image and video generation development handbooks and emphasized that prompts supported by QwenImage2.1 work better.

[2026.9.24] **馄饨** deployed the first release on the cloud Spark. **般度五子** configured the latest Qwen Image 2.1, MiniMax-H3, and StepFun ACEStep on ComfyUI, enabling image and video generation with 1–3/9 reference images, and optimized generation in every dimension. For the LLM, the team chose the StepFun Coding Plan Pro package provided by the organizer.

[2026.9.23] **馄饨** generated the first prototype with claude fable 5.1. **小腾子** drew three more prototype variants on top of it. **张小白** created the code repository, obtained a set of scenic photos from a friend for the team's reference, and set short-term goals.

[2026.9.22] The project topic was set to "scenic-area vlogs", and **小腾子** joined the team. **馄饨** exchanged ideas with friends on x.com for product inspiration and wrote the PRD. **小腾子** named the project **可旅 (Kelvoy)**, which everyone approved.

[2026.8.31] The team was founded under the name **"金银铜铁队" (Gold-Silver-Copper-Iron)** — a nod to all members being from Wuxi (无锡) — completed the hackathon registration, and applied for the cloud Spark device.

## 💖 Acknowledgments

Thanks to NVIDIA for hosting the 3rd DGX Spark Hackathon.

![1372c345249308e6df60e9bc13346ab8](nvidia-logo.png)

Thanks to Zanqi for providing Spark cloud-node compute.

![78a608fc18d7f23073836da07417fe68](zanqi-logo.png)

Thanks to StepFun for Coding Plan compute support.

![stepfun-logo](stepfun-logo.png)

Thanks to Qwen-Image, MiniMax H3, ComfyUI, FFmpeg, and the open-source model and project ecosystem.

## License

This project is released under the [Apache License 2.0](LICENSE).
