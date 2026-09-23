import { join, resolve, sep } from "node:path";
import { getEpisode, listEpisodes } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-01/FR-05/FR-08: 期列表/详情/产物文件. 审片台的写路由在 M2-6 (#22)。
const episodes = new Hono();

episodes.use("*", requireOwner);

episodes.get("/", async (c) => {
  return c.json({ ok: true, episodes: await listEpisodes(c.get("ownerId")) });
});

episodes.get("/:id", async (c) => {
  const result = await getEpisode(c.req.param("id"));
  if (!result.ok || result.episode.owner_id !== c.get("ownerId")) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  return c.json({ ok: true, episode: result.episode, row_version: result.row_version });
});

// 本地磁盘路径解析，和 apps/worker/src/storage/artifacts.ts 的 artifactPath
// 同一套约定（<root>/<episode_id>/<relativeKey>），但不跨 app 导入——两个
// app 互不依赖是既有约定（package.json 里没有 worker -> web 或反过来的
// workspace 依赖），这里的 4 行路径拼接不值得为此破例。
function projectsRoot(): string {
  return process.env.KELVOY_PROJECTS_ROOT ?? "projects";
}

/**
 * `relativeKey` in practice never arrives containing ".." over real HTTP —
 * Bun.serve (and any spec-compliant URL parser) collapses dot-segments
 * before routing ever sees the path, verified against this exact route
 * shape. This check is the defense-in-depth backstop for a caller that
 * bypasses that (a future non-URL entry point, a different runtime) —
 * exported so episodes.test.ts can exercise it directly instead of
 * fighting URL normalization to prove it works.
 *
 * join() normalizes ".." segments but (unlike resolve() called with
 * multiple args) never lets an absolute relativeKey override the root —
 * the prefix check then catches anything that still climbed out.
 */
export function resolveArtifactPath(episodeId: string, relativeKey: string | undefined): string | null {
  if (!relativeKey) return null;
  const root = resolve(projectsRoot(), episodeId);
  const filePath = resolve(join(root, relativeKey));
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  return filePath;
}

// Hono's plain "*" wildcard doesn't populate a named param when mixed with
// preceding path params in this Hono version (verified empirically) — a
// regex param does, and still greedily matches multiple "/"-separated
// segments.
episodes.get("/:id/files/:path{.+}", async (c) => {
  const episodeId = c.req.param("id");
  const result = await getEpisode(episodeId);
  if (!result.ok || result.episode.owner_id !== c.get("ownerId")) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }

  const filePath = resolveArtifactPath(episodeId, c.req.param("path"));
  if (!filePath) {
    return c.json({ ok: false, error: "invalid_path" }, 400);
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  return new Response(file);
});

export default episodes;
