# MiniMax-H3 Spark GB10 参考图数量梯度与 4090 对比报告

日期：2026-09-29  
模型：MiniMax-H3 ref2va int8  
平台：Spark GB10 128GB unified memory / RTX 4090 24GB

---

## 1. 执行摘要

本轮在 Spark GB10 上完成了 MiniMax-H3 ref2va 的两类性能基准：

1. **参考图数量梯度**
   - 0.4MP
   - 5 秒
   - 1–9 张参考图
   - 4 steps
2. **分辨率梯度**
   - 3 张参考图
   - 14 秒
   - 0.4 / 0.5 / 0.6 / 0.7MP
   - 4 steps

结果：

```text
13 / 13 成功
0 失败
无 OOM
无 ComfyUI 崩溃
无 NVIDIA 驱动复位
```

核心结论：

1. **Spark GB10 的 H3 耗时随参考图数量呈高度线性增长。**
2. **0.4MP / 5s 条件下，1→9 图耗时从 68.086s 增至 108.258s。**
3. **每增加 1 张参考图，端到端约增加 5.27s。**
4. **耗时增长主要来自 pre-KSampler 的 TE / reference latent 处理。**
5. **14s / 3图 / 0.4–0.7MP 条件下，Spark 约为 4090 的 2 倍耗时。**
6. **但 Spark 128GB 统一内存可稳定覆盖更高参考图数量和高分辨率，不出现 24GB 独立显存常见的 cache 换页拐点。**

---

## 2. 测试环境

### 2.1 Spark

```text
主机: gx10-8e22
系统: Linux aarch64
GPU: NVIDIA GB10
统一内存: 128GB
ComfyUI: 0.37.0
Python: 3.12.13
PyTorch: 2.12.1+cu130
ComfyUI API: http://192.168.199.107:8188
```

### 2.2 4090 对照

```text
GPU: NVIDIA GeForce RTX 4090
VRAM: 24564 MB
ComfyUI: 0.37.0
Python: 3.13.14 embedded
PyTorch: 2.13.0+cu130
```

### 2.3 模型

```text
Diffusion Model:
minimax_h3_ref2va_pruned_int8_convrot.safetensors

Text Encoder:
qwen3vl_32b_minimax_h3_int8_convrot.safetensors

Video VAE:
minimax_h3_video_vae_int8_convrot.safetensors

Audio VAE:
minimax_h3_audio_vae_fp32.safetensors

LoRA:
minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors
```

---

## 3. 测试方法

### 3.1 参考图

使用 9 张固定的确定性彩色图形：

```text
红色圆形
蓝色方形
绿色三角
黄色菱形
橙色五边形
紫色六边形
青色星形
洋红心形
青色圆环
```

对 `n` 张参考图的测试，始终使用前 `n` 张。

### 3.2 固定参数

```text
steps: 4
seed: 20260929
sampler: euler_ancestral
scheduler: linear_quadratic
aspect_ratio: 16:9 (Widescreen)
Qwen reference prompts: 完全一致
```

### 3.3 直连 ComfyUI

Spark 测试直连：

```text
http://192.168.199.107:8188
```

不经过 Flask 6000 桥接层，因此耗时是 ComfyUI 生成本体耗时，不包含 HTTP 桥接包装开销。

### 3.4 Warmup

正式测试前执行了一次不计入结果的热身：

```text
1 ref / 0.2MP / 2s / 1 step
耗时: 8.558s
```

---

## 4. Spark 参考图数量梯度

条件：

```text
分辨率: 0.4MP
时长: 5s
steps: 4
```

| 参考图数 | 端到端 | pre-KSampler | KSampler | post-KSampler | 状态 |
|---:|---:|---:|---:|---:|---|
| 1 | 68.086s | 3.053s | 52.858s | 12.174s | ✅ |
| 2 | 71.115s | 4.377s | 54.918s | 11.820s | ✅ |
| 3 | 74.676s | 5.655s | 57.118s | 11.903s | ✅ |
| 4 | 78.706s | 8.525s | 58.452s | 11.729s | ✅ |
| 5 | 88.701s | 15.128s | 61.782s | 11.790s | ✅ |
| 6 | 92.969s | 17.455s | 63.622s | 11.891s | ✅ |
| 7 | 97.631s | 19.891s | 65.814s | 11.926s | ✅ |
| 8 | 102.876s | 22.731s | 68.303s | 11.842s | ✅ |
| 9 | 108.258s | 25.723s | 70.853s | 11.682s | ✅ |

### 4.1 线性拟合

端到端：

```text
耗时 ≈ 5.269 × ref_count + 60.657
R² = 0.988
RMSE = 1.507s
```

pre-KSampler：

```text
耗时 ≈ 3.052 × ref_count - 1.647
R² = 0.977
```

KSampler：

```text
耗时 ≈ 2.245 × ref_count + 50.300
R² = 0.997
```

post-KSampler：

```text
约 11.7–12.2s，基本不随参考图数量变化
```

### 4.2 增长分析

1→9 图：

```text
端到端: 68.086s → 108.258s
增加: 40.172s
增幅: 59.0%
```

按阶段拆分：

| 阶段 | 1图 | 9图 | 增量 | 说明 |
|---|---:|---:|---:|---|
| pre-KSampler | 3.053s | 25.723s | +22.670s | 主要增长来源 |
| KSampler | 52.858s | 70.853s | +17.995s | 线性但斜率较小 |
| post-KSampler | 12.174s | 11.682s | -0.492s | 基本稳定 |

结论：

```text
参考图 TE 推理
参考图 VAE encode
reference latent 构建
```

是 H3 多参考图的主要额外成本。

---

## 5. Spark 分辨率梯度

条件：

```text
参考图: 3张
时长: 14s
steps: 4
```

| 分辨率 | 端到端 | pre-KSampler | KSampler | post-KSampler | 状态 |
|---:|---:|---:|---:|---:|---|
| 0.4MP | 209.420s | 6.155s | 169.612s | 33.653s | ✅ |
| 0.5MP | 257.475s | 5.860s | 218.356s | 33.259s | ✅ |
| 0.6MP | 323.131s | 6.020s | 277.666s | 39.445s | ✅ |
| 0.7MP | 369.128s | 6.672s | 322.817s | 39.639s | ✅ |

分析：

```text
0.4MP → 0.7MP
端到端: 209.420s → 369.128s
增加: 159.708s
增幅: 76.3%

每增加 0.1MP 平均增加约 53.2s
```

pre-KSampler 基本不变，说明参考图编码成本主要由参考图数量决定，而不是目标分辨率。

KSampler 变化：

```text
169.612s → 322.817s
增加: 153.205s
增幅: 90.3%
```

因此分辨率提升的主要成本在扩散采样与视频解码。

---

## 6. Spark 时长线性验证

同条件下对比：

```text
0.4MP / 3 refs / 5s:   74.676s
0.4MP / 3 refs / 14s: 209.420s
```

耗时比例：

```text
209.420 / 74.676 = 2.80
```

帧数比例：

```text
5s:   124帧
14s:  345帧

345 / 124 = 2.78
```

结论：

```text
H3 在 Spark GB10 上的耗时基本与帧数线性相关。
```

---

## 7. Spark vs RTX 4090

### 7.1 同口径测试

条件：

```text
3张参考图
14秒
4 steps
SageAttention 开启
```

| 分辨率 | 4090 | Spark GB10 | Spark / 4090 |
|---:|---:|---:|---:|
| 0.4MP | 104.810s | 209.420s | 2.00× |
| 0.5MP | 119.300s | 257.475s | 2.16× |
| 0.6MP | 152.600s | 323.131s | 2.12× |
| 0.7MP | 186.870s | 369.128s | 1.98× |

结论：

```text
在相同 H3 ref2va / 3参考图 / 14s 配置下，
Spark GB10 的端到端耗时约为 RTX 4090 的 2 倍。
```

### 7.2 分辨率趋势对比

| 分辨率变化 | 4090 增幅 | Spark 增幅 |
|---|---:|---:|
| 0.4 → 0.5MP | +13.8% | +22.9% |
| 0.5 → 0.6MP | +27.9% | +25.5% |
| 0.6 → 0.7MP | +22.5% | +14.2% |
| 0.4 → 0.7MP | +78.1% | +76.3% |

整体趋势接近：

```text
4090: 0.4→0.7MP 增加约 78%
Spark: 0.4→0.7MP 增加约 76%
```

说明两者都主要受视频 latent 数量和扩散计算量影响；Spark 的绝对算力较低，但扩展趋势相近。

---

## 8. 能力对比

| 能力 | RTX 4090 24GB | Spark GB10 128GB |
|---|---|---|
| H3 ref2va 可运行 | ✅ | ✅ |
| 1–9 参考图 | ✅ 已验证 | ✅ 已验证 |
| 0.4–0.7MP / 14s | ✅ 已验证 | ✅ 已验证 |
| 稳定性 | 4090 单卡稳定 | 13/13 成功 |
| 3图 / 14s 速度 | 更快 | 约为 4090 2倍耗时 |
| 显存/内存策略 | 24GB 独立显存 + DynamicVRAM | 128GB 统一内存 |
| 多参考图曲线 | 会出现 cache 策略相关拐点 | 高度线性 |
| 适合定位 | 低延迟 H3 生产 | 高稳定性、高参考图数量、高内存容量任务 |

---

## 9. 机制分析

### 9.1 为什么 Spark 更慢？

GB10 是统一内存架构，虽然内存容量大，但推理吞吐不如 RTX 4090 的独立显存与高带宽 GPU 计算。

同条件下：

```text
4090 0.7MP / 3图 / 14s: 186.870s
Spark 0.7MP / 3图 / 14s: 369.128s
```

因此 H3 生产中如果追求单任务速度，4090 仍更合适。

### 9.2 为什么 Spark 曲线更平滑？

Spark GB10 有 128GB 统一内存，不需要在 GPU 显存与系统内存之间进行激进换页。

参考图增加时，以下状态可以留在同一统一地址空间：

```text
reference vision tokens
reference latents
prefix cache
模型权重
中间激活
```

因此 Spark 的耗时增长来自真实计算，而不是 cache 搬运。

### 9.3 为什么 4090 更适合交互式任务？

4090 在相同 H3 配置下速度约为 Spark 的 2 倍，适合：

```text
交互式生成
少参考图快速预览
低延迟生产
```

Spark 更适合：

```text
高参考图数量
高内存容量需求
批量后台生成
需要避免显存换页的任务
```

---

## 10. 调度建议

### 10.1 交互式 H3

推荐：

```text
RTX 4090
```

典型：

```text
1–3图
0.4–0.6MP
5–14s
```

### 10.2 多参考图 H3

可选：

```text
Spark GB10
```
 
适合：

```text
5–9图
高稳定性需求
内存压力较高任务
```

不过如果追求速度，4090 仍更快。

### 10.3 高分辨率 H3

```text
0.6–0.7MP / 14s
```

建议优先：

```text
RTX 4090
```

Spark 可跑，但耗时约 2 倍。

---

## 11. 输出与原始数据

### 11.1 Spark 原始结果

```text
F:\ComfyUI\h3_refscale_spark_results.csv
F:\ComfyUI\h3_refscale_spark_results.jsonl
```

### 11.2 Spark 基准脚本

```text
F:\ComfyUI\benchmark_h3_refscale_spark.py
```

### 11.3 Spark / 4090 合并数据

```text
F:\ComfyUI\h3_refscale_spark_vs_4090.csv
```

### 11.4 图表

```text
F:\ComfyUI\ComfyUI\output\h3_refscale_spark_vs_4090_chart.png
```

### 11.5 Spark 输出目录

```text
/home1/wuzi/ComfyUI/output/h3_refscale_spark/
```

---

## 12. 局限性

1. 每组只执行一次，没有多次重复取平均。
2. 参考图是简单合成图形；真实复杂图像可能增加 TE / VAE 处理时间。
3. Spark 参考图数量梯度使用 5s，分辨率梯度使用 14s；两组均已说明，不能直接混表比较。
4. 4090 对照数据来自此前同口径 H3 测试。
5. 本轮重点是速度与扩展性，没有重新做视频质量评分。

---

## 13. 最终结论

### Spark GB10

```text
可稳定支持 H3 ref2va 1–9 参考图。
可稳定支持 0.4–0.7MP / 14s / 3参考图。
耗时随参考图数量高度线性增长。
0.4MP / 5s 条件下每增加 1图约 +5.27s。
```

### RTX 4090

```text
同口径 3图 / 14s 任务约比 Spark 快 1 倍。
更适合低延迟 H3 生产。
```

### 推荐分工

```text
4090:
交互式 H3
高分辨率 H3
追求单任务速度的任务

Spark GB10:
1–9参考图稳定性验证
高内存压力任务
后台批处理
```
