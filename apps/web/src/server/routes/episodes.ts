import { join, resolve, sep } from "node:path";
import type { Episode, EpisodeStatus, RegenStage, StageName, Template } from "@kelvoy/engine";
import {
  checkContent,
  checkScriptRules,
  removeShot,
  transitionEpisode,
  validateCreateEpisodeRequest,
  validatePatchEpisodeRequest,
  validatePatchShotRequest,
} from "@kelvoy/engine";
import type { GetEpisodeResult, PatchResult } from "@kelvoy/store";
import {
  enqueueTask,
  getDestination,
  getEpisode,
  getPersona,
  getTemplate,
  insertEpisode,
  listEpisodes,
  patchEpisode,
  patchShot,
  replaceEpisode,
  upsertTemplate,
} from "@kelvoy/store";
import type { Context } from "hono";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-01/FR-05/FR-08: 建期/期列表/详情/产物文件/审片台写路由.
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

  // MVP 内容审核（PRD §8/§11，#29）：建期时用户能填的自由文本只有这三项，
  // 命中直接拦截，不浪费后面的外键查询和写库。
  const contentViolations = checkContent([
    ...(req.season !== undefined ? [{ field: "season", text: req.season }] : []),
    ...(req.tone !== undefined ? [{ field: "tone", text: req.tone }] : []),
    ...(req.banned ?? []).map((term, i) => ({ field: `banned[${i}]`, text: term })),
  ]);
  if (contentViolations.length > 0) {
    return c.json({ ok: false, error: "content_blocked", violations: contentViolations }, 400);
  }

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

// ---- 审片台写路由 (M2-6, FR-05/FR-08) ----

async function loadOwnedEpisode(
  ownerId: string,
  episodeId: string,
): Promise<Extract<GetEpisodeResult, { ok: true }> | null> {
  const result = await getEpisode(episodeId);
  if (!result.ok || result.episode.owner_id !== ownerId) return null;
  return result;
}

// packages/store's patch/replace functions all share this ok:false shape —
// one mapping to HTTP status for every write route below.
function patchErrorResponse(c: Context, result: Extract<PatchResult, { ok: false }>) {
  switch (result.error) {
    case "not_found":
      return c.json({ ok: false, error: "not_found" }, 404);
    case "illegal_transition":
      return c.json({ ok: false, error: "illegal_transition" }, 400);
    case "version_conflict":
      return c.json(
        { ok: false, error: "version_conflict", current_row_version: result.current_row_version },
        409,
      );
  }
}

function parseRowVersion(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as Record<string, unknown>).row_version;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseRegenBody(body: unknown): { rowVersion: number; regenStage?: RegenStage } | null {
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return null;
  const regenStage = (body as Record<string, unknown>).regen_stage;
  if (regenStage === undefined) return { rowVersion };
  if (regenStage !== "keyframe" && regenStage !== "video") return null;
  return { rowVersion, regenStage };
}

// REGEN_SOURCE_STATES (packages/engine/src/state/shot.ts) is kf_ready |
// clip_ready | approved — a still-unselected keyframe set means the
// reviewer wants new candidates, anything past keyframe selection means
// they want the clip redone with the keyframe kept.
function inferRegenStage(shotStatus: string): RegenStage {
  return shotStatus === "kf_ready" ? "keyframe" : "video";
}

async function regenShotAndEnqueue(
  episodeId: string,
  shotNo: number,
  rowVersion: number,
  regenStage: RegenStage,
  bad_shot_reported?: true,
): Promise<PatchResult> {
  const result = await patchShot(episodeId, shotNo, rowVersion, {
    status: "rejected",
    regen_stage: regenStage,
    ...(bad_shot_reported ? { bad_shot_reported } : {}),
  });
  if (result.ok) {
    await enqueueTask({ episode_id: episodeId, stage: regenStage, shot_no: shotNo });
  }
  return result;
}

episodes.patch("/:id", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const result = validatePatchEpisodeRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const patchResult = await patchEpisode(
    loaded.episode.episode_id,
    result.value.row_version,
    result.value.patch,
  );
  if (!patchResult.ok) return patchErrorResponse(c, patchResult);
  return c.json({ ok: true, row_version: patchResult.row_version });
});

episodes.patch("/:id/shots/:no", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const result = validatePatchShotRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const patchResult = await patchShot(
    loaded.episode.episode_id,
    Number(c.req.param("no")),
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
    getPersona(loaded.episode.persona_id),
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

// 三个人工审核点各自的"继续"动作——下一个生成态用哪个 stage、是否要按镜
// 拆分任务，是 apps/web 这一层的决定（engine 的状态机只知道 script_review
// 的下一个合法状态是 assets，不知道那对应哪个 StageName）。assets/compose
// 是整期一个任务；kf_review -> clipping 每镜各生成一次视频，所以要给
// 已经选定关键帧(kf_selected)的镜各发一条带 shot_no 的任务。
const REVIEW_GATE_ADVANCE: Partial<Record<EpisodeStatus, { stage: StageName; perShot: boolean }>> = {
  script_review: { stage: "assets", perShot: false },
  kf_review: { stage: "video", perShot: true },
  clip_review: { stage: "compose", perShot: false },
};

episodes.post("/:id/continue", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);

  const gate = REVIEW_GATE_ADVANCE[loaded.episode.status];
  if (!gate) return c.json({ ok: false, error: "illegal_transition" }, 400);
  const nextStatus = transitionEpisode(loaded.episode.status, { type: "advance" });

  const patchResult = await patchEpisode(loaded.episode.episode_id, rowVersion, { status: nextStatus });
  if (!patchResult.ok) return patchErrorResponse(c, patchResult);

  if (gate.perShot) {
    const readyShots = loaded.episode.shots.filter((s) => s.status === "kf_selected");
    await Promise.all(
      readyShots.map((s) =>
        enqueueTask({ episode_id: loaded.episode.episode_id, stage: gate.stage, shot_no: s.no }),
      ),
    );
  } else {
    await enqueueTask({ episode_id: loaded.episode.episode_id, stage: gate.stage });
  }

  return c.json({ ok: true, row_version: patchResult.row_version });
});

episodes.post("/:id/shots/:no/regen", async (c) => {
  const episodeId = c.req.param("id");
  const shotNo = Number(c.req.param("no"));
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const shot = loaded.episode.shots.find((s) => s.no === shotNo);
  if (!shot) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = parseRegenBody(body);
  if (!parsed) return c.json({ ok: false, error: "invalid_body" }, 400);

  const regenStage = parsed.regenStage ?? inferRegenStage(shot.status);
  const result = await regenShotAndEnqueue(episodeId, shotNo, parsed.rowVersion, regenStage);
  if (!result.ok) return patchErrorResponse(c, result);
  return c.json({ ok: true, row_version: result.row_version });
});

episodes.post("/:id/shots/:no/remove", async (c) => {
  const episodeId = c.req.param("id");
  const shotNo = Number(c.req.param("no"));
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const shot = loaded.episode.shots.find((s) => s.no === shotNo);
  if (!shot) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);

  let updated: Episode;
  try {
    updated = removeShot(loaded.episode, shotNo);
  } catch {
    return c.json({ ok: false, error: "below_min_shots" }, 400);
  }

  // FR-02 是固定产品规则（不是 M0 待测数字），删镜后一样要过——不重新校验
  // 的话，删掉唯一的地标镜之类会静默产出一份不合规的分镜表。
  const destination = await getDestination(loaded.episode.destination_id);
  if (!destination) return c.json({ ok: false, error: "destination_not_found" }, 404);
  const violations = checkScriptRules(updated.shots, destination);
  if (violations.length > 0) {
    return c.json({ ok: false, error: "script_rule_violation", violations }, 400);
  }

  const result = await replaceEpisode(episodeId, rowVersion, updated);
  if (!result.ok) return patchErrorResponse(c, result);
  return c.json({ ok: true, row_version: result.row_version });
});

episodes.post("/:id/recompose", async (c) => {
  const episodeId = c.req.param("id");
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  // patchEpisode 的合法性检查只问"能不能转到 composing"，clip_review 通过
  // /continue 也能到 composing——这里要求必须来自 done，否则会和 /continue
  // 的正常推进撞在一起。
  if (loaded.episode.status !== "done") {
    return c.json({ ok: false, error: "illegal_transition" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);

  const result = await patchEpisode(episodeId, rowVersion, { status: "composing" });
  if (!result.ok) return patchErrorResponse(c, result);

  await enqueueTask({ episode_id: episodeId, stage: "compose" });
  return c.json({ ok: true, row_version: result.row_version });
});

episodes.post("/:id/shots/:no/report-bad", async (c) => {
  const episodeId = c.req.param("id");
  const shotNo = Number(c.req.param("no"));
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const shot = loaded.episode.shots.find((s) => s.no === shotNo);
  if (!shot) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = parseRegenBody(body);
  if (!parsed) return c.json({ ok: false, error: "invalid_body" }, 400);

  // FR-06: 免费重生成一次——不涉及积分扣减/次数上限，那是 M0-6 定价公式
  // 落地之后的事，这里只负责把镜标记为坏镜并触发一次重生成。
  const regenStage = parsed.regenStage ?? inferRegenStage(shot.status);
  const result = await regenShotAndEnqueue(episodeId, shotNo, parsed.rowVersion, regenStage, true);
  if (!result.ok) return patchErrorResponse(c, result);
  return c.json({ ok: true, row_version: result.row_version });
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
