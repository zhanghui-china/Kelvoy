# GX10 最新版部署（2026-10-10）

按用户明确要求，GX10 的 Web、Worker、Inference 已于上海时间 13:47 更新至与 spark-c327 相同的最新源码包。[Kelvoy 入口](http://100.80.224.95:8888)使用 Tailscale。

## 发布

- 发布目录：`/home/huntun/kelvoy-releases/latest-20261010T132317-1ee992b`。
- 基于 `1ee992b`，包含当前工作区未提交的字幕修复与阶段回看。发布目录 `RELEASE.json` 保留源码文件摘要，563 个文件全部验证。
- 源码包 SHA256：`e47db7cbc2fdccd87bed73a37de5c43b364c9a0e7998bcf722e00086aad31a72`，与 spark-c327 相同。
- 三个用户级 systemd 服务新增 `zzzzzz-latest-20261010.conf`，只覆盖工作目录与启动命令。Inference 使用独立 `.venv`，Python 3.12.3；未修改旧依赖环境、共享 GPU 服务、模型、运维白名单或其他原环境配置。
- 数据库保留 `/home/huntun/kelvoy/apps/web/data/kelvoy.db`，素材保留 `/home/huntun/kelvoy/apps/web/projects`。

字幕修复与阶段回看均已进入生产前端资源。字幕设置缺失默认开启，明确关闭仍关闭；保存字幕或设置后，由用户明确启动重新合成，不自动覆盖已有成片。Qwen 图片提示词增强仍保持取消状态。

## 验证与数据保留

远端冻结依赖安装、类型检查、全量测试、生产构建及 Ruff 均通过：Bun 900 通过、1 项平台专属测试跳过、0 失败；Python 100 通过，保留 1 条既有 Starlette/httpx 警告。完整日志位于发布目录。

先在数据库副本预演，确认本次没有既有表数据变化或新表；7 个作品、106 条任务保留。停服务后再次确认业务与 ComfyUI 队列空闲，执行一致性数据库和全素材备份，再切换三个服务。生产数据库逐表、逐行摘要与预演结果一致，205 个原素材文件的完整清单和 SHA256 均一致，SQLite quick_check 正常。

独立端口及生产服务均运行 [字幕 HTTP 验收](verify-subtitles.ts)，检查默认开启、设置保存、版本冲突、账号隔离、旧片头／片尾／配乐路径保留、旧成片读取和字幕保存保留视频。验收临时账号、作品、会话和素材均清理，清理后数据库与素材再核对一致。没有模型调用、生成任务或积分扣费，也未修改或重新合成原黄山作品。

原 24 份服务配置／环境文件 SHA256 保持一致，包括受保护配置及固定运维白名单。三个服务 active，NRestarts=0；Tailscale Web 健康接口、内部 Inference 健康接口通过，ComfyUI 队列为空；完成后重新检查警告／错误日志为 0。

## 备份与回退

受保护备份目录：`/home/huntun/kelvoy-backups/pre-latest-20261010T132317-1ee992b`，包含 `kelvoy-cutover.db`、`projects-cutover.tar`、原服务配置、完整素材摘要、数据库预期副本、生产验收日志和 `deployment.json`。

需要回退时先确认任务空闲，在 GX10 执行：

```bash
systemctl --user stop kelvoy-web kelvoy-worker kelvoy-inference
for svc in kelvoy-web kelvoy-worker kelvoy-inference; do
  rm -f "/home/huntun/.config/systemd/user/$svc.service.d/zzzzzz-latest-20261010.conf"
done
systemctl --user daemon-reload
systemctl --user start kelvoy-inference kelvoy-web kelvoy-worker
```

原 Web／Worker 目录 `/home/huntun/kelvoy-releases/h3-prompt-20261010-cf00d16`，原 Inference 目录 `/home/huntun/kelvoy-releases/system-diagnostics-20261009-975a81e/services/inference` 均保留。服务回退不自动恢复数据库或素材，避免覆盖上线后新数据。
