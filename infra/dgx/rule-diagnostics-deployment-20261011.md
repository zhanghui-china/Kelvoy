# 提示词校验规则诊断部署（2026-10-11）

仅更新 Web／Worker 代码，不涉及素材、数据库迁移、Inference 和前端构建。双节点按 Spark → GX10 发布，发布源码 `c94c9df`，基线为配乐修复版 `91f132e`。

## 变更内容

用户反馈某作品 4 镜（2／4／5／8）报"视频提示词格式校正后仍无效"。排查发现所有 H3 提示词校验失败被折叠成同一个 `prompt_format_invalid`，日志和任务错误里看不出触发了哪条规则，且"校正后"的文案对未校正的失败并不准确。本次只补可观测性，不改任何校验规则。

- `H3FormatError` 新增 `rule`（抛出点写死的规则标识，不取自模型输出）和 `corrected`（写手发出过校正请求后为真）。
- 任务错误 JSON 与 Worker 日志多出 `rule`；日志另有 `corrected`。
- 文案区分：校正过仍不过 →「视频提示词格式校正后仍无效」；未校正直接未通过 →「视频提示词未通过规则校验」。
- `rule` 只存在于任务错误和日志，`getShotFailures` 给前端的仍只有 `code` 与 `message`。

提交：`3c12df2`（功能）、`2430b2d` 与 `c94c9df`（`deploy-web-worker.py` 发布脚本）。

## 发布方式

只传变更文件，不传整仓库：

- 变更包 19KB，含 8 个文件及只列这 8 个文件哈希的 `RELEASE.json`（`base_commit` 为 `91f132e`）。
- 节点上 `cp -a` 当前运行的 `music-20261011` 为新发布目录 `rule-diagnostics`：`~/kelvoy-releases/rule-diag-20261011-c94c9df`，再覆盖变更文件。依赖和前端 `dist` 沿用，无符号链接指向旧发布目录。
- 切换用 [`deploy-web-worker.py`](deploy-web-worker.py)：冻结 Web 提交 → 排空待处理任务和有效执行租约（最长 1000 秒）→ 停 Worker → 备份配置与数据库 → 写 `zzzzzzzzzz-rule-diag-20261011.conf` drop-in → 起 Web 健康检查 → 比对数据库摘要与原配置哈希 → 起 Worker。**不备份、不比对素材。**

| 节点 | UTC 切换时间 | 数据库备份 | 排空 |
| --- | --- | --- | --- |
| Spark | 01:46 | `/home/Developer/kelvoy-backups/pre-rule-diag-20261011-20261011T014648Z` | 无在途任务 |
| GX10 | 01:52 | `/home/huntun/kelvoy-backups/pre-rule-diag-20261011-20261011T015211Z` | 无在途任务 |

## 验证

- 两节点 Worker、Store 类型检查通过；该范围 308 项测试：Spark 287 通过、21 跳过、0 失败；GX10 307 通过、1 跳过、0 失败。
- 三个服务均 active、重启 0，Web／Worker 工作目录为新发布目录，Inference 未改动；本机、Spark 公网 `:8063`、GX10 Tailscale 入口 `/api/health` 均 `ok`；切换后日志无错误。GX10 7 个作品、180 条任务保留。
- 新增测试覆盖：规则名随约束失败写入、校正后失败 `corrected` 为真、结构性失败有规则名、未声明规则的错误不会把私有内容带入诊断。

**未做**：没有跑全量 `make test`、Python 测试和 lint（本次无 Python 改动，仅跑 Worker／Store 范围）；没有做带临时账号的 HTTP 验收（无接口或数据变化，只做健康与日志核对）；没有用真实失败镜头复现。已有失败镜头是发布前产生的，不会补出规则名，要拿到原因需在新版上重试或重放。

## 过程中的两处坑

- **GX10 上 22 个 ffmpeg 合成测试失败**：我的 SSH shell 的 PATH 里先找到没有 `libx264` 的 `/usr/local/bin/ffmpeg`；线上旧版在同一 shell 里同样失败，不是回归。服务 PATH 里 `~/.local/bin/ffmpeg` 在前，用服务 PATH 复跑为 0 失败。在这台机器上跑测试须使用服务同款 PATH：`/home/huntun/.bun/bin:/home/huntun/.local/bin:/usr/local/bin:/usr/bin:/bin`。
- **macOS 打 tar 夹带 `._*` 文件**：首次变更包带了 AppleDouble 文件，被 bun 当测试加载导致 2 个"失败"。Spark 上已在跑测试前清理；GX10 使用 `COPYFILE_DISABLE=1` 重新打的包，节点上为 0。

## 回退

先确认无生成任务，在对应节点执行：

```bash
systemctl --user stop kelvoy-web kelvoy-worker
rm -f ~/.config/systemd/user/kelvoy-web.service.d/zzzzzzzzzz-rule-diag-20261011.conf \
      ~/.config/systemd/user/kelvoy-worker.service.d/zzzzzzzzzz-rule-diag-20261011.conf
systemctl --user daemon-reload
systemctl --user start kelvoy-web kelvoy-worker
```

回退后恢复到 `music-20261011`（`91f132e`）。不自动恢复数据库，避免覆盖上线后的新数据和删除审计；备份仅用于核对和人工恢复。
