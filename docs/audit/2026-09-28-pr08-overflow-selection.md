# PR08 国内 API 溢出选型待决事项

本记录只核对公开接口与当前代码，不代表已选择供应商、开通计费或完成真实溢出。PR07 已验证本地双参考单镜；PR08 Draft #54 只实现跨 lease 产物恢复和 Worker 关停。当前 `jimeng-api.ts`、`kling-api.ts`、`overflow.ts` 仍是抛出 `not implemented` 的骨架。

## 需要满足的现行产品契约

- 新期默认 `video_source=references`：每镜按人物参考图、真实场景参考图的顺序提交，生成 3–5 秒视频，支持 9:16 与 16:9；传统路线还需角色与地标参考的关键帧。
- PRD v0.2 §7 要求本地失败重试后或排队超过 30 分钟时才溢出，单镜失败可追溯 provider、模型、版本、seed、prompt、参考图哈希、时长和费用；整期全走 API 的费用目标 ≤ ¥20。
- 现有 consumer 的 `MAX_LOCAL_ATTEMPTS=2` 表示初次执行加一次重试。PRD 的“本地失败先重试，≤2 次”可能指最多两次重试，正式接入前须统一口径。
- 当前 `ShotModelRecord.cost_usd` 无人民币原始金额与汇率日期。不能把人民币报价直接写入美元字段，也不能用估算价冒充真实账单。

## 公开接口核对（2026-09-28）

| 方案 | 与双参考直出/时长的关系 | 未完成的验证 |
| --- | --- | --- |
| 即梦视频 3.0 首尾帧 | 官方文档的两张图是**首帧与尾帧**，不是“人物图＋场景图”两个独立参考；列出的时长为 5 或 10 秒。直接映射会改变输入语义，不能作为现有直出协议的无损替换。[接口文档](https://www.volcengine.com/docs/85621/1791184?lang=zh) | 需确定是否有另一款即梦多参考视频 API，并验证场景/角色保持、费用、输出画幅。 |
| 火山方舟 Seedance 2.0 | 官方 API 示例使用多个 `reference_image`；模型列表提供参考生视频和 9:16/16:9，视频时长下限为 4 秒，可覆盖现行 4–5 秒镜头，但不覆盖 3 秒请求。[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)、[参考图示例](https://docs.volcengine.com/docs/ark/seedance-portrait-asset-guide?lang=zh)、[时长参数](https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01) | 必须实测人物与地标双参考的身份/地标保真、最小可用片长、取消、幂等、真实 token 用量及肖像素材限制。 |
| 可灵 3.0 | 官方图生视频 API 支持首帧和最多三个预建 Element；人物图/场景图不能直接作为两个独立图片参数原样传入，可能需先建 Element。官方多图生图另有主体图与场景图字段，但不是视频接口。[图生视频 API](https://kling.ai/document-api/apiReference/model/imageToVideo)、[多图生图 API](https://kling.ai/document-api/apiReference/model/multiImageToImage) | 需确认 Element 创建与复用、真实场景保持、时长/画幅、费用及账户权限，之后才能设计适配器。 |

火山方舟当前价格说明指出 Seedance 2.0 mini 在限定促销条件下，720P 视频最低约 ¥0.2/秒，费用按实际返回的 `usage.completion_tokens` 核算；优惠资格与结束时间也有限制。按这个**最低示例价**估算，30 镜 × 4 秒 = 约 ¥24，仅视频就超过 PRD 的“整期全走 API ≤ ¥20”，还未计重生成或关键帧。该估算不是账单，也不能据此确定最终单价。[价格说明](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)、[促销条件](https://docs.volcengine.com/docs/ark/seedance-2-0-mini-fast-limited-time-discount?lang=zh)

## 接入前的决定与验收

1. 确定视频与关键帧各自的正式供应商、具体模型/API 版本、可使用的账户和是否接受“3 秒请求在备用模型生成 4–5 秒”的转换。
2. 明确人民币费用字段、汇率/美元兼容策略、预算拦截与超额处理；以真实 API 返回用量核对整期费用，不能用宣传最低价定成本。
3. 在独立测试目录用同一人物和地标参考做竖屏、横屏单镜；核对格式、完整解码、参考保真、耗时、失败/取消和实际费用，再接队列与自动溢出。
4. 补队列等待时间和本地失败次数的可测试决策、任务层 provider 选择及调用记录，保持 lease 栅栏、已通过镜头和积分事务不变；用故障注入验证 API 失败会让目标镜头进入可重试的失败状态。

供应商与计费口径未确定前，PR08 不把现有抛错适配器称为真实溢出，也不自动触发付费 API。
