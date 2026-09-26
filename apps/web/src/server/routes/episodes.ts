import { join, resolve, sep } from "node:path";
import type { Episode, Template } from "@kelvoy/engine";
import {
  checkContent,
  estimateCost,
  SETTINGS_CANDIDATES_MAX,
  SETTINGS_CANDIDATES_MIN,
  MUSIC_CATALOG,
  validateCreateEpisodeRequest,
  validatePatchEpisodeRequest,
} from "@kelvoy/engine";
import {
  createEpisodeWithScriptTask,
  estimateCreditQuote,
  getDestination,
  getEpisode,
  getPersona,
  getPersonaVersion,
  getTemplate,
  getUserById,
  listEpisodes,
  patchEpisode,
  upsertTemplate,
} from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";
import { loadOwnedEpisode, patchErrorResponse } from "./episode-common";
import review from "./episode-review";

// FR-01/FR-05: 建期/期列表/详情/存为模板/产物文件。审片台的写路由在
// episode-review.ts，挂在同一个前缀下（见文件末尾的 episodes.route）。
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

  // MVP 内容审核（PRD §8/§11，#29）：建期时的自由文本，
  // 命中直接拦截，不浪费后面的外键查询和写库。
  const contentViolations = checkContent([
    ...(req.name !== undefined ? [{ field: "name", text: req.name }] : []),
    ...(req.requirements !== undefined ? [{ field: "requirements", text: req.requirements }] : []),
    ...(req.season !== undefined ? [{ field: "season", text: req.season }] : []),
    ...(req.tone !== undefined ? [{ field: "tone", text: req.tone }] : []),
    ...(req.banned ?? []).map((term, i) => ({ field: `banned[${i}]`, text: term })),
  ]);
  if (contentViolations.length > 0) {
    return c.json({ ok: false, error: "content_blocked", violations: contentViolations }, 400);
  }

  const [persona, destination, template, user] = await Promise.all([
    getPersona(req.persona_id),
    getDestination(req.destination_id),
    getTemplate(req.template_id),
    getUserById(c.get("ownerId")),
  ]);
  if (!persona || (persona.owner_id !== null && persona.owner_id !== c.get("ownerId"))) {
    return c.json({ ok: false, error: "persona_not_found" }, 404);
  }
  if (!destination) return c.json({ ok: false, error: "destination_not_found" }, 404);
  if (!template) return c.json({ ok: false, error: "template_not_found" }, 404);

  // FR-01"缺字段给默认值"：新期仅开放 per_shot；
  // series_id/season/tone/banned 没有 PRD 原文默认值可抄，这里按合理取舍
  // 补：series_id 缺省时 1 目的地 = 1 系列(PRD 没有定义"系列"怎么分组多个
  // 目的地，等以后真需要跨目的地系列时再改)；season 缺省取目的地的
  // season_best 第一项，没有就空字符串；tone/banned 缺省给空。
  const mode = "per_shot";
  const aspect = req.aspect ?? "9:16";
  const candidateCount = req.candidate_count ?? user?.settings.default_candidates ?? 3;
  const episode: Episode = {
    episode_id: `e_${crypto.randomUUID()}`,
    name: req.name ?? `${destination.city} · ${destination.name}`,
    owner_id: c.get("ownerId"),
    persona_id: persona.persona_id,
    persona_version: persona.version,
    destination_id: destination.destination_id,
    destination_version: destination.version,
    series_id: req.series_id ?? destination.destination_id,
    template_id: template.template_id,
    status: "draft",
    mode,
    cut_policy: "fixed_1s",
    candidate_count: candidateCount,
    created_at: new Date().toISOString(),
    // FR-01/FR-09 提交前粗估：这一刻还没有脚本，estimateCost 用它的默认
    // 镜数常量（credits.ts，M0-6 占位）；候选数取本期保存的值。
    estimated_credits: estimateCreditQuote(candidateCount),
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: req.season ?? destination.season_best[0] ?? "",
      aspect,
      requirements: req.requirements ?? "",
      duration_s: 30,
      tone: req.tone ?? "",
      outfit_override: req.outfit_override ?? null,
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
      res: aspect === "9:16" ? "1080x1920" : "1920x1080",
      fps: 30,
      title: `${destination.city} · ${destination.name}`,
      intro: null,
      outro: null,
      ai_label: true,
      subtitles_enabled: true,
      transitions_enabled: true,
    },
  };

  const created = createEpisodeWithScriptTask(episode);
  if (!created.ok) return c.json({ ok: false, error: created.error }, created.error === "insufficient_credits" ? 402 : 404);
  return c.json({ ok: true, episode }, 201);
});

// FR-01/FR-09: 建期表单提交前的粗估价，不落库、不查外键，纯计算——挂在
// "/:id" 之前，否则 Hono 会把 "estimate" 当成 :id 匹配掉。
episodes.get("/estimate", async (c) => {
  const mode = c.req.query("mode");
  if (mode !== "per_shot") {
    return c.json({ ok: false, error: "invalid_mode" }, 400);
  }

  // M2-15：候选数由表单传上来（来自账号的出片默认值，用户可当场改），
  // 不传时取账号默认候选数，否则用新期默认 3。范围跟设置页同一套常量。
  const rawCandidates = c.req.query("candidates");
  let candidates: number | undefined;
  if (rawCandidates !== undefined) {
    candidates = Number(rawCandidates);
    if (
      !Number.isInteger(candidates) ||
      candidates < SETTINGS_CANDIDATES_MIN ||
      candidates > SETTINGS_CANDIDATES_MAX
    ) {
      return c.json({ ok: false, error: "invalid_candidates" }, 400);
    }
  }

  if (candidates === undefined) {
    const user = await getUserById(c.get("ownerId"));
    candidates = user?.settings.default_candidates;
  }
  return c.json({ ok: true, estimate: estimateCost({ mode, candidates }),
    credit_quote: estimateCreditQuote(candidates ?? 3) });
});

episodes.get("/:id", async (c) => {
  const result = await getEpisode(c.req.param("id"));
  if (!result.ok || result.episode.owner_id !== c.get("ownerId")) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  const revision = await getPersonaVersion(result.episode.persona_id, result.episode.persona_version);
  const persona = revision && (revision.owner_id === null || revision.owner_id === c.get("ownerId"))
    ? revision : null;
  return c.json({ ok: true, episode: result.episode, persona, row_version: result.row_version });
});

episodes.patch("/:id", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const result = validatePatchEpisodeRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);
  if (Object.keys(result.value.patch).some((field) => field !== "render" && field !== "music") ||
      (loaded.episode.status !== "compose_ready" && loaded.episode.status !== "done")) {
    return c.json({ ok: false, error: "invalid_public_patch" }, 400);
  }
  const render = result.value.patch.render;
  if (render && (render.res !== loaded.episode.render.res || render.fps !== loaded.episode.render.fps ||
      render.ai_label !== loaded.episode.render.ai_label ||
      ![null, "intro/kelvoy_open.mp4"].includes(render.intro) ||
      ![null, "outro/kelvoy_close.mp4"].includes(render.outro))) {
    return c.json({ ok: false, error: "invalid_render_settings" }, 400);
  }
  if (render && checkContent([{ field: "title", text: render.title }]).length > 0) {
    return c.json({ ok: false, error: "content_blocked" }, 400);
  }
  const music = result.value.patch.music;
  if (music && !(music.file === "" && music.bpm === 0 && music.license === "" ||
      MUSIC_CATALOG.some((item) => item.file === music.file && item.bpm === music.bpm &&
        item.license === music.license))) {
    return c.json({ ok: false, error: "invalid_music_settings" }, 400);
  }

  const patchResult = await patchEpisode(
    loaded.episode.episode_id,
    result.value.row_version,
    result.value.patch,
  );
  if (!patchResult.ok) return patchErrorResponse(c, patchResult);
  return c.json({ ok: true, row_version: patchResult.row_version });
});

// FR-10: 把当前期的骨架/LUT/片头片尾/标题样式存为私有模板（M2-10, #32）。
// 骨架取自目的地的 type，LUT/标题样式取自角色的 style（Persona.style），
// 片头片尾取自期自己的 render.intro/outro——四处来源在建期时(POST /)已经
// 从 persona/destination/template 快照进了 episode.render，这里只是把它
// 们重新打包成一个新模板，不重新校验期的当前状态（存模板和期处于哪个
// status 无关，issue 没有限制）。
episodes.post("/:id/save-as-template", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const name = typeof body === "object" && body !== null ? (body as Record<string, unknown>).name : null;
  if (typeof name !== "string" || name.trim().length === 0) {
    return c.json({ ok: false, errors: ["name: 缺失或为空"] }, 400);
  }

  const [destination, persona] = await Promise.all([
    getDestination(loaded.episode.destination_id),
    getPersonaVersion(loaded.episode.persona_id, loaded.episode.persona_version),
  ]);
  if (!destination) return c.json({ ok: false, error: "destination_not_found" }, 404);
  if (!persona) return c.json({ ok: false, error: "persona_not_found" }, 404);

  const template: Template = {
    template_id: `t_${crypto.randomUUID()}`,
    owner_id: c.get("ownerId"),
    name,
    skeleton: destination.type,
    lut: persona.style.lut,
    intro: loaded.episode.render.intro,
    outro: loaded.episode.render.outro,
    title_style: persona.style.title_style,
  };
  await upsertTemplate(template);
  return c.json({ ok: true, template }, 201);
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

  const requestedKey = c.req.param("path");
  const legacyGridDownload = result.episode.mode === "grid" && !result.episode.final &&
    requestedKey === `final/${episodeId}.mp4`;
  if (requestedKey.startsWith("final/") &&
      !legacyGridDownload && (result.episode.status !== "done" ||
       requestedKey !== (result.episode.final?.key ?? `final/${episodeId}.mp4`))) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  const filePath = resolveArtifactPath(episodeId, requestedKey);
  if (!filePath) {
    return c.json({ ok: false, error: "invalid_path" }, 400);
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  return new Response(file);
});

// 审片台写路由（episode-review.ts）：URL 前缀和 owner 中间件都沿用这里的，
// 挂在具体路由都注册完之后，不影响上面 "/estimate" 先于 "/:id" 的顺序。
episodes.route("/", review);

export default episodes;
