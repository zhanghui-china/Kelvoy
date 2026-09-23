# dgx-bridge

独立的桥接微服务，负责把 Kelvoy 后端和 DGX Spark 上的 GPU/模型计算对接起来。

与主仓库(`src/kelvoy/`)完全解耦：自己的 `pyproject.toml`、自己的虚拟环境，单独部署、单独跑测试。

**当前状态**：只是一个占位服务，只暴露 `/health`。和 DGX Spark 具体怎么通信(REST？gRPC？共享文件系统？)还没有定，等协议定下来再往这里加真实逻辑。

## 本地跑

```bash
cd dgx-bridge
uv sync
uv run python dgx_bridge_service.py
uv run pytest
```
