import { getEpisodeBySlug } from "@kelvoy/store";
import { Hono } from "hono";

// FR-12: 分享页，不需要登录，响应体只挑成片+分镜表相关字段，不含账号信息。
// 找不到 slug 和 share.enabled=false 都返回同样的 404，不泄露"这个 slug
// 存在但没开分享"。
const share = new Hono();

share.get("/:slug", async (c) => {
  const episode = await getEpisodeBySlug(c.req.param("slug"));
  if (!episode || !episode.share.enabled) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }

  return c.json({
    ok: true,
    episode: {
      episode_id: episode.episode_id,
      status: episode.status,
      scenes: episode.scenes,
      shots: episode.shots,
      music: episode.music,
      render: episode.render,
    },
  });
});

export default share;
