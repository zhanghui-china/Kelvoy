# spark-c327 最新版部署（2026-10-10）

用户指定更新 spark-c327。Web、Worker、Inference 已统一切换至当前工作区最新源码，外网健康检查通过：[Kelvoy](http://106.13.186.155:8063)。GX10 未切换。

## 发布内容与路径

- 发布目录：`/home/Developer/kelvoy-releases/latest-20261010T132317-1ee992b`。
- 基于 `1ee992b`，包含当前未提交的字幕修复与阶段回看；并非仅部署该 Git 提交。发布目录 `RELEASE.json` 记录源码文件摘要。
- 源码包 SHA256：`e47db7cbc2fdccd87bed73a37de5c43b364c9a0e7998bcf722e00086aad31a72`。
- Inference 使用发布目录内独立 `.venv`，原有依赖环境保留。
- 三个用户级 systemd 服务使用新增的 `zzzzzz-latest-20261010.conf` 覆盖工作目录和启动命令；既有环境、模型、媒体工具、权限设置保留。
- 数据库继续使用 `/home/Developer/kelvoy/apps/web/data/kelvoy.db`，素材继续使用 `/home/Developer/kelvoy/apps/web/projects`。

新版支持旧版节拍剪辑烧录每镜字幕，缺失字幕开关默认开启；明确关闭仍关闭。字幕保存后由用户启动重新合成，原成片不会自动覆盖。阶段回看也已进入生产前端资源。

## 验证

远端冻结依赖安装、`make typecheck`、`make test`、生产构建和 Ruff 均通过：Bun 900 通过、1 跳过、0 失败（901 项，112 个文件），Python 100 通过，1 条既有 Starlette/httpx 警告。本地已完成真实 FFmpeg 字幕像素对照和浏览器交互验收，详见 [字幕验证记录](../../docs/testing/subtitle-compose-verification-2026-10-10.md)。

先复制生产数据库预演迁移，再暂停服务备份并切换。迁移为旧镜头补稳定 ID，新增 `destination_drafts`、`system_config` 表；预演确认已有字段保留。生产数据库所有表逐行摘要与预演结果一致，10 个作品和 378 条任务保留；1,054 个原素材文件 SHA256 全部一致。切换及验收时任务队列、ComfyUI 队列均为空。

独立端口及生产服务均执行 [字幕 HTTP 验收脚本](verify-subtitles.ts)：检查默认开启、设置保存、版本冲突、账号隔离、原片头／片尾／配乐路径保留、旧成片可读、字幕编辑保留视频片段。临时账号、作品、会话与素材已清理，数据库再次与预演逐表核对一致；没有生成任务、模型调用或积分扣费。

前端资源确认包含“保存字幕设置”“烧录每镜字幕”“已填写字幕”“只读阶段回看”。外网 `/api/health`、内部 Web／Inference／ComfyUI 健康检查通过，三个服务 active，切换时重启次数均为 0。

## 备份与回退

备份目录：`/home/Developer/kelvoy-backups/pre-latest-20261010T132317-1ee992b`，权限限制为当前账号访问。包含一致性 SQLite 备份 `kelvoy-cutover.db`、素材包 `projects-cutover.tar`、原服务配置、素材摘要、迁移预期副本及验收结果。`deployment.json` 记录最终验证结果，生产 HTTP 日志为 `verify-subtitles-production.log`。完整测试／构建日志位于发布目录。

需要回退时先确认无生成任务，再在 spark-c327 执行以下命令，移除本次新增覆盖，恢复原启动路径：

```bash
systemctl --user stop kelvoy-web kelvoy-worker kelvoy-inference
for svc in kelvoy-web kelvoy-worker kelvoy-inference; do
  rm -f "/home/Developer/.config/systemd/user/$svc.service.d/zzzzzz-latest-20261010.conf"
done
systemctl --user daemon-reload
systemctl --user start kelvoy-inference kelvoy-web kelvoy-worker
```

旧 Web／Worker 目录为 `/home/Developer/kelvoy-release-c7a783a`，旧 Inference 为 `/home/Developer/kelvoy-release-9731043/services/inference`。回退服务时保留增量数据库迁移，避免覆盖上线后新数据；数据库与素材备份不自动恢复。
