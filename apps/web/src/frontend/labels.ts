import type {
  DestinationType,
  EpisodeStatus,
  SceneTime,
  ShotCamera,
  ShotSize,
  ShotStatus,
} from "@kelvoy/engine";

// 目的地/模板骨架六值枚举的中文展示名（PRD v0.2 §6）。当前只有
// TemplatesPage 用，#30/#31 会复用同一份映射，所以放这个独立小文件而不是
// 内联在某个页面里。
export const DESTINATION_TYPE_LABELS: Record<DestinationType, string> = {
  mountain_summit: "名山登顶",
  city_night: "城市街区夜游",
  theme_town: "主题小镇",
  scenic_area: "大型景区",
  water_town: "古镇水乡",
  island: "海岛",
};

// 期/镜状态机与镜头字段枚举的中文展示名（PRD v0.2 §6）。审片台（#31）按
// status 分发视图，每个视图都要把这些枚举显示成人话。
export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
  draft: "草稿",
  scripting: "生成脚本中",
  script_review: "待审脚本",
  assets: "准备素材中",
  keyframing: "生成关键帧中",
  kf_review: "待审关键帧",
  clipping: "生成片段中",
  clip_review: "待审片段",
  compose_ready: "合成设置",
  composing: "合成中",
  done: "已完成",
  failed: "失败",
};

export const SHOT_STATUS_LABELS: Record<ShotStatus, string> = {
  draft: "待生成",
  generating_kf: "生成关键帧中",
  kf_ready: "候选就绪",
  kf_selected: "已选关键帧",
  generating_clip: "生成片段中",
  clip_ready: "片段就绪",
  approved: "已通过",
  rejected: "已标记重生成",
  failed: "失败",
};

export const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  wide: "远景",
  medium: "中景",
  close: "近景",
  detail: "特写",
  pov: "主观视角",
};

export const SHOT_CAMERA_LABELS: Record<ShotCamera, string> = {
  static: "固定",
  pan: "横摇",
  push: "推进",
  follow: "跟随",
};

export const SCENE_TIME_LABELS: Record<SceneTime, string> = {
  morning: "早晨",
  noon: "正午",
  afternoon: "下午",
  evening: "傍晚",
  night: "夜晚",
};
