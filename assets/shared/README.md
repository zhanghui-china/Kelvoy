# Kelvoy 共用合成素材

`music/*.mp3` 是由 `scripts/generate-demo-music.py` 以程序合成的原创演示配乐，不使用第三方录音或采样。曲目名称与 `MUSIC_CATALOG` 对应。`lut/warm_film.cube` 为项目原创 LUT。`intro/` 与 `outro/` 是原创纯色转场片段，默认关闭，可在合成设置中选择。

执行 `bun packages/cli/src/index.ts seed-catalog` 时会复制这些文件到 `KELVOY_PROJECTS_ROOT`，同时导入六个官方模板。旧版官方角色的 `warm_natural` 样式映射到此 LUT。
