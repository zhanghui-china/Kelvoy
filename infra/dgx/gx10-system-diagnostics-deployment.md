# GX10 系统检测发布与验收

已于 2026-10-09 09:53（上海时间）按用户授权发布。用户明确要求当前所有用户拥有运维权限：切换时从 SQLite 读取 7 个既有 user_id，写入固定白名单；后续新增账号不会自动提升。

## 部署配置

Web：`KELVOY_OPERATOR_USER_IDS`（逗号分隔真实用户 ID，空值禁用修改）。Web 与 Worker 配置同一个 `INFERENCE_BASE_URL`。Web 与 Inference 显式配置相同 `KELVOY_BACKEND_ALLOWED_ORIGINS`，例如当前部署为本机服务时可填 `http://127.0.0.1:8188,http://127.0.0.1:5099`，远端／新增目标须先加入两端白名单，再重启加载配置。

Inference：`KELVOY_COMFYUI_BASE_URL`（缺省 http://127.0.0.1:8188）、`KELVOY_BRIDGE_BASE_URL`（缺省 http://127.0.0.1:5099）。继承地址由 Inference 解析；Worker 相应继承变量用于缓存标识，建议保持相同。白名单为空时诊断与生成均拒绝访问，发布前必须明确允许既有继承地址。

## 发布步骤

1. 确认全站任务 held/pending/processing 均为零；停止 Web 接收新请求并停止 Worker 领取任务。
2. 使用 SQLite backup API 或 sqlite3 `.backup` 备份数据库到带时间戳文件（不要只拷贝 WAL 主文件）。备份三个服务的环境／启动配置到受限路径；不得写入仓库或日志。
3. 在独立环境中运行 Bun 检查与 `uv sync --frozen`、pytest、ruff，构建 Web；不得将 `.venv` 链接到共享旧环境后同步。
4. 同版本发布 Web、Worker、Inference，保持数据库／素材目录不变，恢复服务。
5. 登录指定运维账号，检查系统配置和当前地址；只执行只读诊断，检查普通账号无法看到地址且不能提交候选／保存。确认 Web 8888、Inference 8100、ComfyUI 8188、bridge 5099 的对应状态与失败原因。
6. 静态模板依赖检查全部 healthy 仅证明节点和模型枚举存在；此验收不向共享 ComfyUI 发真实生成任务。

配置切换和继承恢复由自动化模拟后端验证，不通过共享 GPU 做真实生成验收。后续运维切换必须队列空闲并带最新版本，未保存候选测试不会落库。

## 回滚

空闲并停止领取／入队后，回滚全部三个服务版本和服务配置；新增 system_config 表可保留。旧 Worker 不读取覆盖值，须确保旧 Inference 部署地址正确。需要恢复数据库时整体恢复备份与对应媒体状态，不能混用旧主文件和新 WAL。

只修改 Inference 继承后端环境不会自动修改 SQLite 版本；应在空闲时保存／恢复继承递增版本以失效 Worker 缓存，或同时更换 INFERENCE_BASE_URL。既有媒体与素材不被配置操作覆盖。


## 本次发布记录

- 功能提交 `975a81e5b2367998151afce5e6e9fc89b8a66d6c`；目录 `/home/huntun/kelvoy-releases/system-diagnostics-20261009-975a81e`，通过 Git 增量 bundle 从 GX10 既有 main 仓库构建，未推送 GitHub。
- Web、Worker、Inference 均使用用户服务 `zz-system-diagnostics.conf` 指向新目录；原 drop-in 保留。新增受保护配置 `/home/huntun/.config/kelvoy/system-diagnostics.env`（0600），三个服务均引用；配置固定 7 个当前用户 ID、共同 Inference 地址与 ComfyUI／bridge 的本机 origin 白名单。
- 推理 `.venv` 在新目录用 `/usr/bin/python3` 独立创建、锁定同步；运行时 `inference.__file__` 确认来自新发布目录。没有链接、同步或恢复旧运行环境。
- 切换备份 `/home/huntun/kelvoy-backups/pre-system-diagnostics-20261009T015327Z-975a81e`（受限权限），含一致性 SQLite backup、原三个服务配置、受保护环境配置、切换脚本和验收结果。媒体目录不变，未改素材。
- 新发布目录先通过 GX10 typecheck、ruff、生产构建，825 项 Bun 测试通过、1 项 macOS 平台测试跳过，100 项 pytest 通过；本地 826 项 Bun、100 项 pytest 全部通过。保留既有 Starlette/httpx 弃用告警。
- 数据库副本连续两次迁移保留原有全部表数据；暂停 Web／Worker 后复核队列为空，备份后切换三服务。结束时原表与切换备份逐表一致，新增 system_config 为 version=1、两个覆盖 null，quick_check=ok，账号仍为 7，活跃任务为 0。
- HTTP 验收逐一确认 7 个现有用户均可读取运维配置；临时新增普通账号不能提交候选或保存、结果不含内部地址或依赖。候选只读检测未落库，旧版本保存返回 409，匿名访问返回 401。临时账号／会话均已清理。
- Web／Inference／ComfyUI／bridge 四项均 healthy，四套工作流依赖 healthy，ComfyUI 队列空。通过 Tailscale 验证健康接口 200、新 JS `/assets/index-CJU1r4RS.js` 包含系统检测 UI 与接口路径。
- 切换后三个服务 active/running、NRestarts=0，启动检查窗口 warning 级日志为 0。未提交真实生成、上传、取消或清队列任务；尚未执行浏览器点击验收，UI 证据为前端测试、生产资源和线上 HTTP。

本次回退只需在队列空闲时停止三个服务，移走本次三个 `zz-system-diagnostics.conf` 与新增环境文件，daemon-reload 后恢复原服务；新增表可保留。若需要恢复数据库，先备份升级后数据并单独评估数据损失，不能直接混用备份主文件与运行 WAL。本次没有触发回退。
