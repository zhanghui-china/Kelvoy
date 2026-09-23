# infra/dgx/

PRD v0.2 的"两台 DGX Spark"确认成立,但**不是两台对等独立的机器**:一台(下面这台,`gx10-8e22`)和 visionary、shanhai 共用;另一台是 Kelvoy 专属,连接信息还没有,待补充。§9"一台宕机容量减半但不停服"这条要按这个不对等的情况重新想——共享那台平时就要和别的项目抢 GPU,不是"两台对等、坏一台各分担一半"那么简单。

## 硬件与现状(2026-09-23 实地侦察,只读,共享的这台)

- 主机名 `gx10-8e22`,Tailscale IP `100.80.224.95`。SSH:`ssh -i ~/.ssh/visionary_dgx huntun@100.80.224.95`(与 visionary 项目共用账号/密钥,经确认有权限使用)。
- GPU:NVIDIA GB10,驱动 580.126.09,CUDA 13.0。内核 `6.17.0-1008-nvidia`,aarch64。
- 内存:119GB,当前可用 ~106GB。
- **磁盘:916GB,已用 829GB(96%),只剩 ~40GB。装模型权重前必须先清理或扩容,不然连一个视频模型 checkpoint 都下不下来。** `huntun` 账号下可见的大头:`shanhai` 74G、`models` 21G、`anaconda3` 8G、`visionary` 2.5G;剩下约 700GB 在其他用户目录 / 系统路径下,当前账号权限看不到,未深挖。
- 至少 5 个系统账号(huntun / hermes / zhangxiaobai / zhanghui / admin)——**这台机器同时被 visionary 和 shanhai 两个项目占用**,GPU 无自动化调度,纯人工协调排期。
- 工具链已装好,不用重装:`uv 0.12.5`、`bun 1.4.0`、`python 3.12.3`、`git 2.43.0`、`docker`。

## 端口(已占用,Kelvoy 部署时要避开)

| 端口 | 占用者 |
| --- | --- |
| 8000 | visionary-backend(FastAPI/uvicorn) |
| 5000 | shanhai-web |
| 5099 | comfyui-bridge |
| 8188 | ComfyUI |
| 6379 | 系统级 Redis(apt 装的,`redis` 系统用户跑的,不确定能否借用,需和机器归属方确认) |
| 11434 | 疑似 Ollama 默认端口(未验证,若属实 Kelvoy 的 LLM 环节或许能直接复用,留给 M0-4 细查) |

**Kelvoy 侧已改**:`services/inference` 默认端口从 8000 改成 **8100**,避免和 visionary-backend 撞车(见 `services/inference/src/inference/config.py`)。

## 部署模式(参考 visionary,不是照搬)

visionary 用 systemd `--user` 服务 + `Linger=yes`,不需要 sudo——这个模式适合共享、无 root 权限的账号,Kelvoy 可以照搬。但 visionary 的人工运维通道是"入站"(后端绑 `0.0.0.0:8000`,人从 Tailscale 直接连进来),**这和 Kelvoy PRD v0.2 §9 的"worker 只出站连接"硬约束是两码事**——那条约束管的是生产流量(worker 拉队列),人工 SSH/运维访问走 Tailscale 入站不违反它。对外公网暴露如果需要,visionary 用的 Cloudflare Tunnel(DGX 主动建出站隧道)这部分可以直接抄。

容器编排(裸 Docker / systemd / 别的)、模型权重具体怎么管理,还没定,等 M0-4 选完模型再定。

## 待确认(不是我能替你定的)

- [ ] Kelvoy 专属那台 DGX 的连接信息(IP/主机名、账号、密钥)——目前完全没有,拿到后补一节到这份文档。
- [ ] 40GB 可用空间怎么解决:清理旧数据,还是扩容/换盘?(共享的这台)
- [ ] 6379 的 Redis 能不能给 Kelvoy 用,还是要自己起一个换端口。(共享的这台)
- [ ] 11434 是不是 Ollama,能不能复用。(共享的这台)
- [ ] PRD v0.2 §8/§9 里"两台对等、坏一台容量减半"的措辞要不要改成"一台专属 + 一台共享(可用容量不稳定)"——等拿到专属那台的实测数据再一起改,现在先不动 PRD 正文。
