import type { MusicProvider } from "./types";

/**
 * 音乐 (PRD §7, FR-07, M1-13)：MVP 从**授权曲库**里选曲，不做生成
 * （ACE-Step/YuE 之类是以后的选项，不在这里搭架子）。
 *
 * 曲库是代码里的常量目录：`file` 是相对 projects 根的 key，真实授权音频由
 * 团队放到 `projects/music/<name>.mp3`（apps/worker 的 sharedAssetPath 负责
 * 解析成绝对路径）。这里刻意不查文件是否存在——engine 不碰 IO；文件缺失时
 * worker 执行 compose 会明确报错，不会静默出一条无声成片。
 *
 * bpm 是卡拍对齐（rules/beat.ts）的输入，必须和音频实际速度一致，换曲时要
 * 一起改。license 原样写进期记录，供合规审计（PRD §8）。
 */
export interface MusicTrack {
  file: string;
  bpm: number;
  license: string;
  /** brief.tone 的匹配词；命中任意一个即可。 */
  tones: string[];
}

// 示例目录：条目形态固定，曲子本身等团队采购授权素材后替换/补齐。
export const MUSIC_CATALOG: readonly MusicTrack[] = [
  { file: "music/calm_morning.mp3", bpm: 84, license: "CC0-1.0", tones: ["松弛", "治愈", "清晨", "安静"] },
  { file: "music/city_walk.mp3", bpm: 100, license: "CC0-1.0", tones: ["日常", "City Walk", "轻快"] },
  { file: "music/bright_travel.mp3", bpm: 120, license: "CC0-1.0", tones: ["欢快", "明亮", "活力"] },
  { file: "music/night_neon.mp3", bpm: 128, license: "CC0-1.0", tones: ["夜景", "赛博", "都市"] },
  { file: "music/wide_nature.mp3", bpm: 92, license: "CC0-1.0", tones: ["辽阔", "自然", "史诗"] },
];

/**
 * tone 是用户自由填的短语（"松弛治愈的秋日"），不是枚举——所以用子串包含
 * 做宽松匹配，而不是相等。匹配不到就退第一条，不让"选不出曲子"阻断合成。
 */
function matchByTone(tone: string | undefined): readonly MusicTrack[] {
  if (!tone) return MUSIC_CATALOG;
  const hits = MUSIC_CATALOG.filter((track) => track.tones.some((word) => tone.includes(word)));
  return hits.length > 0 ? hits : MUSIC_CATALOG;
}

export const musicLibraryProvider: MusicProvider = {
  async selectTrack(input) {
    const candidates = matchByTone(input.tone);
    const target = input.bpm;
    const picked =
      target !== undefined && Number.isFinite(target) && target > 0
        ? candidates.reduce((best, track) =>
            Math.abs(track.bpm - target) < Math.abs(best.bpm - target) ? track : best,
          )
        : candidates[0]!;
    return { file: picked.file, bpm: picked.bpm, license: picked.license };
  },
};
