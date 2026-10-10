# GX10 官方 Qwen 图片提示词增强（2026-10-10）

本轮使用 `Qwen/Qwen-Image-2.1-PE-I2I` 的 `edit` 模式。代码及权重适用 **Qwen Research License Agreement，仅限非商业研究／评估**；商业使用须获得权利人授权。本轮独立模型安装、临时作品验收属于研究／评估，不因此启用商业生产服务。确切许可、署名及上游版本在 `services/inference/src/inference/vendor/qwen_pe/`。

## 隔离与固定来源

- 官方代码提交 `1993c3a4821f977df0b6dd2661ff5b40239aa55a`；模型 revision `72927bc08afc99b7888ceb7d7d51a12db3700bbd`。系统提示词、预处理与解析来自该固定官方版本。
- 独立目录 `/home1/huntun/kelvoy-qwen-pe`，独立 `.venv`，用户级 `kelvoy-qwen-pe.service`，仅监听 `127.0.0.1:8110`。不修改共享 ComfyUI、驱动、其他项目环境或既有 Kelvoy 服务。
- 安装前只读检查：aarch64／NVIDIA GB10，驱动 580.126.09，CUDA 13.0；`/home1` 可用 172 GB，系统可用内存 109 GiB，GPU 利用率 0%；8110 空闲。共享 ComfyUI 8188 与 Kelvoy Inference 8100 正常运行。
- PyPI 提供 vLLM 0.19.1 的 aarch64 wheel。官方 README 所列 `vllm==0.19.1 + transformers==5.4.0` 在实际包元数据中不可解：vLLM 明确排除 Transformers 5.4。先尝试隔离安装 `vllm==0.19.1, transformers==5.5.1`，运行时兼容性仍须健康检查及真实小量改写确认，不能凭 wheel 存在宣称可用。
- GX10 无法连接 Hugging Face 主站，下载使用 `hf-mirror.com` 作为传输。`qwen-pe-model-artifacts.json` 在本地从官方 Hugging Face API 取得，固定 revision、大小、Git blob／LFS SHA256；下载器逐文件核对且原子写入成功清单。镜像不能自行提供版本或预期散列。许可证 SHA256 为 `8dc973f024ff95966bea25866efa443fd16776dcb1001e681e3d467ea572b28d`。

## 安装及运行

只在已确认容量、端口及共享 GPU 空闲后执行；安装目录与下载元数据一起复制。安装命令使用该用户已有 uv，不更新其自身。

```bash
QWEN_ROOT=/home1/huntun/kelvoy-qwen-pe
mkdir -p "$QWEN_ROOT"
/home/huntun/.local/bin/uv venv --python python3 "$QWEN_ROOT/.venv"
UV_CACHE_DIR="$QWEN_ROOT/uv-cache" /home/huntun/.local/bin/uv pip install \
  --python "$QWEN_ROOT/.venv/bin/python" vllm==0.19.1 transformers==5.5.1
python3 "$QWEN_ROOT/download-qwen-pe.py" --root "$QWEN_ROOT/model" \
  --endpoint https://hf-mirror.com
```

`serve-qwen-pe.sh` 要求完整成功的 `ARTIFACTS.json`，运行环境 `HF_HUB_OFFLINE=1`／`TRANSFORMERS_OFFLINE=1`，不下载代码或权重。并发 1，最多两张参考图，上下文 32768，支持官方 24000 输出 token 与 thinking；明确固定 8 GiB KV cache。用户服务 `MemoryHigh=44G, MemoryMax=48G`，`KillMode=control-group`，停止时最多等待 30 秒。所有请求仍受 Inference 的 900 秒总超时和断开取消约束。

将服务文件安装到用户 `~/.config/systemd/user/kelvoy-qwen-pe.service`，`systemctl --user daemon-reload` 后启动。健康与有限真实改写验收通过前不设置开机启用，也不切换既有应用。在新 runtime 中保存 `uv pip freeze`、wheel／CUDA 兼容性、模型清单及服务日志；不持久化模型 thinking。

如果 vLLM 不能运行，使用官方 Transformers 路径的独立兼容接口；每次请求由可终止子进程执行，断开必须停止 GPU 工作，不能用无法取消的后台线程。两条路径均不可用则保留旧部署，不启用新链路。

## 验收与回退

使用 `verify-qwen-prompt.ts`，真实改写最多三次；复制目录中的人物／场景参考图到临时作品。图片生成接口完全模拟，验证首次、修改原稿、修改参考图散列、缓存重试、最终 prompt 与记录一致和业务退款。验收后清理临时业务数据；不得重新生成原黄山作品或修改原 7 人运维白名单。该验收不证明真实出图质量。

独立服务回退：`systemctl --user stop kelvoy-qwen-pe.service`，禁用其开机启动即可；保留权重及日志供复核。应用发布须另行按既有备份、空队列和自动回退程序实施，不能因为新模型可用就先行切换生产 Worker／Inference。

## 执行状态

2026-10-10 本轮已通过只读 preflight，建立独立环境并开始固定版本依赖和四张分片下载。模型运行健康检查、实际小量改写及应用切换尚未完成；最终执行证据在完成后补充。
