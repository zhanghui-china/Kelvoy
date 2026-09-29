# Kelvoy Web 技术白皮书

> 版本: v1.0  
> 更新: 2026-09-29  
> 项目: Kelvoy · 可旅 —— AI 旅行 Vlog 生产工作台

---

## 一、系统架构总览

### 1.1 架构设计理念

Kelvoy Web 系统采用 **"Hono API + 本地 SQLite 唯一真源 + 乐观锁审片台"** 的分层架构设计。Web 层只负责账号、资产、期数据与审核决策的读写，**不做任何模型调用、不碰 GPU、不跑 ffmpeg**——生成任务由 Worker 消费 SQLite 任务队列完成，两端通过数据库解耦（ADR-0004）：

```
┌─────────────────────────────────────────────────────────────┐
│                      用户层（浏览器）                        │
│  React 18 + Vite 5 + TypeScript + React Router 6            │
│  官网单页 / 登录 / 建期 / 审片台 / 用量 / 设置 / 分享页      │
├─────────────────────────────────────────────────────────────┤
│                    服务层（apps/web :3000）                  │
│  Hono 4 + Bun 运行时                                        │
│  auth · me · personas · destinations · templates            │
│  episodes（建期/详情/文件） · episode-review（审片台写）    │
│  share（公开分享页） · assets（共享参考图）                 │
├─────────────────────────────────────────────────────────────┤
│                  数据层（packages/store）                    │
│  SQLite 唯一真源：episodes / personas / destinations        │
│  / templates / tasks / sessions + 积分四表                  │
│  乐观锁 row_version · 行级 owner_id 隔离                    │
├─────────────────────────────────────────────────────────────┤
│                  生成层（apps/worker，独立进程）             │
│  轮询 tasks 表 → 调推理服务 → 产物落盘 → 写回期 JSON        │
│  （与 Web 无内部 HTTP API，仅通过 store 交换数据）           │
└─────────────────────────────────────────────────────────────┘
```

**关键解耦点**：Web 与 Worker 暂时同机部署，但二者只通过 `@kelvoy/store` 的 async 函数共享数据，没有任何进程间 HTTP 调用。Web 提交的审核决策写进期 JSON 与任务表，Worker 消费后写回结果，前端靠轮询看到最新状态。

### 1.2 核心设计原则

| 原则 | 说明 |
|---|---|
| **本地优先** | 不用云端基础设施（无 Postgres / Redis / 对象存储）；SQLite 是唯一真源，产物存本地磁盘（ADR-0004） |
| **职责隔离** | `apps/web` 不含模型调用、ffmpeg、GPU 代码；目录职责由 CLAUDE.md 硬约束 |
| **行级多租户** | 所有 owner 域路由挂 `requireOwner` 中间件，以 `owner_id` 过滤；请求体里没有"操作别人"的表达方式 |
| **乐观锁并发** | 期 JSON 每次写回带 `row_version`；冲突返回 409 + 服务端最新版本号，前端自动恢复 |
| **状态机驱动** | 期级 12 态 / 镜级 9 态转移合法性由 `@kelvoy/engine` 判断，store 与路由只做搬运（PRD §6） |
| **失败友好** | 任何生成态可失败；失败任务可重试且复用已成功落盘的候选；前端 3 秒轮询自动恢复视图 |
| **可复现记录** | 每镜记录 provider / 模型 / 版本 / seed / prompt / 参考图哈希 / 尝试次数 / 费用 |

---

## 二、后端技术栈

### 2.1 技术选型

| 组件 | 版本 | 用途 |
|---|---|---|
| Bun | ≥1.4 | 运行时（HTTP 服务、密码哈希、文件 IO） |
| TypeScript | ≥5.5（strict） | 类型系统，`noUnusedLocals/Parameters` 开启 |
| Hono | ≥4.6 | HTTP API 框架（路由、cookie、静态托管） |
| @kelvoy/engine | workspace | schema 运行时校验、状态机、规则（共享包） |
| @kelvoy/store | workspace | SQLite 持久层（唯一拥有连接的包） |
| Bun.password | 内置 argon2id | 口令哈希与校验，不引第三方依赖 |
| hono/cookie | 内置 | 会话 cookie 读写（httpOnly + SameSite=Lax） |

### 2.2 目录结构

```
apps/web/src/server/
├── index.ts                 # Hono 主入口：路由挂载、/api/* 404 JSON、
│                            # dist 静态托管、SPA fallback、PORT=3000
├── middleware/auth.ts       # requireOwner：session cookie → ownerId
└── routes/
    ├── auth.ts              # POST /login /logout（DECOY_HASH 防时序探测）
    ├── me.ts                # 账号信息 / 设置 / 积分 / 改密码
    ├── personas.ts          # 角色 CRUD + 参考图 multipart 上传（3–7 张）
    ├── destinations.ts      # 目的地库 + 地标实景参考图
    ├── templates.ts         # 模板列表 / 新建 / 删除
    ├── episodes.ts          # 建期 / 列表 / 概览 / 用量 / 估价 / 详情
    │                        # / 修改 / 存为模板 / 产物文件
    ├── episode-review.ts    # 审片台写路由：镜编辑 / 重排 / 删镜 / 重生成
    │                        # / 坏镜报告 / 继续 / 重试 / 重新合成 / 剪辑转换 / 分享开关
    ├── episode-common.ts    # owner 校验 + 乐观锁错误映射（两文件共用）
    ├── share.ts             # 公开分享页（免登录，字段白名单）
    ├── assets.ts            # 共享参考图（dest/ persona/ 前缀白名单）
    ├── file-path.ts         # realpath 防 symlink 逃逸
    └── health.ts            # GET /api/health
```

> 单文件不超过 500 行是仓库硬规范——`episode-review.ts` 从 `episodes.ts` 拆出即为此例，二者共用 `episode-common.ts` 的三件小工具。

---

## 三、前端技术栈

### 3.1 技术选型

| 组件 | 版本 | 用途 |
|---|---|---|
| React | 18.3 | UI 框架（内置状态，不引全局 store） |
| React Router DOM | 6.26 | 客户端路由（15 条路由：官网 / 登录 / 分享页 + 工作台 12 页） |
| Vite | 5.3 + plugin-react | 开发服务器（/api 代理到 :3000）与构建 |
| qrcode | 1.5.4 | 分享链接二维码（纯前端生成 dataURL） |
| TypeScript | ≥5.5 strict | 端到端类型（与 engine schema 共享类型） |
| CSS | 自研变量体系 | 无 UI 框架；浅蓝灰底 #F3F7FC + 蓝强调 #2563FF（PRD §17） |

### 3.2 目录结构

```
apps/web/src/frontend/
├── App.tsx                  # 路由表：官网 / 登录 / 分享页 + 工作台 12 页
├── main.tsx                 # 入口
├── api/client.ts            # 类型化 API 客户端（apiFetch / multipart / URL 构造）
├── labels.ts                # 枚举中文展示名（状态机/景别/机位/场景时段/目的地类型）
├── guide.ts                 # 帮助中心六步创作指引 + 上下文提示文案
├── onboarding.ts            # 新手引导五步完成状态推导（不落库，由期状态算出）
├── OnboardingChecklist.tsx  # 首页引导清单（可从帮助页重新打开）
├── episode-view.ts          # 期显示名 / 本周统计等纯函数
├── episode-draft.ts         # 新建一期草稿（sessionStorage，按 owner 隔离）
├── destination-refs.ts      # 地标参考图计数 / 最低张数判断
├── persona-access.ts        # 官方角色不可编辑等归属判断
├── GuideTip.tsx             # 上下文指引条（联动 /help 锚点）
├── AssetImage.tsx           # 统一参考图加载（缺失占位）
├── ui.tsx                   # 基础组件（Button/Card/Field/Status…）
├── icons/index.tsx          # 描边风格 SVG 图标
├── hooks/
│   ├── useApiResource.ts    # 请求状态机（loading/error/data/retry + 3s 轮询版）
│   └── singleFlight.ts      # 同一异步操作并发去重
├── layout/
│   ├── Layout.tsx           # 侧栏 + 顶栏外壳（可折叠 / 移动端抽屉 / 跳转链接）
│   ├── AccountSummary.tsx   # 侧栏账户摘要（用户名 + 积分余额）
│   ├── dialog-focus.ts      # 移动端抽屉焦点圈定（Tab wrap）
│   └── sidebar-preference.ts# 侧栏折叠偏好持久化
├── pages/                   # 页面组件（见 §8.1）
└── review/                  # 审片台组件（按期状态分发，见 §8.1）
```

---

## 四、审片台流水线设计

### 4.1 流程与状态分发

期级状态机（12 态）：

```
draft → scripting → script_review → assets → keyframing → kf_review
      → clipping → clip_review → compose_ready → composing → done
（任一生成态可 → failed；done 可回 composing 重新合成）
```

`EpisodeDetailPage` 每 3 秒轮询期详情（`done` / `failed` 终态即停），按 `status` 分发到对应视图：

| 状态 | 视图组件 | 用户动作 |
|---|---|---|
| draft / scripting / assets / failed | `ProgressView` | 等待 / 失败重试 |
| script_review | `ScriptReview` | 改镜、删镜、重排、脚本助手、继续 |
| keyframing / kf_review | `KeyframeReview` | 选关键帧、改 prompt 重生成、继续 |
| clipping / clip_review | `ClipReview` | 选 1 秒起点、五项红线确认、坏镜报告 |
| compose_ready | `ComposeSetup` | 标题 / 字幕 / 转场 / 配乐 / 片头片尾，保存后开始合成 |
| composing / done | `DoneView` | 播放、下载、分享、重做镜头、重新合成 |

顶部 `StageSteps` 恒显阶段进度条，按 `video_source` 区分两条路径（直出 5 步 / 传统 6 步），失败阶段单独标红。

### 4.2 执行机制

- **任务下发**：审片台写路由只改期 JSON（审核决策、产物指针）并写任务进 `tasks` 表；`continue` 路由按阶段决定下发整期任务还是逐镜任务（关键帧 / 视频按镜拆分，各带 `shot_no`）；
- **素材快照**：期详情接口按期记录的 `persona_version` / `destination_version` 返回当时的角色与目的地快照，后续资产修改不影响老期；
- **失败重试**：`/retry` 按数据库中的失败任务重新入队，使用新动作积分预留并沿用原 `generation_id`，已成功落盘的候选直接复用；
- **旧项目迁移**：`/convert-cuts` 把旧节拍剪辑转为每镜严格 1 秒，保留片段、逐镜回到待确认状态，旧成片暂停交付。

---

## 五、数据访问与状态一致性

### 5.1 SQLite 唯一真源

Web 不自建存储：所有读写经 `@kelvoy/store`（唯一拥有 SQLite 连接的包）。业务规则（schema 校验、状态转移合法性、镜头结构规则）由 `@kelvoy/engine` 判断，路由层只做参数解析与错误映射，不自造第二套校验。

### 5.2 乐观锁（row_version）

期 JSON 的每次写回都携带 `row_version`：

```
前端写请求 { row_version: N }
  ├─ 匹配   → 落库，row_version 变 N+1，响应带回
  └─ 不匹配 → 409 { error: "version_conflict", current_row_version: M }
```

前端 `useEpisodeMutation` 收到 409 时自动采用服务端返回的最新版本号并触发刷新，用户改动与新数据合并展示；写操作自带 single-flight 去重，切期后旧响应作废（epoch 计数）。

### 5.3 请求体校验

所有 POST / PATCH 请求体先过 `@kelvoy/engine` 的 `validate*` 函数（如 `validateLoginRequest`、`validateCreateEpisodeRequest`、`validateUserSettingsPatch`），失败返回 400 + `errors[]`；JSON 解析失败静默归一为非法请求，不抛 500。

---

## 六、安全机制

### 6.1 认证与会话

- **登录**：用户名 + 密码（Bun.password argon2id 校验）；用户名不存在时也对占位哈希跑一次 verify，防响应耗时探测账号是否存在；
- **会话**：`kelvoy_session` httpOnly + SameSite=Lax cookie，`sessions` 表存过期时间；`requireOwner` 中间件统一解析为 `ownerId`；
- **不开放注册**：比赛期间防其他参赛队误入，账号由团队用 CLI `create-user` 预置（FR-11）；
- **改密码**：必须先验旧密码（cookie 被借走也不够），新旧口径与登录一致。

### 6.2 授权与数据隔离

- personas / episodes / templates / me 等路由全部行级 `owner_id` 过滤；官方资产（`owner_id = null`）只读共享；
- 请求体不含 user_id / username 字段——"改别人"在协议上不可表达；
- 分享页（免登录）响应只挑成片与分镜字段，不含账号信息；slug 不存在与分享关闭统一 404，不泄露链接存在性。

### 6.3 文件路径防护

| 防线 | 实现 |
|---|---|
| 期产物 | `resolveArtifactPath` 把路径锁死在 `<root>/<episode_id>/` 内，`join` 归一化 + 前缀检查双保险 |
| 共享参考图 | `resolveAssetPath` 只放行 `dest/` 与 `persona/` 前缀；persona 段回查归属，他人角色 404 |
| Symlink 逃逸 | `staysOnDiskPath` 用 realpath 校验目标仍在 projects 根的真实路径之下（缺失文件仍走正常 404） |
| URL 编码绕过 | 对解码后的参数再校验 canonical key，`relative(root, file) === key` 防编码斜杠注入 |

### 6.4 上传边界

参考图上传走 `multipart/form-data`：`parseBoundedMultipart` 先按 `Content-Length` 限流再解析，总量上限 = 7×10MB + 1MB，单张 ≤ 10MB，总数 3–7 张，超限精确报错（当前张数 / 本次张数 / 合计）。

---

## 七、前后端通信

### 7.1 API 设计规范

- 统一前缀 `/api/*`，响应形如 `{ ok: true, ... }` 或 `{ ok: false, error, ... }`；
- 未匹配的 `/api/*` 返回 404 JSON 而非 SPA HTML（显式 catch-all 兜底）；
- 常见错误码：`unauthorized` / `invalid_credentials` / `not_found` / `invalid_path` / `version_conflict`（附 `current_row_version`）/ `illegal_transition` / `content_blocked`（附 `violations[]`）/ `script_rule_violation`；
- 写操作统一回 `{ row_version }`，前端无需等下一次轮询即可继续操作。

### 7.2 轮询策略

- 期详情页 3 秒轮询，终态（done / failed）自动停止；
- 列表 / 资源页一次性加载 + 手动重试，不轮询。

### 7.3 静态托管与开发代理

- 生产：`vite build` 产物 `dist/` 由 Hono 进程托管，任意非 API GET 回退 `index.html`（SPA 路由）；
- 开发：Vite dev server 把 `/api` 代理到 `http://localhost:3000`，前后端进程独立热更新。

---

## 八、前端组件架构

### 8.1 核心组件职责

| 组件 | 职责 |
|---|---|
| `Layout` | 工作台外壳：三组九项侧栏导航、可折叠（localStorage 记忆）、移动端原生 dialog 抽屉（焦点圈定 + Escape） |
| `NewEpisodePage` | 建期表单：双栏（本期内容 + 选角色），高级设置折叠区，实时估价，URL 参数预选（destination / persona / template） |
| `EpisodeDetailPage` | 审片台容器：轮询 + 状态分发 + 存为模板入口 |
| `ScriptReview` | 审核 1：表格 / 故事板双视图、镜编辑、删镜（下限 24）、重排、CSV 导出、脚本助手（优化指令 / 重新生成） |
| `KeyframeReview` | 审核 2：候选并排点选（顺序即生成顺序，不打分）、地标与角色参考对照、改 prompt 重生成、策划稿查看 |
| `ClipReview` | 审核 3：播放器 + 起点滑块（1/30s 吸附，拖动实时预览 1 秒）、五项质量红线逐条确认、坏镜报告、旧剪辑转换 |
| `ComposeSetup` | 合成设置：标题 / 字幕 / 转场 / 配乐 / 片头片尾，保存后才能开始合成 |
| `DoneView` | 成片交付：播放校验、下载、分享（复制文案 / 链接 / 平台入口 / 二维码）、成本报告、重做镜头、重新合成 |
| `ReviewQueue` / `ShotFocusNav` | 待审队列与逐镜导航（上一镜 / 下一镜 / 展开全部） |
| `HomePage` | 继续上次、创作空间四卡、目的地灵感（类型筛选）、最近作品、本周统计、新手引导 |
| `WorksPage` | 全量作品列表：关键词 / 状态 / 地区 / 省份 / 季节筛选，按角色归组"系列" |
| `PersonasPage` / `PersonaEditPage` | 角色库与新建 / 编辑（拖拽上传参考图） |
| `DestinationsPage` | 目的地库：地标参考图、最佳时段、须保真特征、动线与在地信息 |
| `TemplatesPage` | 模板中心：官方 / 我的分组，新建与删除 |
| `UsagePage` / `CreditPanel` | 积分与用量：余额、流水、按期、按 provider / model 汇总 |
| `SettingsPage` | 出片默认值（语气 / 候选数）+ 修改密码 |
| `HelpPage` | 六步创作指引 + 可搜索帮助 + 资源说明 |
| `SharePage` | 免登录分享页：播放、下载、AI 标识说明 |
| `LandingPage` 系列 | 官网单页（锚点导航：top / solutions / features / how / destinations / faq） |

### 8.2 状态管理

- **无全局 store**：页面级数据用 `useApiResource` / `usePolledApiResource` 管理请求生命周期（loading / error / data / retry）；
- **写操作**：`useEpisodeMutation` 是审片台写操作唯一入口——single-flight、409 自动恢复版本、成功即 refresh、401 跳登录；
- **草稿**：新建一期未提交内容存 `sessionStorage`（按 owner_id 隔离），提交或退出登录清除；
- **本地 UI 状态**：片段审核的五项红线勾选故意不持久化（schema 无此字段，避免为交互改数据模型）。

### 8.3 样式设计

- CSS 变量体系统一视觉：浅蓝灰背景 `#F3F7FC`、白色主面板、蓝色强调 `#2563FF`（PRD §17）；
- 按页面 / 场域拆分样式文件（`index.css` / `shell.css` / `workspace.css` / `review.css` / `LandingPage.css`…），无 CSS-in-JS 运行时开销；
- 可访问性内建：skip-link、`aria-pressed` / `aria-current` / `role=alert`、原生 dialog 焦点管理、表格横向滚动提示。

---

## 九、部署架构

### 9.1 服务组合

| 服务 | 端口 | 用途 |
|---|---|---|
| `apps/web`（Hono API + 静态托管） | 3000 | 本文档所述的全部 Web 功能 |
| `apps/worker` | — | 任务消费（Web 不直接依赖，经 store 解耦） |
| `services/inference` | 8100 | 推理适配（Worker 调用，Web 不接触） |
| ComfyUI | 8188 | 图像 / 视频模型执行 |

### 9.2 配置与环境变量

```bash
PORT=3000                       # Web 监听端口
KELVOY_PROJECTS_ROOT=projects   # 产物根目录（期产物 / 共享参考图）
# 账号预置（团队 CLI，不开放注册）：
bun run packages/cli/src/index.ts create-user <用户名> <密码>
bun run packages/cli/src/index.ts grant-credits <用户名> <额度> <发放ID>
```

开发模式：`make web-api`（API :3000）+ `make web-app`（Vite，代理 /api）；生产模式：`vite build` 后由同一 API 进程托管 `dist/`。

---

## 十、性能优化

- **概览投影**：作品列表走 `GET /api/episodes/overview`，只取列表所需字段，不拉全量期 JSON（含 shots / 模型记录）；
- **按需加载详情**：期详情与模型记录仅在审片台 / 用量页读取；
- **写后即返**：写操作响应带回 `row_version`，前端不等轮询即可连续操作；
- **single-flight**：同一按钮的重复点击 / 并发提交自动去重；
- **轮询降载**：3 秒轮询仅发生在活跃期页面，终态自动停止；
- **图片按需引用**：候选图 / 参考图通过 `/api/episodes/:id/files/*` 与 `/api/assets/*` 直取文件流，不经 JSON base64。

---

## 十一、测试覆盖

### 11.1 测试结构（bun:test，与源码同目录）

```
apps/web/src/
├── server/routes/*.test.ts        # 端点集成测试（auth / me / personas /
│                                  # destinations / templates / episodes 建期与审核写 / share / assets）
└── frontend/…                     # 组件与纯函数测试
    ├── App 路由 / Layout / AccountSummary / PublicPages
    ├── OnboardingChecklist / onboarding / episode-view / destination-refs
    ├── episode-draft / help-search / resource-library / singleFlight
    ├── EpisodeDetailPage / WorksPage / PersonasPage / DoneView
    └── ScriptReview 布局 / failed-stage / dialog-focus / sidebar-preference
        / episode-mutation-version / scriptExport / shot-focus / tally / workflow-guidance
```

### 11.2 测试策略

- **路由集成测试**：直接以 Hono app 发请求断言状态码与响应形状（含 401 / 409 / 404 边界）；
- **组件测试**：关键交互（引导清单、审核布局、分享动作）用组件级测试锁行为；
- **纯函数测试**：CSV 导出（公式注入防护）、草稿读写、筛选逻辑等；
- CI：`.github/workflows/ts-ci.yml` 跑 typecheck + bun test。

---

## 十二、总结

Kelvoy Web 系统是一个**职责克制、状态严谨、可现场演示**的旅行 Vlog 创作工作台，其技术架构体现了以下核心价值：

1. **架构清晰**：Web / Worker / store / engine 四层边界由文档与目录双重约束，Web 层零模型依赖；
2. **并发安全**：乐观锁 + single-flight + 状态机校验，多人 / 多标签页操作不丢更新；
3. **安全内建**：httpOnly 会话、行级隔离、路径白名单与 realpath 双防线、上传边界、防时序探测；
4. **体验完整**：两条创作路径、三个审核点、合成设置门、成片交付与分享闭环，加载 / 错误 / 重试 / 可访问性全覆盖；
5. **成本透明**：动作级积分预留 / 结算 / 释放与用量页，每次模型调用可追溯；
6. **测试完备**：路由集成 + 组件 + 纯函数三层测试守护核心路径。

系统作为 NVIDIA DGX Spark 单机闭环的"人机界面层"，把生成能力的复杂性留在 Worker 与推理服务，把**可控、可干预、可复现**交给用户，是"AI 视频工业化"在 Web 端的完整实践。
