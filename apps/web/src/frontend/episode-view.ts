import type { Episode } from "@kelvoy/engine";

// 首页（HomePage）和我的作品（WorksPage）共用的期展示口径。纯函数，不碰
// 网络也不碰 DOM——"本周统计"的数字要能对着 SQLite 里的期 JSON 手算核对
// （#42 验收项），所以周界算法单独可测。

/** 旧期没有独立名称时回落到成片标题或 id。 */
export function episodeLabel(e: Episode): string {
  return e.name || e.render.title || e.episode_id;
}

export interface WeekStats {
  /** 本周创建、且已经走到 done 的期数。 */
  doneEpisodes: number;
  /** 本周创建的期的积分消耗之和。 */
  gpuMinutes: number;
  /** 本周创建的期里，status 为 approved 的镜数。 */
  approvedShots: number;
}

/** 自然周 = 本地时区的周一 00:00 到下周一 00:00（不含）。 */
export function weekRange(now: Date): { start: number; end: number } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekdayFromMonday = (monday.getDay() + 6) % 7; // 周日 getDay()===0 → 6
  monday.setDate(monday.getDate() - weekdayFromMonday);
  // 按日期分量加 7 天而不是加 7×86400000 毫秒：跨夏令时的时区里毫秒加法会
  // 差一小时，中国没有夏令时但这函数不该依赖这一点。
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return { start: monday.getTime(), end: nextMonday.getTime() };
}

/**
 * 三个数字都先按 created_at 落在本自然周内筛期（#42 的口径），再分别数。
 * created_at 解析不出时间的期直接跳过，不让一条脏数据把整块统计拖垮。
 */
export function weekStats(episodes: Episode[], now: Date): WeekStats {
  const { start, end } = weekRange(now);
  const thisWeek = episodes.filter((e) => {
    const t = new Date(e.created_at).getTime();
    return Number.isFinite(t) && t >= start && t < end;
  });

  return {
    doneEpisodes: thisWeek.filter((e) => e.status === "done").length,
    gpuMinutes: thisWeek.reduce((sum, e) => sum + e.credits_used, 0),
    approvedShots: thisWeek.reduce(
      (sum, e) => sum + e.shots.filter((s) => s.status === "approved").length,
      0,
    ),
  };
}
