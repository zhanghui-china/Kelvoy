# DGX 三镜 Worker 技术验证（2026-09-25）

## 范围

- 提交：`94d76fd`（审核门槛与重生成）、`9d2a7ef`（独立合成脚本）。
- 节点：黑客松 DGX，Web、Worker、Inference 由 user systemd 长期运行。
- 独立 SQLite：`/tmp/e_three_1790318261003.db`，未写入正式 `apps/web/data/kelvoy.db`。
- 测试素材：`deployment-smoke/persona.png`、`landmark.jpg`，重复填入所需参考位；合成配乐为脚本生成的静音。仅验证技术链路，不属于正式画质验收。

## 结果

1. 3 镜各生成 2 张关键帧，整期在第三镜完成后进入 `kf_review`。
2. 各选 1 张后，3 镜各生成 1 段视频，整期在第三镜完成后进入 `clip_review`。
3. 第二镜标记 `rejected`、`regen_stage=video` 后重新生成，片段 key 改变；第一、三镜 key 保持不变。
4. 三镜批准后合成成功，输出 `projects/e_three_1790318261003/final/e_three_1790318261003.mp4`。`ffprobe`：H.264 + AAC，1080×1920，30 fps，6.000 s，4,830,758 字节；容器元数据含 `comment=AI 生成 · 虚构角色 · 真实目的地`、`ai_generated=true`、期 ID 和 `kelvoy_compose=ffmpeg`。
5. ComfyUI 队列最终无运行或待执行任务；Web、Worker、Inference 服务均为 active。

## 合成环境修复

最初合成失败，任务留在 `composing` 并进入第 2 次尝试。直接调用合成后端得到 `No such filter: 'drawtext'`：节点原先的 `/home/Developer/.local/bin/ffmpeg` 是不带 drawtext 的静态构建。节点已有 `/home/Developer/old/miniforge3/envs/h3-comfy/bin/ffmpeg`，确认包含 drawtext；用该程序直接合成成功，然后在 `~/.config/systemd/user/kelvoy-worker.service.d/media-tools.conf` 中将它置于 PATH 首位，并在 `font.conf` 中设置 `KELVOY_FONT_FILE=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`。重启 Worker 后，待重试合成任务成功进入 `done`。

## 剩余验收

- 测试只含 3 镜，正式 PRD 一期至少 24 镜。
- 使用重复的测试参考图，无法评估人物一致性、服装稳定性、真实地标保真度。
- 静音仅为技术验证；正式曲库文件、授权证明及 LUT / 片头片尾尚未就位。
- 当前成片总长 6 秒，由合成节拍规则将每镜截为 2 秒；不能代表目标 30 镜成片节奏。
