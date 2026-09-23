# infra/

按 ADR-0004:MVP 不用云端基础设施(除了 LLM 调用),没有需要本地起容器的东西——数据是本地 SQLite(`packages/store` 管),产物文件是本地磁盘目录,任务队列也是 SQLite 里的一张表。不需要 `docker-compose.local.yml` 了。

- **本地**(DGX):容器编排、模型权重管理。见 `dgx/README.md`。web/worker/推理暂时都在同一台机器,设计上留了 `packages/store` 这层边界,以后要把生图/生视频/ffmpeg 拆到不同 DGX 时,只用换这一层的实现。
