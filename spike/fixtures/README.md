# 审片台演示数据（#31）

四个期 JSON，覆盖审片台的四种视图；配套一个目的地、一个模板、一个角色。
`spike/` 是一次性验证材料，不 lint 不测。

| 文件 | 期状态 | 看什么 |
| --- | --- | --- |
| `episode-script-review.json` | `script_review` | 审核 1：26 镜、改字段、上移/下移、删镜 |
| `episode-kf-review.json` | `kf_review` | 审核 2：每镜 3 张候选、2 镜已选、1 镜已标记重生成、2 张网格策划稿 |
| `episode-clip-review.json` | `clip_review` | 审核 3：每镜有片段、前 3 镜已通过、第 5 镜报过坏镜 |
| `episode-done.json` | `done` | 成片页：成本报告（每镜 image+video 的 model 记录）、重新合成 |

## 装载

```bash
bun run packages/cli/src/index.ts create-user demo demo123   # 已有账号可跳过
bun run spike/fixtures/load.ts demo
```

脚本把 JSON 里占位的 `owner_id: "u_demo"` / `persona_id: "c_demo"` 换成这个账号的
真实 id 再写库——`packages/cli` 的 `import-episode` 按 JSON 里写死的 owner_id 导入，
那个 id 在网页里登录后是看不到的（§8 行级 owner_id 过滤）。想走 CLI 的话自己把两个
占位 id 替换掉即可，期 JSON 本身是 `validateEpisode` + FR-02 都过得了的。

重跑前先删掉上次的期：SQLite 主键冲突会直接报错。

## 产物文件不存在是正常的

`kf/*.png`、`clip/*.mp4`、`grid/*.png` 这些文件并没有生成——真实图像/视频模型
（#26/#27）不在 #31 范围内。审片台对加载失败的图片和视频显示"文件未生成"占位，
这跟真实环境里"还在生成中"的状态是同一套 UI，不是错误态。想看真图的话，往
`projects/<episode_id>/kf/01_a.png` 放任意一张图即可（地标实景图放
`projects/dest/lingshan/buddha_01.jpg`，角色参考图放 `projects/persona/c_demo/front.png`）。
