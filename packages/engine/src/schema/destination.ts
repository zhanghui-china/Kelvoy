// One enum for destination type, narrative skeleton and template skeleton (PRD v0.2 §6).
export type DestinationType =
  | "mountain_summit" // 名山登顶
  | "city_night" // 城市街区夜游
  | "theme_town" // 主题小镇
  | "scenic_area" // 大型景区
  | "water_town" // 古镇水乡
  | "island"; // 海岛

export interface Landmark {
  id: string;
  name: string;
  refs: string[];
  best_time: string;
  must_keep?: string[];
}

// Scenic-spot granularity: one destination = one scenic area; city is grouping only.
export interface Destination {
  destination_id: string;
  version: number;
  name: string;
  city: string;
  type: DestinationType;
  season_best: string[];
  landmarks: Landmark[];
  route: string[];
  food: string[];
  transport: string;
  stay: string;
}
