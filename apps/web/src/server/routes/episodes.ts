import { join, resolve, sep } from "node:path";
import type { Episode } from "@kelvoy/engine";
import { validateCreateEpisodeRequest } from "@kelvoy/engine";
import {
  enqueueTask,
  getDestination,
  getEpisode,
  getPersona,
  getTemplate,
  insertEpisode,
  listEpisodes,
} from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-01/FR-05/FR-08: 建期/期列表/详情/产物文件. 审片台的写路由在 M2-6 (#22)。
const episodes = new Hono();

episodes.use("*", requireOwner);

episodes.get("/", async (c) => {
  return c.json({ ok: true, episodes: await listEpisodes(c.get("ownerId")) });
});

episodes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = validateCreateEpisodeRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);
  const req = result.value;

  const [persona, destination, template] = await Promise.all([
    getPersona(req.persona_id),
    getDestination(req.destination_id),
    getTemplate(req.template_id),
  ]);
  if (!persona || persona.owner_id !== c.get("ownerId")) {
    return c.json({ ok: false, error: "persona_not_found" }, 404);
  }
  if (!destination) return c.json({ ok: false, error: "destination_not_found" }, 404);
  if (!template) return c.json({ ok: false, error: "template_not_found" }, 404);

  // FR-01"缺字段给默认值"：mode 的默认值(per_shot)是 PRD §6 原文写明的；
  // series_id/season/tone/banned 没有 PRD 原文默认值可抄，这里按合理取舍
  // 补：series_id 缺省时 1 目的地 = 1 系列(PRD 没有定义"系列"怎么分组多个
  // 目的地，等以后真需要跨目的地系列时再改)；season 缺省取目的地的
  // season_best 第一项，没有就空字符串；tone/banned 缺省给空。
  const episode: Episode = {
    episode_id: `e_${crypto.randomUUID()}`,
    owner_id: c.get("ownerId"),
    persona_id: persona.persona_id,
    persona_version: persona.version,
    destination_id: destination.destination_id,
    destination_version: destination.version,
    series_id: req.series_id ?? destination.destination_id,
    template_id: template.template_id,
    status: "draft",
    mode: req.mode ?? "per_shot",
    created_at: new Date().toISOString(),
    estimated_credits: 0, // FR-09 估价公式卡 M0-6，estimateCredits() 占位未接入，见 credits.ts
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: req.season ?? destination.season_best[0] ?? "",
      aspect: "9:16",
      duration_s: 30,
      tone: req.tone ?? "",
      outfit_override: null,
      banned: req.banned ?? [],
    },
    grid_refs: [],
    scenes: [],
    shots: [],
    removed_shots: [],
    // Template 没有音乐字段(配乐按 tone 自动选是 assets 阶段的业务逻辑，
    // 不是建期这一步该做的事)，这里只给空占位，由后续阶段真正填入。
    music: { file: "", bpm: 0, license: "" },
    render: {
      res: "1080x1920",
      fps: 30,
      title: `${destination.city} · ${destination.name}`,
      intro: template.intro,
      outro: template.outro,
      ai_label: true,
    },
  };

  await insertEpisode(episode);
  await enqueueTask({ episode_id: episode.episode_id, stage: "brief" });
  return c.json({ ok: true, episode }, 201);
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
