# H3 改写修复与 LLM 型号回退（2026-10-11）

由 GX10 上一期作品 `e_6d9f8b2c…`（7 镜，3 成功、4 失败）的排查引出：型号回退、参考图标签规范化、LLM 超时可配置。无数据库迁移，无前端改动，素材未备份也未触碰。

## 一、那期 7 镜的失败原因

4 个失败镜头全部死在"视频提示词改写"这一步（生成视频之前），用的是 `step-3.5-flash`：

| 镜头 | 结果 | 原因 |
| --- | --- | --- |
| 1、3、7 | 成功 | 改写 33–39 秒 |
| 2 | 失败 | 规则 `all supplied pictures must be referenced` |
| 4 | 失败 | 改写 60 秒超时，重试后再超时 |
| 5 | 失败 | 先超时，重试后触发 `subject role does not match supplied reference` |
| 6 | 失败 | `subject role does not match supplied reference` |

9 次调用：3 次成功、3 次超时、3 次规则失败。

## 二、重放与型号对照（GX10，真实代码路径，生产库只读，临时项目目录）

用这些镜头已存的上下文，经 `createH3PromptWriter` 重放，抓取模型原始输出：

| | step-3.5-flash | step-5-preview |
| --- | --- | --- |
| 调用数 | 11 | 14 |
| 成功 | 6（55%） | 1（7%） |
| 60 秒超时 | 1（9%） | 7（50%） |
| 校验规则失败 | 4 | 6 |

样本小且是之前失败过的难例，所以绝对成功率偏低，但两个型号用的是同一批镜头。重放中的规则失败形态：

| 规则 | 次数 | 结论 |
| --- | --- | --- |
| `all supplied pictures must be referenced` | 5（两个型号都有） | 已确认：模型把 `<Picture 1>` 写成不带尖括号的 `Picture 1` |
| `invalid visible retention syntax` | 2（flash） | 已做过一次格式纠正，纠正后仍错 |
| `preserve shot size and camera` | 1（flash） | 镜头 `detail`＋`push`，模型没写出要求的关键词 |
| `dialogue and text are not requested` | 2（step-5） | 触发词未抓到，推测与否定句清理的词表有关，**未确认** |
| `subject role does not match` | 线上 2 次，重放 0 次 | 此前"词表过窄"的推断**未被复现**，不应据此改动 |

## 三、变更

1. **型号回退**：两个节点 `STEPFUN_MODEL` 回到 `step-3.5-flash`（用 [`set-worker-env.py`](set-worker-env.py)，先排空再重启 Worker）。

   | 节点 | 备份（UTC） |
   | --- | --- |
   | GX10 | `/home/huntun/.config/kelvoy/worker.env.before-20261011T062726Z` |
   | Spark | `/home/Developer/.config/kelvoy/worker.env.before-20261011T062733Z` |

2. **参考图标签规范化**（`5bf1727`）：校验前把序号属于本次参考图、缺尖括号的 `Picture N` 机械改写为 `<Picture N>`；未提供的序号不动，所有语义规则不放宽。改动个数只出现在 trace 回调的 entry 里，没有持久化（store 没有对应列）。
3. **LLM 超时可配置**（`be9a28d`）：`KELVOY_LLM_TIMEOUT_SECONDS`，默认 120，整数 30–300，非法值抛错，Worker 启动即校验；脚本生成、分镜建议、H3 改写共用；诊断的 `budget_seconds` 反映真实值。它是**单个 HTTP 请求**的预算，纠正一轮会再发一次请求，本地重试最多两次。任务租约 90 秒、每 30 秒心跳续约，与请求时长无关。

## 四、发布

| 节点 | 发布目录 | 源码 | 数据库备份（UTC） | 切换 |
| --- | --- | --- | --- | --- |
| Spark | `~/kelvoy-releases/h3-fixes-20261011-549ed2b` | `549ed2b` | `/home/Developer/kelvoy-backups/pre-h3-fixes-20261011-20261011T063901Z` | 06:39 |
| GX10 | `~/kelvoy-releases/h3-fixes-20261011-549ed2b` | `549ed2b` | `/home/huntun/kelvoy-backups/pre-h3-fixes-20261011-20261011T064056Z` | 06:40 |

变更包 20 个代码文件（约 38KB），沿用"`cp -a` 当前发布目录＋覆盖"；无前端改动，`dist_stamp verify` 通过；闸门为严格相等（无新表）。节点上类型检查通过，engine／store／worker／web 1089 项测试 0 失败（1 项平台条件跳过），基础设施 Python 测试通过。切换后两节点服务 active、重启 0、健康检查 `ok`、近 3 分钟日志无错误，worker 环境为 `STEPFUN_MODEL=step-3.5-flash`。drop-in 新文件名自动比现有多一个前导 `z`（`zzzzzzzzzzzz-h3-fixes-20261011.conf`），排序正确。

## 五、未验证与待跟进

- 标签规范化与 120 秒超时是在重放数据的基础上做的推断性修复，**还没有被线上真实生成验证**。下次真实生成后应只读核对：`all supplied pictures must be referenced` 是否消失、超时占比、`prompt_traces` 里 `outcome`／`rule` 的分布。
- 仍然会失败的类别没有处理：纠正后仍错的 `invalid visible retention syntax`、`preserve shot size and camera`，以及疑似与否定句词表有关的 `dialogue and text are not requested`。建议拿到原文后再改，或评估是否允许一次定向纠正重试。
- 失败路径不保存模型响应（ADR-0012），诊断这类问题只能靠重放。
- ADR-0011 仍写"LLM 单次上限 60 秒"，未同步。
- 本次的型号结论来自单日小样本，不代表 `step-5-preview` 在其它负载下的表现。

## 回退

在对应节点删除 `kelvoy-{web,worker}.service.d/zzzzzzzzzzzz-h3-fixes-20261011.conf`，`daemon-reload` 后重启 Web／Worker，回到上一版（Spark 为 `prompt-traces-20261011-573aa90`，GX10 为 `prompt-traces-20261011-6946b27`）。不恢复数据库。
