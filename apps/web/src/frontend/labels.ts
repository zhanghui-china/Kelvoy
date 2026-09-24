import type { DestinationType } from "@kelvoy/engine";

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
