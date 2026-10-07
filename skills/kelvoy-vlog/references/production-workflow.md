# 生产流程

一次生产或返工的操作顺序。请求形状、字段、错误码见 [API 参考](kelvoy-api.md)。

## 需求与准备

1. 确认服务地址和会话，`GET /api/me` 验证，并读余额与 `api_contract`。`api_contract` 不是 1 就停止并告知用户。
2. 读角色、目的地、模板。名称不是 ID，同名对象展示 ID 与必要描述让用户选。角色须有可用参考图；自定义角色不可用时引导到 `/personas/<persona_id>/edit`。目的地须有地标和实景参考，模板按用户要求选，未指定时展示与目的地类型对应的候选让用户选。
3. 提交前简述角色、目的地、模板、风格、穿搭、`video_source`（默认 `references`）。只追问未确定项。
4. 读 `estimate` 的 `credit_quote` 告诉用户预计总积分，与余额比较；不够就先说，不要建期。
5. 建期，记录 `episode_id`。

## 状态与观察

```text
draft → scripting → script_review → assets → (keyframing → kf_review →) clipping
      → clip_review → compose_ready → composing → done
```

默认的 `references` 模式没有 `keyframing`／`kf_review`，下文「审核 2」仅 `keyframe` 模式出现。任一生成态可能进入 `failed`，也可能出现单镜 `failed`，读每镜状态和 `failed_task`，不能只看整期。

- 单次观察最多 60 秒，约 5 秒查询一次。仍未完成就报告阶段、待处理镜头和作品 ID，保留恢复入口，等待超时不等于失败。
- 服务负责阶段推进、自动重试与队列调度，Agent 不另起生成循环。
- 进入审核态就停止推进，展示内容并取得用户决定。用户在 Web 审片时可提示其完成后回复；恢复时重新读作品，认可服务端已有的选择，不重复写入。

## 审核 1：脚本

展示镜号、场景、动作、景别、镜头运动、地标名称、字幕。检查一镜一个主要动作、地标来自资料库；把风格或连贯性建议与用户决定分开。

用户要改时按范围选：

- 单镜措辞或参数：`PATCH` 改 `beat/caption/size/camera/landmark/kf_prompt/motion_prompt`。
- 整体重写或按意见调整：`/script/regenerate`、`/script/optimize`（instruction 写用户原意）。提交后等任务完成再继续，期间不写其他操作。
- 删镜（不低于 24 镜）、重排：重排提交全部现有镜号；删除或重排后重新读镜号。

**这是最后一个能改 prompt 的节点**（`keyframe` 模式在 kf_review 还能改一次）。用户说"镜头动作太大"之类的修改意见，如果还在脚本审核，在这里改 `motion_prompt`。

展示服务返回的规则错误，用户明确通过后 `/continue`。

## 审核 2：关键帧（仅 `keyframe` 模式）

按原始顺序给每镜标"候选 1、2…"并映射到文件 key，展示地标实景和角色参考。提交的是文件 key，不是序号。不编造质量分数，不把排序当人工选择。

选图写 `kf_selected`（首次同时写 `status=kf_selected`，已选后换图只写 `kf_selected`）。此阶段还可改 `kf_prompt/motion_prompt`。多镜决定串行提交。保留镜可为 `approved` 且有 clip。推进条件见 API 参考「继续」，不满足就列出缺哪几镜。

## 审核 3：片段

给每镜片段播放器或审片链接、已保存的 `trim_start_s`。实际素材时长由播放器或 ffprobe 取，未知不猜范围。请用户检查：人物与穿搭一致、手部正常、地标正确、动作符合物理、无幻觉可读文字。这些确认没有对应 API 字段，不伪造。

用户明确通过某镜后 `PATCH {"status":"approved"}`（`clip_ready → approved`），可同时带 `trim_start_s`。已 approved 的镜不重复写。重做的片段重新审核。没有媒体查看能力就让用户在 `/episodes/<id>` 审核。

全部 `approved` 后 `/continue` 进入 `compose_ready`。

## 合成准备

`compose_ready` 可以改 `render`（标题、片头片尾）和 `music`（曲库内的曲目，或空对象让服务自动选）。展示当前标题与配乐，用户有修改就 `PATCH`，之后再 `/continue` 开始合成。没有"无配乐"选项，用户要求不要配乐时说明这个限制。

## 返工与重试

| 情况 | 操作 |
| --- | --- |
| 某镜成品要重做 | `/regen`，明确 `regen_stage`；用已有 prompt |
| 某镜视频明显坏了 | `/report-bad`（每镜第一次免费），不额外收积分 |
| 返工同时要改 prompt，且在 `clip_review`／`done` | 改不了。`keyframe` 模式：先对该镜 `regen_stage=keyframe` 回到 `kf_review`，在那里改 prompt 再继续。`references` 模式：只能用已有 prompt 重做，如实告知 |
| 某镜或某阶段 `failed` | 读 `failed_task`，告诉用户是哪一步，用户决定后 `/retry`（期级，不分镜） |
| 仍在生成 | 只观察，不叠加任务 |
| 成片要重剪 | 在 `done` 用 `/recompose`；合成失败用 `/retry` |
| 旧期（无 `cut_policy=fixed_1s`）想用新剪辑 | 向用户说明所有镜要重审，用户同意才 `/convert-cuts` |

prompt 写入失败就停止，不用旧 prompt 开新任务。局部返工后读作品，核对其他镜的候选、选图、片段未变；被替换的内容重新过对应审核点。重新合成只入队合成，不重跑单镜。所有生成类操作先查余额（见 API 参考「积分」）。

## 中断与恢复

恢复记录包含服务地址、作品 ID、最后观察状态、待执行的用户决定，不存密码或 cookie。再次工作先 `GET` 作品。写请求结果不明时的核对步骤见 API 参考「错误与请求结果不明」。

## 交付

`done` 之后：

1. 从 `episode.final.key` 取成片，不猜路径。`GET` 成功且内容确为视频才报告可访问。
2. 读 `episode.final` 的 `duration_s/width/height/fps`，再用 ffprobe 实测。ffprobe 测了才写"实测"，只来自 `final` 或 `render` 写"服务记录"。AI 标识靠画面检查，`ai_label=true` 只是配置证据。
3. 给出需登录的下载链接与审片链接。用户要求分享才调 `/share`。
4. 成本：`episode.credits_used`（积分）与 `shots[].model` 里的调用记录；没有记录就说未知。
