import type { Episode } from "@kelvoy/engine";
import { getEpisodeBySlug } from "@kelvoy/store";
import { Hono } from "hono";
import { resolveArtifactPath } from "./episodes";

// FR-12: 分享页，不需要登录。响应体是显式白名单（见 toSharedEpisode），
// 新增字段前必须评估是否对未登录访问者可见——提示词、素材路径、配乐文件、
// 成片 key 都不能出现在这里。
// 找不到 slug 和 share.enabled=false 都返回同样的 404，不泄露"这个 slug
// 存在但没开分享"。
const share = new Hono();

function toSharedEpisode(episode: Episode) {
  const { final } = episode;
  return {
    episode_id: episode.episode_id,
    status: "done" as const,
    title: episode.render.title,
    shot_count: (episode.shared_storyboard?.shots ?? episode.shots).length,
    final: final ? { duration_s: final.duration_s, width: final.width, height: final.height } : null,
  };
}

share.get("/:slug", async (c) => {
  const episode = await getEpisodeBySlug(c.req.param("slug"));
  if (!episode || !episode.share.enabled || (episode.status !== "done" && !episode.final)) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }

  return c.json({ ok: true, episode: toSharedEpisode(episode) });
});

// 成片文件名约定和 DoneView.tsx 的 finalKey() 保持一致，见那边的注释——
// 前端/这里都不 import engine 的运行时代码，两处手抄同一个字符串。
share.get("/:slug/final.mp4", async (c) => {
  const episode = await getEpisodeBySlug(c.req.param("slug"));
  if (!episode || !episode.share.enabled || (episode.status !== "done" && !episode.final)) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }

  const filePath = resolveArtifactPath(episode.episode_id,
    episode.final?.key ?? `final/${episode.episode_id}.mp4`);
  if (!filePath) return c.json({ ok: false, error: "invalid_path" }, 400);

  const file = Bun.file(filePath);
  if (!(await file.exists())) return c.json({ ok: false, error: "not_found" }, 404);
  return new Response(file);
});

export default share;
