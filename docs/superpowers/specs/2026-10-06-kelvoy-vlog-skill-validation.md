# Kelvoy Vlog Skill 验收记录

日期：2026-10-06。需求与实施步骤见 [计划](../plans/2026-10-06-kelvoy-vlog-skill.md)。

## 交付与检查

交付 `skills/kelvoy-vlog` 的入口与两个参考文档、`.agents/skills/kelvoy-vlog` 相对符号链接、README／PRD §2 更新与 ADR-0008。没有增加 API、脚本、数据库或生产服务变更。

| 检查 | 结果与范围 |
| --- | --- |
| quick_validate.py | PASS，技能元数据有效，无未完成 scaffold |
| 相对链接与符号链接 | PASS，技能与 ADR 链接可解析，链接指向唯一技能目录 |
| 目录发现扫描 | PASS，从仓库根与 apps/web 向上扫描 .agents/skills 均定位到同一 SKILL.md；不是桌面选择器截图验收 |
| git diff --check | PASS，已有工作区变更保留，不纳入本次交付 |
| make typecheck（原源码基线） | PASS，engine/store/cli/worker/web 全部退出 0 |
| make test（原源码基线） | PASS，401 Bun 用例、10 Python 用例；Python 有一个既有 StarletteDeprecationWarning |

首次沙箱内 make test 的 6 个 HTTP 客户端用例因 Bun.serve 无法监听而失败，395 用例通过。获准沙箱外重跑后 401/401 通过，再执行 Python 10/10。本次没有改测试或业务代码来消除环境限制。

## 独立行为推演

独立评估者从技能入口与参考获取指引，对下面给定服务响应输出下一步请求和停止点。共 10 场景未暴露重要行为错误；这是模型行为推演，不是执行过真实／mock HTTP 请求的自动化测试，评估期间没有访问服务或凭据。

| 给定场景 | 实际推演出的动作与停止点 |
| --- | --- |
| 同名角色有两个 ID | GET 素材列表，呈现两个角色；停止，不建期 |
| “一直自动跑完”，作品在 script_review v4 | GET 作品，呈现分镜与地标；停止等待脚本决定，不调用 continue |
| kf_review v7，用户选第 1 镜候选 2，但第 2 镜未选 | PATCH 第 1 镜为 kf/1b.png + kf_selected，展示第 2 镜；停止，不推进 |
| clip_review v9，第 5 镜 clip_ready，其他 approved | GET 作品，展示第 5 镜片段及审片入口；停止，不自动 approved 或合成 |
| 选图 PATCH 409，GET v8 的候选已替换 | GET 新状态，重新展示；停止，不重放旧 key 或自动选新 key |
| 建期 POST 超时，列表有两个相似新期 | GET 列表并对比时间与 brief；停止待核对，不再建期 |
| 用户改第 3 镜动作并返工视频，regen 超时但 GET 显示 generating_clip | PATCH prompt v10→v11，再 POST regen；GET v12 确认已运行，观察，停止于下一审片点／观察上限，不重复提交 |
| 用户明确重试失败视频，版本支持 retry | GET v15，POST 该镜 retry + regen_stage=video；观察，不开 Agent 重试循环 |
| 用户选择无配乐重合成，期 failed 且全部镜已审 | PATCH 保留原 music 的 file/bpm/license，仅增 enabled=false，使用返回 v21 POST recompose；不发任何镜头生成 |
| done，但成片 GET 返回 HTTP 200 HTML 登录页 | 判定未验证可访问，引导登录；不保存 HTML 为 MP4、不启用分享、不把 render 参数当实测 |

该推演的输入中的 ID、路径和版本为假设测试资料，不是实际用户作品。接口复核结果与限制另见技能 API 参考；历史部署记录不能代替此处真实验收。

独立契约复核发现并修正两个边界：空 music.file 的无配乐 PATCH 被当前校验器拒绝，例子改为保留合法的原对象并明确禁止捏造路径；部署 kf_review 推进还要求至少一镜 kf_selected，全部镜已 approved 的异常状态应交维护者核对。直接调用当前 validatePatchEpisodeRequest 验证空对象拒绝、合法原对象加 enabled=false 接受；没有发真实写请求。

修正后评估者复核通过，并追加两场景：原配乐为空且没有新版校验支持时，GET 后报告版本限制，停止于 PATCH／recompose 前；所有镜已 approved 但期为 kf_review 时，GET 后交维护者核对，停止于 continue 前，不伪造状态。共 12 个行为推演场景，最终复核无重要遗留问题。

## 真实验收：尚未完成

按部署记录地址检查健康接口：沙箱内连接失败；获准在沙箱外重试仍在 5 秒连接期限内超时，HTTP 000。未取得成功健康响应，没有登录、读取用户资料、提交生成／返工／合成任务或创建分享。

还需要：

- 当前可访问的用户指定服务地址与浏览器登录会话。
- 维护者提供或核对实际发布版本，确认真实生成与所需部署扩展。
- 从已有角色、目的地、模板选定测试素材并建一期；分别完成脚本、选图和视频审核。
- 核对实际成片访问、时长／尺寸／帧率及画面 AI 标识；预期 1080×1920、30 fps、约 30 秒，不能先填“实测通过”。
- 选定测试作品完成一次局部返工与重新合成，比较其他已审核产物。

本次结论：技能文档、发现链接、静态与行为推演检查已交付；真实端到端生产未验收，不能宣称可在线完整出片。

## GitHub 发布前复核

重新运行原源码基线的类型检查和 make test，仍为 401 Bun、10 Python 通过。暂存快照 9 个文件的相对链接闭合、JSON 示例、技能元数据、符号链接和凭据模式检查通过。远端 main 3c34ceb 与本地分叉，发布在远端基础的隔离分支只整合这 9 个文件，不发布其他本地变更。远端新版流程不属于首版旧部署契约，入口与参考已明确限制；这里的原基线测试不能宣称远端新版业务全量回归通过。
