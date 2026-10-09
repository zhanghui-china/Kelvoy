# GX10 系统检测发布与验收

本次实现未自动发布。执行发布时须先明确真实运维 user_id；不得按用户名推断或自动提升账号。

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
