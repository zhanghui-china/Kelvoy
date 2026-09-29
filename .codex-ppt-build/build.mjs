import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const { SKILL_DIR, TMP_DIR, WORKSPACE_DIR, FINAL_PPTX } = process.env;
for (const [name, value] of Object.entries({ SKILL_DIR, TMP_DIR, WORKSPACE_DIR, FINAL_PPTX })) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`Set absolute ${name}`);
}
const { resolvePresentationFont, applyPresentationChartFont } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href
);

const FONT = "Microsoft YaHei";
const family = resolvePresentationFont({ fontFamily: FONT });

// Kelvoy product visual base (PRD v0.2 §17)
const C = {
  bg: "#F3F7FC",
  panel: "#FFFFFF",
  soft: "#EDF3FB",
  accent: "#2563FF",
  accentDark: "#1B44C8",
  accentSoft: "#DFE9FF",
  ink: "#17233B",
  sub: "#57697F",
  border: "#D8E3F0",
  green: "#0E9668",
};

const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const W = 1280, H = 720, MX = 64;
const allSlides = [];

async function img(rel) {
  return new Uint8Array(await fs.readFile(path.join(WORKSPACE_DIR, rel)));
}

function newSlide(bg = C.bg) {
  const slide = presentation.slides.add();
  allSlides.push(slide);
  slide.background.fill = bg;
  return slide;
}

function shape(slide, geometry, position, fill, line) {
  return slide.shapes.add({
    geometry,
    position,
    fill: fill ?? "none",
    line: line ?? { fill: "none", width: 0 },
  });
}

function text(slide, position, value, style = {}) {
  const tb = shape(slide, "textbox", position);
  tb.text = value;
  tb.text.style = {
    typeface: family,
    fontSize: style.size ?? 16,
    bold: style.bold ?? false,
    color: style.color ?? C.ink,
    alignment: style.align ?? "left",
    autoFit: "none",
  };
  return tb;
}

function bullets(slide, position, lines, style = {}) {
  const tb = shape(slide, "textbox", position);
  tb.text = lines.map((line) => ({
    bulletCharacter: "•",
    marginLeft: 15 * 12700,
    indent: -9 * 12700,
    spaceAfter: (style.gap ?? 7) * 100,
    runs: Array.isArray(line) ? line : [line],
  }));
  tb.text.style = {
    typeface: family,
    fontSize: style.size ?? 15,
    color: style.color ?? C.sub,
    alignment: "left",
    autoFit: "none",
  };
  return tb;
}

function header(slide, kicker, title, pageNo) {
  text(slide, { left: MX, top: 42, width: 1000, height: 24 }, kicker, {
    size: 13, bold: true, color: C.accent,
  });
  text(slide, { left: MX, top: 68, width: 1050, height: 44 }, title, {
    size: 30, bold: true,
  });
  text(slide, { left: W - MX - 60, top: 46, width: 60, height: 20 }, String(pageNo).padStart(2, "0"), {
    size: 12, color: "#8CA0B5", align: "right",
  });
}

function card(slide, position, fill = C.panel, line = { fill: C.border, width: 1 }) {
  return shape(slide, "roundRect", position, fill, line);
}

function chip(slide, position, label, opts = {}) {
  const box = shape(slide, "roundRect", position, opts.fill ?? C.accentSoft);
  box.text = label;
  box.text.style = {
    typeface: family,
    fontSize: opts.size ?? 12,
    bold: opts.bold ?? true,
    color: opts.color ?? C.accentDark,
    alignment: "center",
    autoFit: "none",
  };
  return box;
}

function arrowRight(slide, position, fill = "#AEC4E8") {
  return shape(slide, "rightArrow", position, fill);
}

function styleTable(table, values, { headerFill = C.accent, zebra = true } = {}) {
  const rows = table.rows.length;
  // table.columns is not populated on a freshly added facade; derive from values.
  const cols = values[0]?.length ?? 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // cells.block().assign() is the only path that emits latin/ea typefaces
      // for table cells; assignments on cell.value / cell.text.style are ignored.
      table.cells.block({ row: r, column: c, rowCount: 1, columnCount: 1 }).assign({
        fill: r === 0 ? headerFill : zebra && r % 2 === 0 ? C.soft : C.panel,
        textStyle: {
          fontFamily: family,
          typeface: family,
          fontSize: 14,
          bold: r === 0 || c === 0,
          color: r === 0 ? "#FFFFFF" : c === 0 ? C.ink : C.sub,
          alignment: r === 0 ? "center" : "left",
        },
      });
    }
  }
  table.borders.assign({ style: "solid", fill: C.border, width: 1 });
}

/* ============ 1 · 封面 ============ */
{
  const slide = newSlide();
  slide.images.add({
    blob: await img("apps/web/public/images/kelvoy-travel-hero.jpg"),
    contentType: "image/jpeg",
    alt: "Kelvoy 旅行场景主视觉",
    fit: "cover",
    position: { left: 0, top: 430, width: W, height: 290 },
  });
  shape(slide, "rect", { left: 0, top: 422, width: W, height: 8 }, C.bg);

  chip(slide, { left: MX, top: 92, width: 300, height: 34 }, "第三届 NVIDIA DGX Spark 黑客松 · DEMO", { size: 13 });
  text(slide, { left: MX, top: 148, width: 700, height: 86 }, "Kelvoy 可旅", { size: 60, bold: true });
  text(slide, { left: MX, top: 240, width: 700, height: 40 }, "AI 旅行 Vlog 生产工作台", { size: 27, color: C.sub });

  const slogan = shape(slide, "roundRect", { left: MX, top: 310, width: 720, height: 66 }, C.panel, { fill: C.border, width: 1 });
  slogan.text = "选一个角色，去一个真实的地方，一期旅行 Vlog 自动生成。";
  slogan.text.style = { typeface: family, fontSize: 19, bold: true, color: C.ink, alignment: "left", autoFit: "none" };

  const metas = ["24–30 镜 · 每镜 1 秒", "9:16 / 16:9", "三个审核点", "本地 DGX Spark"];
  metas.forEach((m, i) => {
    chip(slide, { left: MX + i * 186, top: 396, width: 172, height: 30 }, m, { fill: C.soft, color: C.sub, size: 12.5, bold: false });
  });
  slide.speakerNotes.textFrame.setText("来源：docs/AI旅行Vlog生产工作台_PRD_v0.2.md §1；docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md。");
}

/* ============ 2 · 痛点与机会 ============ */
{
  const slide = newSlide();
  header(slide, "背景", "旅行内容持续生产，卡在三件事", 2);

  const cards = [
    ["真人出镜成本高", "拍摄与档期贵，人设跨期难一致；换一期就换一张脸，账号资产沉淀不下来。"],
    ["通用 AI 工具是黑盒", "一键生成不可控、不可改；通用剪辑器只管剪，不管内容从哪来。"],
    ["文旅与代运营要持续产出", "同一账号、多个目的地、稳定更新——现有工具没有为这个场景设计。"],
  ];
  cards.forEach(([t, d], i) => {
    const x = MX + i * 392;
    card(slide, { left: x, top: 150, width: 368, height: 210 });
    shape(slide, "roundRect", { left: x + 28, top: 178, width: 40, height: 40 }, C.accentSoft);
    const num = shape(slide, "textbox", { left: x + 28, top: 186, width: 40, height: 24 });
    num.text = String(i + 1);
    num.text.style = { typeface: family, fontSize: 20, bold: true, color: C.accent, alignment: "center", autoFit: "none" };
    text(slide, { left: x + 28, top: 236, width: 312, height: 30 }, t, { size: 19, bold: true });
    text(slide, { left: x + 28, top: 274, width: 312, height: 72 }, d, { size: 14.5, color: C.sub });
  });

  card(slide, { left: MX, top: 400, width: 1152, height: 130 }, C.accent, { fill: C.accent, width: 0 });
  text(slide, { left: 104, top: 428, width: 220, height: 30 }, "机会", { size: 20, bold: true, color: "#FFFFFF" });
  text(slide, { left: 104, top: 464, width: 1000, height: 44 },
    "参考片验证了「静帧锁一致性 + 1 秒一镜」可稳定出片；DGX Spark 128GB 统一内存让脚本、图像、视频、合成在单机跑成流水线。",
    { size: 16, color: "#E9F0FF" });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §1「为什么做 / 定位」；项目说明文档 §1.3。");
}

/* ============ 3 · Kelvoy 是什么 ============ */
{
  const slide = newSlide();
  header(slide, "产品定义", "一个角色 + 一个景区，换回一期 30 秒旅行 Vlog", 3);

  card(slide, { left: MX, top: 150, width: 300, height: 240 });
  slide.images.add({
    blob: await img("assets/demo/persona/c_official_aching/front.jpg"),
    contentType: "image/jpeg", alt: "官方角色参考图", fit: "cover",
    position: { left: 88, top: 176, width: 104, height: 126 }, geometry: "roundRect", borderRadius: 8,
  });
  text(slide, { left: 88, top: 150, width: 260, height: 20 }, "输入", { size: 12, bold: true, color: C.accent });
  text(slide, { left: 88, top: 312, width: 240, height: 26 }, "虚拟角色（账号级资产）", { size: 14.5, bold: true });
  text(slide, { left: 88, top: 338, width: 250, height: 44 }, "三视图参考锁定外形，每期可换穿搭", { size: 13, color: C.sub });

  arrowRight(slide, { left: 376, top: 252, width: 56, height: 36 });

  card(slide, { left: 448, top: 150, width: 316, height: 240 }, C.panel);
  text(slide, { left: 476, top: 172, width: 260, height: 20 }, "三个人工选择点", { size: 12, bold: true, color: C.accent });
  ["审核 1 · 脚本：改、删、重生成", "审核 2 · 关键帧：逐镜挑图", "审核 3 · 片段：选 1 秒 + 红线"].forEach((s, i) => {
    const b = shape(slide, "roundRect", { left: 476, top: 202 + i * 58, width: 260, height: 46 }, C.soft);
    b.text = s;
    b.text.style = { typeface: family, fontSize: 13.5, color: C.ink, alignment: "left", autoFit: "none" };
  });

  arrowRight(slide, { left: 776, top: 252, width: 56, height: 36 });

  card(slide, { left: 848, top: 150, width: 368, height: 240 }, C.accent, { fill: C.accent, width: 0 });
  text(slide, { left: 876, top: 176, width: 200, height: 20 }, "输出", { size: 12, bold: true, color: "#C9DBFF" });
  text(slide, { left: 876, top: 204, width: 312, height: 64 }, "一期旅行 Vlog MP4", { size: 26, bold: true, color: "#FFFFFF" });
  ["24–30 镜 · 每镜 1 秒 · 约 30 秒", "9:16 竖屏（默认）或 16:9 横屏", "带字幕、LUT、AI 标识；可分享"].forEach((s, i) => {
    text(slide, { left: 876, top: 268 + i * 34, width: 316, height: 26 }, "· " + s, { size: 14, color: "#E9F0FF" });
  });

  text(slide, { left: MX, top: 420, width: 600, height: 26 }, "目的地是共享资产：官方维护景区级符号包", { size: 16, bold: true });
  const dests = [
    ["assets/demo/dest/nanchang/01.jpg", "无锡南长街"],
    ["assets/demo/dest/nianhua/01.jpg", "无锡拈花湾"],
    ["assets/demo/dest/lingshan/01.jpg", "无锡灵山大佛"],
    ["assets/demo/dest/mount-tai/01.jpg", "泰山"],
    ["assets/demo/dest/huangshan/01.jpg", "黄山"],
  ];
  for (let i = 0; i < dests.length; i++) {
    const x = MX + i * 236;
    slide.images.add({
      blob: await img(dests[i][0]), contentType: "image/jpeg",
      alt: `${dests[i][1]}实景参考图`, fit: "cover",
      position: { left: x, top: 454, width: 212, height: 130 }, geometry: "roundRect", borderRadius: 8,
    });
    const cap = shape(slide, "roundRect", { left: x, top: 554, width: 212, height: 30 }, "#33415C");
    cap.text = dests[i][1];
    cap.text.style = { typeface: family, fontSize: 12.5, bold: true, color: "#FFFFFF", alignment: "center", autoFit: "none" };
  }
  text(slide, { left: MX, top: 606, width: 1152, height: 24 }, "每个地标 3–10 张实景参考图 + 最佳机位 / 时段 + 必须保真特征；首批内置五个景区", { size: 13, color: C.sub });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §1 一句话定义、FR-14；assets/demo/catalog.json。实景图仅作产品演示。");
}

/* ============ 4 · 差异化 ============ */
{
  const slide = newSlide();
  header(slide, "差异化", "不做通用视频生成器，只做「角色 × 目的地」", 4);
  const values = [
    ["维度", "通用 AI 视频工具", "Kelvoy"],
    ["角色", "每次重新描述，形象随机", "账号级资产：外形跨期一致，每期换穿搭"],
    ["目的地", "不懂地标，容易失真", "景区级符号包 + 实景参考图保真"],
    ["叙事", "自由发挥，质量看运气", "六种目的地类型对应六种镜头语法"],
    ["过程", "一键黑盒，不可干预", "六阶段 + 人工审核点，可改、可重跑"],
    ["成本", "按次付费，不可控", "本地 DGX 为主 + API 溢出，整期上限 ¥20"],
  ];
  const table = slide.tables.add({
    rows: values.length, columns: 3,
    left: MX, top: 156, width: 1152, height: 430,
    columnTracks: [{ mode: "fr", value: 1.2 }, { mode: "fr", value: 2 }, { mode: "fr", value: 2.6 }],
    values,
  });
  styleTable(table, values);
  text(slide, { left: MX, top: 612, width: 1152, height: 26 }, "护城河不在模型，在角色资产、目的地库和跨期一致性", { size: 14, color: C.sub });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §1 定位（差异点）；项目说明文档 §1.3。");
}

/* ============ 5 · 流水线 ============ */
{
  const slide = newSlide();
  header(slide, "流水线", "六阶段生成，三个人工审核点兜住质量", 5);

  const stages = [
    ["Brief", "建期", "角色 / 目的地\n模板 / 画幅"],
    ["S1", "脚本生成", "24–30 镜 JSON\n含逐镜字幕"],
    ["S2", "角色资产", "版本快照\n参考图集"],
    ["S3", "关键帧", "每镜 1–3 候选\n（传统路径）"],
    ["S4", "视频生成", "3–5 秒片段\n截取 1 秒"],
    ["S5", "合成", "卡拍 / LUT / 字幕\nAI 标识 MP4"],
  ];
  const bw = 158, gap = 34, y = 190;
  stages.forEach(([tag, name, desc], i) => {
    const x = MX + i * (bw + gap);
    card(slide, { left: x, top: y, width: bw, height: 150 });
    chip(slide, { left: x + 14, top: y + 16, width: 54, height: 26 }, tag, { size: 12.5 });
    text(slide, { left: x + 14, top: y + 52, width: bw - 28, height: 26 }, name, { size: 17, bold: true });
    text(slide, { left: x + 14, top: y + 82, width: bw - 24, height: 56 }, desc, { size: 12, color: C.sub });
    if (i < stages.length - 1) arrowRight(slide, { left: x + bw + 4, top: y + 62, width: 26, height: 24 });
  });

  const marks = [
    [1, "审核 1 · 改脚本"],
    [3, "审核 2 · 挑关键帧"],
    [4, "审核 3 · 挑片段"],
  ];
  marks.forEach(([idx, label]) => {
    const x = MX + idx * (bw + gap);
    shape(slide, "line", { left: x + bw / 2, top: y + 150, width: 0, height: 34 }, "none", { fill: C.accent, width: 2 });
    chip(slide, { left: x + bw / 2 - 78, top: y + 186, width: 156, height: 32 }, label, { fill: C.accent, color: "#FFFFFF", size: 13 });
  });

  card(slide, { left: MX, top: 480, width: 1152, height: 120 }, C.soft);
  text(slide, { left: 96, top: 506, width: 1090, height: 30 }, "设计理念：不确定性压在便宜的静帧阶段，视频环节只让模型「动一下」，剪辑节奏交给合成", { size: 17, bold: true });
  text(slide, { left: 96, top: 542, width: 1090, height: 30 }, "片段全部通过后进入 compose_ready 合成设置，用户确认并点「开始合成」才入队", { size: 14.5, color: C.sub });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §4 核心流程、§18 固定一秒剪辑；项目说明文档 §2.1。");
}

/* ============ 6 · 两条创作路径 ============ */
{
  const slide = newSlide();
  header(slide, "创作路径", "默认直出视频，需要精修再走关键帧", 6);

  const cols = [
    {
      title: "直出视频（新项目默认）", badge: "video_source: references",
      flow: "脚本审核 → 素材检查 → 视频生成 → 片段审核",
      points: [
        "角色第一张参考图 + 地标第一张实景图，按序送 MiniMax H3 双参考图生视频",
        "跳过图片候选与关键帧审核，不产生图片积分",
        "生成 3–5 秒素材，用户截取严格 1 秒",
      ],
      accent: true,
    },
    {
      title: "关键帧（传统路径）", badge: "video_source: keyframe",
      flow: "脚本审核 → 关键帧候选 → 挑图 → 视频 → 片段审核",
      points: [
        "每镜 1–3 张候选（Qwen-Image 2.1，角色 / 地标双参考）",
        "人工逐镜挑图，可改 prompt 后重生成",
        "选定的关键帧作为首帧图生视频（MiniMax H3）",
      ],
      accent: false,
    },
  ];
  cols.forEach((col, i) => {
    const x = MX + i * 588;
    card(slide, { left: x, top: 150, width: 564, height: 96 }, col.accent ? C.accent : C.panel);
    text(slide, { left: x + 28, top: 172, width: 300, height: 30 }, col.title, { size: 20, bold: true, color: col.accent ? "#FFFFFF" : C.ink });
    chip(slide, { left: x + 336, top: 176, width: 200, height: 28 }, col.badge, { fill: col.accent ? "#3D71FF" : C.soft, color: col.accent ? "#FFFFFF" : C.sub, size: 11.5 });
    const flowBar = shape(slide, "roundRect", { left: x + 28, top: 264, width: 508, height: 40 }, col.accent ? C.accentSoft : C.soft);
    flowBar.text = col.flow;
    flowBar.text.style = { typeface: family, fontSize: 13, bold: true, color: C.accentDark, alignment: "center", autoFit: "none" };
    bullets(slide, { left: x + 30, top: 330, width: 508, height: 180 }, col.points, { size: 14.5, gap: 10 });
  });

  text(slide, { left: MX, top: 560, width: 1152, height: 26 }, "旧项目按原流程运行、不自动转换；旧逐镜项目可显式迁移为「新版 1 秒剪辑」", { size: 13.5, color: C.sub });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2「当前实施补充：人物与场景直出视频」「§18 固定一秒剪辑迁移」。");
}

/* ============ 7 · 固定一秒剪辑 ============ */
{
  const slide = newSlide();
  header(slide, "剪辑", "每镜严格 1 秒：30 帧 @30fps", 7);

  const tx = MX, ty = 170, tw = 1152;
  for (let i = 0; i <= 6; i++) {
    const x = tx + (tw / 6) * i;
    shape(slide, "line", { left: x, top: ty, width: 0, height: 10 }, "none", { fill: "#9FB4CC", width: 1.5 });
    text(slide, { left: x - 18, top: ty + 12, width: 36, height: 18 }, `${i}s`, { size: 11, color: C.sub, align: "center" });
  }
  const shots = ["镜头 1", "镜头 2", "镜头 3", "镜头 4", "镜头 5", "镜头 6"];
  shots.forEach((s, i) => {
    const x = tx + (tw / 6) * i + 8;
    const w = tw / 6 - 16;
    const b = shape(slide, "roundRect", { left: x, top: ty + 40, width: w, height: 64 }, i % 2 ? C.accentSoft : C.panel, { fill: C.accent, width: 1.5 });
    b.text = s + "\n1.0s · 30 帧";
    b.text.style = { typeface: family, fontSize: 12.5, bold: true, color: C.accentDark, alignment: "center", autoFit: "none" };
    const cap = shape(slide, "roundRect", { left: x, top: ty + 110, width: w, height: 26 }, C.soft);
    cap.text = "字幕烧录";
    cap.text.style = { typeface: family, fontSize: 10.5, color: C.sub, alignment: "center", autoFit: "none" };
    if (i > 0) {
      shape(slide, "line", { left: x - 8, top: ty + 40, width: 0, height: 64 }, "none", { fill: C.green, width: 3 });
    }
  });
  text(slide, { left: MX, top: ty + 144, width: 500, height: 22 }, "绿色竖线 = 切点；相邻镜头前后各 2 帧片内淡入淡出", { size: 12, color: C.green });

  const pts = [
    ["整数帧窗口", "起点按 1/30 秒吸附，Worker 校验选段不越片尾"],
    ["字幕默认开启", "每镜一秒窗口烧录 Shot.caption，片头偏移由拼接自然带入"],
    ["片头片尾默认关闭", "合成设置里可选用已交付素材；配乐只覆盖全片、不移动切点"],
    ["AI 标识", "右下角半透明水印 + 文件元数据，符合 2025-09 施行标识办法"],
  ];
  pts.forEach(([t, d], i) => {
    const x = MX + (i % 2) * 588, y = 388 + Math.floor(i / 2) * 110;
    card(slide, { left: x, top: y, width: 564, height: 92 });
    text(slide, { left: x + 24, top: y + 16, width: 520, height: 24 }, t, { size: 16, bold: true });
    text(slide, { left: x + 24, top: y + 46, width: 520, height: 36 }, d, { size: 13, color: C.sub });
  });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §18 固定一秒剪辑迁移；§8 合规（AI 标识）。");
}

/* ============ 8 · 技术架构 ============ */
{
  const slide = newSlide();
  header(slide, "技术架构", "本地优先的单机闭环，SQLite 是唯一真源", 8);

  const layers = [
    ["浏览器 · React + Vite", "官网 / 登录 / 建期 / 审片台 / 用量 / 分享页", 0.82],
    ["apps/web · Hono :3000", "auth · episodes · review · share · assets", 0.82],
    ["packages/store · SQLite", "期 / 角色 / 目的地 / 模板 / 任务 / 积分 —— 唯一真源", 1],
    ["apps/worker · 消费循环", "任务租约 · 生成适配 · 产物归档 · ffmpeg 合成 · 积分结算", 0.9],
    ["services/inference :8100 → ComfyUI :8188", "Qwen-Image 2.1 · MiniMax H3（comfyui-bridge 工作流）", 0.9],
  ];
  const y0 = 158;
  const areaX = MX + 40; // diagram column spans 104..864 (right panel starts at 880)
  const areaW = 760;
  layers.forEach(([t, d, wRatio], i) => {
    const w = areaW * wRatio;
    const x = areaX + (areaW - w) / 2;
    const y = y0 + i * 88;
    const isStore = t.includes("store");
    card(slide, { left: x, top: y, width: w, height: 70 }, isStore ? C.accent : C.panel);
    text(slide, { left: x + 24, top: y + 12, width: w - 48, height: 24 }, t, { size: 15.5, bold: true, color: isStore ? "#FFFFFF" : C.ink });
    text(slide, { left: x + 24, top: y + 38, width: w - 48, height: 22 }, d, { size: 12.5, color: isStore ? "#D9E6FF" : C.sub });
    if (i < layers.length - 1) {
      shape(slide, "line", { left: x + w / 2, top: y + 70, width: 0, height: 18 }, "none", { fill: "#9FB4CC", width: 2 });
    }
  });

  const rx = 880;
  card(slide, { left: rx, top: 158, width: 336, height: 428 }, C.soft);
  text(slide, { left: rx + 24, top: 180, width: 290, height: 26 }, "架构红线（ADR-0004）", { size: 16, bold: true });
  bullets(slide, { left: rx + 26, top: 216, width: 288, height: 350 }, [
    "无 Redis / Postgres / 对象存储",
    "web 与 worker 直调 store，无内部 HTTP",
    "compose 唯一碰 ffmpeg，只在 worker",
    "providers 可插拔，换模型不改上层",
    "产物落本地磁盘 projects/<期号>/…",
    "store 保持 async，为拆机留边界",
  ], { size: 13, gap: 9 });
  slide.speakerNotes.textFrame.setText("来源：docs/architecture.md；docs/decisions/0004-local-sqlite-no-cloud-infra.md；项目说明文档 §3.1。");
}

/* ============ 9 · 模型栈 ============ */
{
  const slide = newSlide();
  header(slide, "模型与工具", "每个环节一个接口，本地为主、API 溢出", 9);
  const values = [
    ["环节", "模型 / 服务", "说明"],
    ["脚本", "StepFun API", "brief + 目的地包 → 24–30 镜结构化 JSON；支持按指令优化重生成"],
    ["图像", "Qwen-Image 2.1（ComfyUI）", "单参考 = 角色；双参考 = 角色 + 地标；每镜 1–3 候选"],
    ["视频", "MiniMax H3（ComfyUI）", "双参考直出 / 关键帧图生视频；生成预算 240–270 秒"],
    ["溢出", "可灵 / 即梦 API", "本地重试 ≤ 2 次自动切换；排队超阈值也直接溢出"],
    ["音乐", "授权素材库", "按 tone 检索授权曲目，MVP 不生成音乐"],
    ["合成", "FFmpeg（Worker）", "30 帧整数窗口、LUT、ASS 字幕、转场、AI 标识、封装"],
  ];
  const table = slide.tables.add({
    rows: values.length, columns: 3,
    left: MX, top: 156, width: 1152, height: 470,
    columnTracks: [{ mode: "fr", value: 0.9 }, { mode: "fr", value: 1.7 }, { mode: "fr", value: 3.4 }],
    values,
  });
  styleTable(table, values);
  text(slide, { left: MX, top: 646, width: 1152, height: 24 }, "每次调用记录 provider / 模型 / 版本 / seed / 参考图哈希 / 费用，期级汇总成成本报告", { size: 13, color: C.sub });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §7 模型与工具适配层；services/inference/README.md；项目说明文档 §3.5。");
}

/* ============ 10 · 工程可靠性 ============ */
{
  const slide = newSlide();
  header(slide, "工程底座", "敢在现场重试的六个设计", 10);
  const items = [
    ["任务租约", "租约到期由下一次队列领取回收；Worker 重启不丢任务"],
    ["事务化结果提交", "任务结果、期状态、积分结算单事务落库（ADR-0007）"],
    ["失败重试复用候选", "沿用原 generation_id，已成功落盘的候选不重复烧 GPU"],
    ["优雅停机", "SIGTERM 停止领新任务，等待在跑任务收尾再退出"],
    ["媒体完整性校验", "流式下载限 512 MiB；Pillow 验图、ffmpeg 验流，损坏即取消"],
    ["过期产物清扫", "Worker 每小时清理过期推理媒体与发布暂存，控磁盘水位"],
  ];
  items.forEach(([t, d], i) => {
    const x = MX + (i % 3) * 392, y = 156 + Math.floor(i / 3) * 200;
    card(slide, { left: x, top: y, width: 368, height: 176 });
    shape(slide, "roundRect", { left: x + 26, top: y + 24, width: 36, height: 36 }, C.accentSoft);
    const ck = shape(slide, "textbox", { left: x + 26, top: y + 29, width: 36, height: 26 });
    ck.text = "✓";
    ck.text.style = { typeface: family, fontSize: 17, bold: true, color: C.green, alignment: "center", autoFit: "none" };
    text(slide, { left: x + 26, top: y + 74, width: 316, height: 26 }, t, { size: 17, bold: true });
    text(slide, { left: x + 26, top: y + 106, width: 316, height: 58 }, d, { size: 13.5, color: C.sub });
  });
  slide.speakerNotes.textFrame.setText("来源：apps/worker 源码与 README；docs/decisions/0007；docs/audit/。");
}

/* ============ 11 · 积分与成本 ============ */
{
  const slide = newSlide();
  header(slide, "积分与成本", "动作级计价，原子预留、结算、释放", 11);

  const values = [
    ["动作", "单价（积分）"],
    ["脚本生成", "1 / 次"],
    ["图片", "1 / 张"],
    ["视频", "10 / 段"],
    ["合成", "1 / 次"],
  ];
  const table = slide.tables.add({
    rows: values.length, columns: 2,
    left: MX, top: 170, width: 430, height: 250,
    columnTracks: [{ mode: "fr", value: 1 }, { mode: "fr", value: 1 }],
    values,
  });
  styleTable(table, values);
  bullets(slide, { left: MX + 4, top: 448, width: 430, height: 170 }, [
    "积分由团队 CLI 发放，不接购买与支付",
    "建期 / 阶段提交先预留，成功结算、失败释放",
    "流水不可变且幂等；用量页按期按模型展示",
  ], { size: 13.5, gap: 8 });

  text(slide, { left: 560, top: 166, width: 640, height: 26 }, "一期积分对比（按 28 镜估算）", { size: 16, bold: true });
  const chart = slide.charts.add("bar", {
    position: { left: 560, top: 200, width: 646, height: 330 },
    categories: ["直出视频", "关键帧 ×1", "关键帧 ×2", "关键帧 ×3"],
    series: [{ name: "一期积分", values: [282, 310, 338, 366], fill: C.accent }],
    barOptions: { direction: "column", grouping: "clustered" },
    hasLegend: false,
    dataLabels: { showValue: true, position: "outEnd" },
  });
  applyPresentationChartFont(chart, { fontFamily: family });
  text(slide, { left: 560, top: 548, width: 646, height: 44 }, "直出路径省掉图片积分，比关键帧 ×3 省约 23%；GPU 用量另按「镜数 × 候选 × 单位成本 × 1.5」独立估算展示", { size: 12.5, color: C.sub });

  const band = card(slide, { left: MX, top: 620, width: 1152, height: 52 }, C.soft);
  band.text = "成本红线：整期所有环节都走国内 API 的费用上限 ¥20 —— 团队预算约束，不是定价";
  band.text.style = { typeface: family, fontSize: 14, bold: true, color: C.ink, alignment: "center", autoFit: "none" };
  slide.speakerNotes.textFrame.setText("价格与估算口径：packages/store/src/schema.ts（credit_prices）、packages/engine/src/rules/credits.ts、PRD v0.2「当前实施补充」。图表为 28 镜理论估算。");
}

/* ============ 12 · 合规与安全 ============ */
{
  const slide = newSlide();
  header(slide, "合规与安全", "成片可溯源，内容有护栏", 12);
  const items = [
    ["AI 标识（显式 + 隐式）", "右下角半透明「AI 生成 · 虚构角色 · 真实目的地」水印 + 文件元数据；模型自带 SynthID / C2PA 不剥离，符合 2025-09 施行的《人工智能生成合成内容标识办法》"],
    ["内容拦截", "prompt 层关键词黑名单，命中即拒绝并提示修改创作要求"],
    ["数据隔离", "多租户行级 owner_id 过滤；密钥只在 worker / 推理侧；分享页不含账号信息"],
    ["版权与保真", "音乐只用授权曲库；不生成他人商标；私营店铺一律虚构；地标失真属质量红线"],
  ];
  items.forEach(([t, d], i) => {
    const x = MX + (i % 2) * 588, y = 156 + Math.floor(i / 2) * 220;
    card(slide, { left: x, top: y, width: 564, height: 196 });
    shape(slide, "roundRect", { left: x + 24, top: y + 24, width: 8, height: 44 }, C.accent);
    text(slide, { left: x + 48, top: y + 26, width: 500, height: 30 }, t, { size: 17.5, bold: true });
    text(slide, { left: x + 48, top: y + 64, width: 492, height: 116 }, d, { size: 13.5, color: C.sub });
  });
  slide.speakerNotes.textFrame.setText("来源：PRD v0.2 §8 非功能需求（合规 / 内容安全 / 质量）；项目说明文档 §五。");
}

/* ============ 13 · 现场 Demo 流程 ============ */
{
  const slide = newSlide();
  header(slide, "现场演示", "六步走完一条片，全程可干预", 13);
  const steps = [
    ["新建一期", "选官方角色 + 灵山大佛，9:16，直出方式，看实时预估积分"],
    ["审核 1 · 脚本", "改一镜字幕、删一镜；写优化指令重生成"],
    ["视频生成", "素材检查后双参考直出；进度页轮询任务状态"],
    ["审核 3 · 片段", "拖滑块选 1 秒；勾五项质量红线；标一镜坏镜重生成"],
    ["合成设置 → 成片", "标题 + 配乐 + 字幕确认后开始合成；ffprobe 验证后交付"],
    ["下载与分享", "播放成片、下载 MP4；开启分享链接（含二维码与文案）"],
  ];
  steps.forEach(([t, d], i) => {
    const x = MX + (i % 3) * 392, y = 150 + Math.floor(i / 3) * 218;
    card(slide, { left: x, top: y, width: 368, height: 194 });
    const num = shape(slide, "ellipse", { left: x + 26, top: y + 24, width: 44, height: 44 }, C.accent);
    num.text = String(i + 1);
    num.text.style = { typeface: family, fontSize: 18, bold: true, color: "#FFFFFF", alignment: "center", autoFit: "none" };
    text(slide, { left: x + 84, top: y + 30, width: 262, height: 30 }, t, { size: 17, bold: true });
    text(slide, { left: x + 26, top: y + 84, width: 318, height: 90 }, d, { size: 13.5, color: C.sub });
  });
  const band = card(slide, { left: MX, top: 600, width: 1152, height: 56 }, C.soft);
  band.text = "预计 10–15 分钟 · 备用：同角色已完成的多期成片与公开分享链接";
  band.text.style = { typeface: family, fontSize: 14, bold: true, color: C.ink, alignment: "center", autoFit: "none" };
  slide.speakerNotes.textFrame.setText("来源：apps/web/src/frontend/guide.ts（六步指引）；PRD v0.2 §10 比赛 Demo 验收。");
}

/* ============ 14 · 团队与结语 ============ */
{
  const slide = newSlide();
  header(slide, "团队", "Kelvoy 项目组", 14);
  const values = [
    ["成员", "职责"],
    ["张小白（张辉）", "队长 · 项目策划 · PRD · 环境部署 · 演示"],
    ["小腾子", "原型设计 · 测试 · DEMO 视频录制"],
    ["般度五子", "ComfyUI 部署与开发 · 图像 / 视频管线"],
    ["馄饨", "Web 前后台 · 审片台 · 积分系统"],
  ];
  const table = slide.tables.add({
    rows: values.length, columns: 2,
    left: MX, top: 156, width: 640, height: 260,
    columnTracks: [{ mode: "fr", value: 1 }, { mode: "fr", value: 1.8 }],
    values,
  });
  styleTable(table, values);
  bullets(slide, { left: MX + 4, top: 448, width: 620, height: 150 }, [
    "开源协议：Apache License 2.0",
    "仓库：github.com/zhanghui-china/Kelvoy",
    "感谢 NVIDIA DGX Spark 黑客松 · StepFun · Qwen-Image · MiniMax · ComfyUI · FFmpeg",
  ], { size: 13.5, gap: 9 });

  card(slide, { left: 760, top: 156, width: 456, height: 440 }, C.accent, { fill: C.accent, width: 0 });
  text(slide, { left: 800, top: 210, width: 380, height: 120 }, "选一个角色，\n去一个真实的地方，\n一期旅行 Vlog 自动生成。", { size: 25, bold: true, color: "#FFFFFF" });
  text(slide, { left: 800, top: 388, width: 380, height: 30 }, "可旅，让每一场旅行都有 vlog", { size: 18, color: "#D9E6FF" });
  shape(slide, "line", { left: 800, top: 448, width: 120, height: 0 }, "none", { fill: "#6E96FF", width: 3 });
  text(slide, { left: 800, top: 470, width: 380, height: 60 }, "Kelvoy · AI 旅行 Vlog 生产工作台\n第三届 NVIDIA DGX Spark 黑客松", { size: 13, color: "#C9DBFF" });
  slide.speakerNotes.textFrame.setText("来源：README.md 项目团队；项目说明文档 §十。");
}

/* ============ 导出草稿与预览 ============ */
await fs.mkdir(TMP_DIR, { recursive: true });
const draftPath = path.join(TMP_DIR, "kelvoy-demo-draft.pptx");
await (await PresentationFile.exportPptx(presentation)).save(draftPath);

for (let i = 0; i < allSlides.length; i++) {
  const slide = allSlides[i];
  const preview = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(TMP_DIR, `slide-${i + 1}.png`), new Uint8Array(await preview.arrayBuffer()));
}
console.log(`draft exported: ${draftPath}, slides: ${allSlides.length}`);
