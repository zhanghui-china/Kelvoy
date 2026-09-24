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
