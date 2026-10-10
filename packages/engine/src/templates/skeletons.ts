import type { DestinationType } from "../schema/destination";

/**
 * FR-02 narrative skeletons, one per `DestinationType`. Structural only —
 * segments are generic story beats, not specific waypoints; the concrete
 * route/landmarks/food come from the actual `Destination` record and get
 * fused with this structure by the script provider. Shot counts and type
 * proportions are decided by the creative requirements.
 */
export interface NarrativeSkeleton {
  type: DestinationType;
  segments: string[];
  notes: string;
}

export const SKELETONS: Record<DestinationType, NarrativeSkeleton> = {
  mountain_summit: {
    type: "mountain_summit",
    segments: ["山脚集合", "攀登途中", "沿途景观", "登顶", "顶上体验", "下山尾声"],
    notes: "体力感和海拔感要拍出来：仰拍山势、俯拍云海、脚下台阶；登顶前可安排喘息/回头看的动作。",
  },
  city_night: {
    type: "city_night",
    segments: ["日落前抵达", "华灯初上", "核心地标夜景", "街边小吃", "夜游高潮", "漫步尾声"],
    notes: "光线从黄昏过渡到夜晚；灯光、倒影、人流是氛围镜的重点；核心地标可用远景和近景呈现。",
  },
  theme_town: {
    type: "theme_town",
    segments: ["入镇", "主街漫步", "核心地标", "特色体验", "小吃与手作", "夜灯尾声"],
    notes: "小镇的\"主题\"符号（建筑风格、灯饰、街景小品）要反复出现；特色体验镜给一个互动动作，不只是走路。",
  },
  scenic_area: {
    type: "scenic_area",
    segments: ["到达", "首个地标", "登阶/核心地标", "深度体验（室内或细节）", "歇脚小食", "下山尾声"],
    notes: "大型景区动线长，按 Destination.route 的顺序走；地标镜头之间可穿插体力/情绪反应镜避免堆砌。",
  },
  water_town: {
    type: "water_town",
    segments: ["入镇桥头", "沿河漫步", "核心桥/ 建筑", "舟游或水边", "小吃与手作店铺", "夜灯尾声"],
    notes: "水面倒影和石桥是这类目的地的视觉锚点；可从桥上或船上取景。",
  },
  island: {
    type: "island",
    segments: ["登岛/码头", "海岸线漫步", "核心景观（礁石/灯塔类）", "海边餐食", "日落", "尾声"],
    notes: "海天一线的空镜比例可以比其他类型高；日落是这类目的地默认的情绪高点，尽量安排在后段。",
  },
};
