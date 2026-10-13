export interface PersonaStyle {
  lut: string; // e.g. "lut/warm_film.cube"
  title_style: string; // e.g. "serif-center"
}

/** 角色基础参考图张数（FR-03）：1 张全身照即可建作品，更多角度可选。 */
export const PERSONA_REFS_MIN = 1;
export const PERSONA_REFS_MAX = 7;

/** 每角色最多几套自建穿搭，每套几张参考图（脸型锁定由基础图 refs 承担，所以穿搭图不要求 PERSONA_REFS_MIN 以上）。 */
export const PERSONA_OUTFITS_MAX = 6;
/**
 * 旧式（上传 1–3 张穿搭图）创建路径的张数范围。三视图穿搭（ADR-0017）可以只有 `source` 而 `refs`
 * 为空，所以文档层校验是「`source` 与 `refs` 二选一必有其一」，本常量只约束 `refs` 非空时的上限与旧路径下限。
 */
export const OUTFIT_REFS_MIN = 1;
export const OUTFIT_REFS_MAX = 3;

/** 三视图生成状态：缺省等同 "none"；只有 "ready" 时 `views` 才存在（ADR-0017）。 */
export type ViewsStatus = "none" | "pending" | "ready" | "failed";

/** 据一张全身照生成的三视图与横向拼合的设定图，值为图片 key（本地磁盘相对路径，ADR-0004）。 */
export interface ThreeViews {
  front: string;
  side: string;
  back: string;
  /** 正 | 侧 | 背 横拼的设定图；关键帧只用它作人物参考（spike/three-views/README.md 方案 A）。 */
  sheet: string;
}

/** 三视图生成记录（ready 时必填），口径与 `Shot.model.image` 一致但只留追溯所需的四项。 */
export interface ViewsGeneration {
  provider: string;
  model: string;
  version: string;
  seed: number;
}

/**
 * 角色的一套穿搭：本人穿这套衣服的参考图。生成时它替代 `Persona.refs[0]`
 * 成为"人物参考图"（实验结论见 ADR-0015：只能替代，不能和基础图同时给，
 * 否则模型会画成两个人）。默认穿搭不是一条记录——`brief.outfit_id` 为空
 * 即用 `refs` + `default_outfit`。
 */
export interface PersonaOutfit {
  outfit_id: string; // 创建时生成，改名不变
  name: string;
  desc: string;
  seasons: string[]; // 适合的季节，取值与 brief.season 同口径（自由文本），用于推荐
  /** 旧式穿搭图，0–3 张，只追加；旧版本引用的文件不得删除（PRD §3）。三视图穿搭可为空，但 `source` 与 `refs` 至少有其一。 */
  refs: string[];
  /** 用户上传的这套穿搭的 1 张全身照，三视图由它生成；旧数据缺省。 */
  source?: string;
  views?: ThreeViews; // 仅 views_status === "ready" 时存在
  views_status?: ViewsStatus; // 缺省 = "none"
  views_gen?: ViewsGeneration; // 仅 ready 时存在
}

export interface Persona {
  persona_id: string;
  owner_id: string | null; // null = official catalog, writable only through internal CLI
  version: number; // bumped on every edit; episodes snapshot the version they were generated with
  name: string;
  desc: string;
  locked: string[]; // e.g. ["脸型", "发型", "体态"]
  default_outfit: string;
  refs: string[]; // local disk paths (ADR-0004); user-uploaded, real photos allowed (PRD v0.2 §3)
  style: PersonaStyle;
  /** 默认穿搭的三视图，由 `refs[0]` 生成（它就是默认穿搭的 source）；字段语义同 PersonaOutfit。 */
  views?: ThreeViews;
  views_status?: ViewsStatus;
  views_gen?: ViewsGeneration;
  outfits?: PersonaOutfit[]; // 缺省 = 只有默认穿搭；至多 PERSONA_OUTFITS_MAX 套
}
