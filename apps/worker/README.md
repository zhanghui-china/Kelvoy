# @kelvoy/worker

轮询 `@kelvoy/store` 的 `tasks` 表，调 `services/inference` 生图/生视频，产物落本地磁盘，并跑合成（ADR-0004）。

```bash
make worker      # bun --watch src/index.ts
```

## 产物目录

`KELVOY_PROJECTS_ROOT`（默认 `projects`）下有两类路径：

| 路径 | 谁写的 | 说明 |
| --- | --- | --- |
| `<root>/<episode_id>/kf/…` `clip/…` `final/…` | 流水线 | 期内产物。成片固定是 `final/<episode_id>.mp4`（约定，不进 schema，见 `packages/engine/src/stages/compose.ts`） |
| `<root>/music/…` `lut/…` `intro/…` `outro/…` | **人工放** | 跨期共享素材 |

共享素材要人手放好，合成才跑得起来——缺文件时 `compose` 会报「合成缺少 X：`<路径>`」而不是静默出一条无声/无水印的成片：

- `music/`：授权曲库音频。文件名和 bpm 必须和 `packages/engine/src/providers/music-library.ts` 的 `MUSIC_CATALOG` 对得上（bpm 是卡拍对齐的输入，标错切点就不在拍上）。
- `lut/`：账号级 LUT，`.cube` 文件，路径写在 `Persona.style.lut`。
- `intro/` `outro/`：片头片尾成品，路径写在 `Template.intro/outro`，创建期时快照进 `episode.render`。

## 合成（compose）需要的环境

- **ffmpeg / ffprobe 在 PATH 上**，且构建时带 `libfreetype`（`ffmpeg -filters | grep drawtext` 要有输出）。homebrew 的默认 bottle **不带** drawtext，画面 AI 标识和标题会失败。
- **`KELVOY_FONT_FILE`** 指向一个 CJK 字体文件（例如 `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`）。标题和 AI 标识水印都是中文，不指定字体 drawtext 会渲染成方框，所以没设这个变量时直接报错而不是出一条看不了的成片。

```bash
export KELVOY_PROJECTS_ROOT=/data/kelvoy/projects
export KELVOY_FONT_FILE=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
```

## H3 提示词编写

视频生成先执行 `src/generation/h3-prompt-writer.ts`，使用随源码发布的官方 `skills/h3-prompt-writing` 原文。固定版本、来源与许可见该目录 `UPSTREAM.json` / `LICENSE` / `NOTICE`；只安装通用 skill，不增加风格工作流。部署必须包含 SKILL.md 与 references/base-en.txt、ref-en.txt，运行期间不从 GitHub 下载。

沿用 `STEPFUN_API_KEY`、`STEPFUN_API_BASE`（默认 `https://api.stepfun.com/step_plan/v1`）、`STEPFUN_MODEL`（默认 `step-3.5-flash`），密钥只放受保护环境配置。每次 LLM 调用 60 秒，JSON 或引用保留说明行的格式失败最多纠正一次；语义约束、动作或审核失败不纠正，不能提交原稿。视频积分价格包含编写。

有效编写结果存于 `<root>/<episode_id>/h3-prompts/<input_hash>.json`，通过临时文件与原子发布避免半写文件。缓存以实际参考图内容散列与输入／模型／文档版本为依据，重试与租约变更可复用；编辑字段或换图会失效。不要删除活跃作品的缓存。`model.video.prompt` 保存最终 H3 全文，`h3_prompt` 保存编写来源。排查时核对记录、缓存与 Inference 请求，不打印 API 密钥。

新视频素材时长 4–5 秒，成片每镜 1 秒不变。中文编辑原稿保持原样，保存不启动模型。线上验收采用临时作品和模拟模型；真实 LLM／GPU 与原黄山作品不参与此版本验收。发布时先备份数据库／素材，确认队列空闲，再切换 Web／Worker；Inference 和固定 7 人白名单保持原部署配置。

## 视频预算与失败诊断

`KELVOY_VIDEO_TIMEOUT_SECONDS` 默认 900 秒，允许 30–1800 的整数，启动时校验；必须与 Inference 一致。视频 HTTP 总预算为配置加 60 秒，关闭 Bun socket idle timeout，由 AbortController 控制；图片与提示词改写预算保持原值。

每 30 秒续租，退出、用户取消或丢失租约会中止调用，由 Inference 定向取消本次 ComfyUI prompt。生成超时、无效参数、提示词格式校正后仍失败、内容审核失败不自动重跑；网络和暂时性服务错误最多两次尝试。阶段安全诊断保存在 `tasks.error`，重试保留最近失败、成功清除；退款提示仅在积分释放事务完成后显示。原素材、已审核镜头与已有成片均保留。
