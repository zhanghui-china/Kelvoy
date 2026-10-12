export interface PersonaStyle {
  lut: string; // e.g. "lut/warm_film.cube"
  title_style: string; // e.g. "serif-center"
}

/** 每角色最多几套自建穿搭，每套几张参考图（脸型锁定由基础图 refs 承担，所以不要求 3–7）。 */
export const PERSONA_OUTFITS_MAX = 6;
export const OUTFIT_REFS_MIN = 1;
export const OUTFIT_REFS_MAX = 3;

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
  refs: string[]; // 1–3 张，只追加；旧版本引用的文件不得删除（PRD §3）
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
  outfits?: PersonaOutfit[]; // 缺省 = 只有默认穿搭；至多 PERSONA_OUTFITS_MAX 套
}
