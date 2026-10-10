# GX10 官方 H3 提示词编写上线记录（2026-10-10）

Web／Worker 已于 2026-10-10 09:26（上海时间）发布功能提交 `cf00d165301b97d1b56eac35326454089f5ee36e`。每次新视频生成先按官方 H3 skill 编写英文最终提示词，覆盖首次生成、手工编辑后生成与重试；编辑字段保持中文原稿。新素材生成 4–5 秒，成片每镜 1 秒及现有视频积分价格不变，手工保存不执行模型调用。

## 来源与运行

- 官方 `h3-prompt-writing` 固定提交 `d21241f0a4b3acbb34c97dae47fa417b7065e438`，已通过 skill-installer 安装到本地 Codex，仓库保留同版本原文、两份指南和项目发现链接。逐文件核对安装目录与仓库 SHA256 一致；来源、散列及上游 README 所链接的许可副本来源见 `skills/h3-prompt-writing/UPSTREAM.json`。未安装另外八种风格流程。
- Worker 读取发布目录中的文档，使用现有 StepFun 配置，无运行时 GitHub 下载。I2VA 使用首帧指令加三段；Ref2VA 读取共享 base 指南及 ref 指南，输出六段。参考标记按人物／场景实际上传顺序，背景音乐为 `N/A`。
- Engine 只构造纯数据上下文；Worker 承担读取、编写、校验与原子缓存；Inference 接收最终提示词。缓存包含上下文、实际图片散列、模式、时长、画幅、文档内容版本、编写器版本与 LLM 配置。编写后和提交视频前均核对参考图散列。
- `model.video.prompt` 是实际提交全文，可选 `h3_prompt` 保存编写来源和有序参考图散列；旧记录保持兼容。无新 HTTP 路由、数据库迁移或计费动作。

## 发布、备份与回退

- 发布目录 `/home/huntun/kelvoy-releases/h3-prompt-20261010-cf00d16`；Web／Worker 使用用户级 `zzzz-h3-prompt.conf`。原 `zzz-script-freedom.conf` 和发布目录保留。本地 main 已合入功能及发布记录，未推送 GitHub。
- Inference 保持 `/home/huntun/kelvoy-releases/system-diagnostics-20261009-975a81e/services/inference`，PID `66434` 与工作目录在切换前后相同，未重启或修改其环境。新发布的验证使用独立 `.venv`，未链接、同步任何旧推理环境或共享 GPU 软件。
- 成功切换备份 `/home/huntun/kelvoy-backups/pre-h3-prompt-20261010T012640Z-cf00d16`（umask 077）：SQLite backup `kelvoy-cutover.db`、`projects-cutover.tar`、完整素材 SHA256 清单、原三个服务配置、受保护配置、切换脚本、验收和全套验证日志，以及 `deployment.json`。
- 代码包 SHA256 为 `8becc896ead2cfe4637be010352b19d50743ef245d36e81739cc1e206a1dedac`，本地和 GX10 一致；打包当前提交的五份工作流测试夹具，片头片尾按 Git LFS 内容散列复制到新发布目录，不覆盖旧目录。
- 停服务前后确认 held／pending／processing 为 0。验收清理后所有业务表逐行与备份一致，素材完整文件清单和 SHA256 一致，quick_check 为 ok。固定运维白名单仍为原 7 个用户 ID，受保护配置文件 SHA256 不变；临时账号未加入白名单。
- 回退：在队列空闲的维护窗口停止 Web／Worker，移走两个服务的 `zzzz-h3-prompt.conf`，daemon-reload 后启动原服务。保留旧目录与配置；无须恢复数据库或素材，避免覆盖上线后的新数据。编写缓存可保留，旧版本会忽略该目录。

## 验证与验收

- 本地隔离环境及合入 main 后：874 项 Bun、100 项 pytest 通过，五包类型检查、ruff、生产构建通过。GX10：873 项 Bun 通过、1 项 macOS 专属 ffmpeg 测试跳过；100 项 pytest、类型检查、ruff、生产构建通过。pytest 保留已有 Starlette/httpx 弃用告警。
- 编写器回归覆盖 I2VA／Ref2VA、真实参考顺序、4／5 秒、中文原稿、固定机位与烧饼特写、输入／输出／缓存内容审核、一次格式纠正、HTTP 错误、单次超时、进行中取消、版本／模型／画幅缓存失效，以及编写期间换图和越界路径。新增来源字段有效与非法值、旧记录无来源均经过类型／运行时校验回归。
- 独立审查发现并补齐拒绝案例：在正确描述后追加抛饼动作、招牌文字、矛盾的总时长，或在音景等其他段落加入对白／歌词。修正经回归和两轮独立复审通过；明确的否定约束仍允许。
- Worker 暂停时运行 `verify-h3-prompt.ts`：真实 HTTP 创建临时私有作品、视频积分预留、模拟失败两次后退款、HTTP 手动重试成功。首次编写结果跨两次失败和一次手动重试只调用模拟 LLM 一次；提交给模拟 Inference 的全文与持久化记录完全一致。
- 手工保存不增加模型调用；编辑运动字段、替换临时场景参考图使编写缓存失效。关键帧模式额外验证 5 秒 I2VA。人工核对日志中的两个英文回归 prompt：仅手与黄山烧饼、轻微转腕、固定镜头、单一连续镜头；人物／场景参考关系与上传顺序一致，无露脸、吃饼、切镜或配乐。
- 同窗口运行 `verify-storyboard.ts` 与 `verify-description-save.tsx`：双账号、版本冲突、编辑锁、选择性生成预留、旧成片／分享保留、失败与已选关键帧状态下免费保存等回归通过。临时账号、会话、作品、任务、积分和合成素材全部清理。
- 三服务 active/running、NRestarts=0，Web／Inference health 和 Tailscale Web health 正常；切换后 Web／Worker warning 日志为 0。前端资源仍为 `index-NtT5dh59.js`，此版本不改变 UI 布局，未执行真实浏览器交互验收。

**所有线上模型调用均为模拟 LLM／Inference，未提交真实 LLM／GPU 生成任务，未 PATCH 或重新生成原黄山作品。验收证明提示词约束和调用链正确，不代表已验证真实出片画质。**

## 首次切换自动回退

首次备份 `/home/huntun/kelvoy-backups/pre-h3-prompt-20261010T012521Z-cf00d16` 保留。H3 模拟验收与分镜回归通过后，额外的根目录 TSX 验收脚本无法找到 `react/jsx-dev-runtime`，流程自动移除本次 drop-in 并恢复旧 Web／Worker。原因是 React 依赖属于 `apps/web` workspace，根目录验收脚本没有其模块搜索路径；应用源码与全套测试不受影响。

在独立本地 HTTP 环境及 GX10 只读模块解析中确认根因后，仅为验收进程设置 `NODE_PATH=<新发布目录>/apps/web/node_modules`。重新切换前逐表、逐文件散列核对第一次备份，确认生产数据、素材和配置均无变化、7 个账号、空队列。随后重新备份，三项验收全部通过并完成发布；无需修改应用代码或依赖声明。
