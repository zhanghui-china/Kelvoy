# scripts/

- `render-text-overlays.py`：Worker 在 ffmpeg 缺少 ASS/drawtext 时调用的字幕图层回退；使用 `services/inference/.venv/bin/python` 中锁定的 Pillow，先运行 `make install`，并提供可用的中文字体。
- `generate-demo-music.py`：本地演示曲库辅助脚本。
- `benchmark-episode-list.ts`：生成 10/100/1000 期、每期 30 镜的内存 SQLite 列表基线；输出读取中位数、JSON 字节、heap 和查询计划，不调用模型或改生产数据。
- `benchmark-task-queue.ts`：生成 1000/10000/100000 条历史任务测领取查询；设 `BENCH_TASK_INDEX=0` 可在相同代码上移除领取索引，复核修复前基线。
