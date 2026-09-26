import type { Episode, EpisodeStatus, RegenStage } from "@kelvoy/engine";
import {
  checkContent,
  checkScriptRules,
  removeShot,
  reorderShots,
  transitionEpisode,
  validatePatchShotRequest,
} from "@kelvoy/engine";
import {
  getDestination,
  patchShot,
  replaceEpisode,
  setShare,
  submitReviewAdvance,
  submitShotRegeneration,
  submitScriptAction,
  submitFailedTaskRetry,
  convertLegacyCuts,
} from "@kelvoy/store";
import { Hono } from "hono";
import { loadOwnedEpisode, parseRowVersion, patchErrorResponse } from "./episode-common";

/**
 * 审片台的写路由（M2-6 起，FR-05/FR-08/#31）：改镜、重排、继续、重生成、
 * 删镜、报坏镜、重新合成。挂在 episodes.ts 里（`episodes.route("/", review)`）
 * ——URL 还是 /api/episodes/*，requireOwner 也由父路由统一挂；拆成两个文件
 * 只是因为 episodes.ts 加完 #31 的两条路由就超了 500 行上限。
 */
const review = new Hono();

review.post("/:id/convert-cuts", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);
  const result = convertLegacyCuts({ episode_id: loaded.episode.episode_id,
    owner_id: c.get("ownerId"), row_version: rowVersion });
  if (!result.ok) return c.json(result, result.error === "version_conflict" ? 409 :
    result.error === "not_found" ? 404 : 400);
  return c.json(result);
});

review.post("/:id/retry", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);
  const result = submitFailedTaskRetry({ episode_id: loaded.episode.episode_id,
    owner_id: c.get("ownerId"), row_version: rowVersion });
  if (!result.ok) return c.json(result, result.error === "insufficient_credits" ? 402 :
    result.error === "version_conflict" ? 409 : result.error === "not_found" ? 404 : 400);
  return c.json(result);
});

review.post("/:id/script/:action", async (c) => {
  const action = c.req.param("action");
  if (action !== "regenerate" && action !== "optimize") {
    return c.json({ ok: false, error: "invalid_action" }, 400);
  }
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.mode === "grid") return c.json({ ok: false, error: "grid_unavailable" }, 400);
  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (action === "optimize" && (instruction.length === 0 || instruction.length > 500)) {
    return c.json({ ok: false, error: "invalid_instruction" }, 400);
  }
  const violations = checkContent([{ field: "instruction", text: instruction }]);
  if (violations.length > 0) return c.json({ ok: false, error: "content_blocked", violations }, 400);
  const result = submitScriptAction({
    episode_id: loaded.episode.episode_id, owner_id: c.get("ownerId"), row_version: rowVersion,
    operation: action === "optimize" ? "script_optimize" : "script_regenerate",
    ...(action === "optimize" ? { instruction } : {}),
  });
  if (!result.ok) {
    if (result.error === "not_found") return c.json({ ok: false, error: "not_found" }, 404);
    if (result.error === "insufficient_credits") return c.json({ ok: false, error: "insufficient_credits" }, 402);
    if (result.error === "version_conflict") return c.json(result, 409);
    return c.json(result, 400);
  }
  return c.json({ ok: true, row_version: result.row_version, task_id: result.task.task_id });
});

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

review.patch("/:id/shots/:no", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.script_pending_task_id) return c.json({ ok: false, error: "action_pending" }, 400);

  const body = await c.req.json().catch(() => null);
  const result = validatePatchShotRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);
  const patch = { ...result.value.patch };
  const shot = loaded.episode.shots.find((item) => item.no === Number(c.req.param("no")));
  if (!shot) return c.json({ ok: false, error: "not_found" }, 404);
  const scriptFields = ["beat", "caption", "size", "camera", "landmark", "kf_prompt", "motion_prompt"];
  const keys = Object.keys(patch);
  const scriptEdit = loaded.episode.status === "script_review" && keys.every((key) => scriptFields.includes(key));
  const keyframeEdit = loaded.episode.status === "kf_review" &&
    keys.every((key) => ["kf_selected", "status", "kf_prompt", "motion_prompt"].includes(key)) &&
    (patch.status === undefined || patch.status === "kf_selected") &&
    (patch.status === undefined || shot.status === "kf_ready") &&
    (patch.kf_selected === undefined || (patch.kf_selected !== null && shot.candidates.includes(patch.kf_selected)));
  const clipEdit = loaded.episode.status === "clip_review" &&
    keys.every((key) => ["trim_start_s", "status"].includes(key)) &&
    (patch.status === undefined || (patch.status === "approved" && shot.status === "clip_ready"));
  if (keys.length === 0 || (!scriptEdit && !keyframeEdit && !clipEdit)) {
    return c.json({ ok: false, error: "invalid_public_patch" }, 400);
  }
  if (loaded.episode.cut_policy === "fixed_1s" && patch.trim_start_s !== undefined && patch.trim_start_s !== null) {
    patch.trim_start_s = Math.round(patch.trim_start_s * 30) / 30;
  }

  // 审核 1/2 改的这三个字段是用户自由输入的文本，和建期时的 season/tone/
  // banned 一样要过关键词拦截（PRD §8/§11，#29）——否则拦了建期这一处，
  // 用户在审片台里改 prompt 就绕过去了。
  const contentViolations = checkContent([
    ...(patch.beat !== undefined ? [{ field: "beat", text: patch.beat }] : []),
    ...(patch.caption !== undefined ? [{ field: "caption", text: patch.caption }] : []),
    ...(patch.kf_prompt !== undefined ? [{ field: "kf_prompt", text: patch.kf_prompt }] : []),
    ...(patch.motion_prompt !== undefined
      ? [{ field: "motion_prompt", text: patch.motion_prompt }]
      : []),
  ]);
  if (contentViolations.length > 0) {
    return c.json({ ok: false, error: "content_blocked", violations: contentViolations }, 400);
  }

  // FR-02 的 landmark_reference 规则：改地标引用时立刻查，不要等到删镜/
  // 重排时才由 checkScriptRules 把一个早就写坏的值报出来。
  if (patch.landmark !== undefined && patch.landmark !== null) {
    const destination = await getDestination(loaded.episode.destination_id);
    if (!destination) return c.json({ ok: false, error: "destination_not_found" }, 404);
    if (!destination.landmarks.some((l) => l.id === patch.landmark)) {
      return c.json({ ok: false, error: "landmark_reference" }, 400);
    }
  }

  const patchResult = await patchShot(
    loaded.episode.episode_id,
    Number(c.req.param("no")),
    result.value.row_version,
    patch,
  );
  if (!patchResult.ok) return patchErrorResponse(c, patchResult);
  return c.json({ ok: true, row_version: patchResult.row_version });
});

// FR-05/§4 审核 1「可改镜头顺序」。整表重排而不是单镜改 no：no 必须保持
// 1..n 连续，一次只挪一镜的接口没法在服务端保证这一点。reorderShots 自己
// 守住"只能在 script_review 阶段"这条前提（重编号会让已有产物 key 对不
// 上），这里只负责解析请求和重排后的 FR-02 复查。
review.post("/:id/shots/reorder", async (c) => {
  const episodeId = c.req.param("id");
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.script_pending_task_id) return c.json({ ok: false, error: "action_pending" }, 400);

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);
  const order = (body as Record<string, unknown>).order;
  if (!Array.isArray(order) || !order.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return c.json({ ok: false, error: "invalid_order" }, 400);
  }

  let updated: Episode;
  try {
    updated = reorderShots(loaded.episode, order as number[]);
  } catch {
    return c.json({ ok: false, error: "invalid_order" }, 400);
  }

  // 顺序一变 size_run（同景别不得连续 >2 镜）就可能违规，和删镜一样必须
  // 重跑 FR-02，违规就整单驳回、一行都不写。
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

// 三个人工审核点各自的"继续"动作——下一个生成态用哪个 stage、是否要按镜
// 拆分任务，是 apps/web 这一层的决定（engine 的状态机只知道 script_review
// 的下一个合法状态是 assets，不知道那对应哪个 StageName）。assets/compose
// 是整期一个任务；kf_review -> clipping 每镜各生成一次视频，所以要给
// 已经选定关键帧(kf_selected)的镜各发一条带 shot_no 的任务。
const REVIEW_GATE_ADVANCE: EpisodeStatus[] = ["script_review", "kf_review", "clip_review", "compose_ready"];

review.post("/:id/continue", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.mode === "grid") return c.json({ ok: false, error: "grid_unavailable" }, 400);
  if (loaded.episode.script_pending_task_id) return c.json({ ok: false, error: "action_pending" }, 400);

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);

  if (!REVIEW_GATE_ADVANCE.includes(loaded.episode.status)) return c.json({ ok: false, error: "illegal_transition" }, 400);
  if (loaded.episode.status === "kf_review" &&
      (!loaded.episode.shots.some((shot) => shot.status === "kf_selected") ||
       loaded.episode.shots.some((shot) =>
        !(shot.status === "approved" && !!shot.clip) &&
        (shot.status !== "kf_selected" || !shot.kf_selected || !shot.candidates.includes(shot.kf_selected))))) {
    return c.json({ ok: false, error: "keyframes_not_selected" }, 400);
  }
  if ((loaded.episode.status === "clip_review" || loaded.episode.status === "compose_ready") &&
      (loaded.episode.shots.length === 0 || loaded.episode.shots.some((shot) =>
        shot.status !== "approved" || !shot.clip))) {
    return c.json({ ok: false, error: "clips_not_approved" }, 400);
  }
  const nextStatus = loaded.episode.status === "clip_review" && loaded.episode.cut_policy === "fixed_1s"
    ? transitionEpisode(loaded.episode.status, { type: "prepare_compose" })
    : transitionEpisode(loaded.episode.status, { type: "advance" });

  const advanced = submitReviewAdvance({ episode_id: loaded.episode.episode_id,
    owner_id: c.get("ownerId"), row_version: rowVersion, next_status: nextStatus });
  if (!advanced.ok) {
    if (advanced.error === "insufficient_credits") return c.json({ ok: false, error: advanced.error }, 402);
    if (advanced.error === "version_conflict") return c.json(advanced, 409);
    if (advanced.error === "not_found") return c.json(advanced, 404);
    return c.json(advanced, 400);
  }
  return c.json({ ok: true, row_version: advanced.row_version });
});

review.post("/:id/shots/:no/regen", async (c) => {
  const episodeId = c.req.param("id");
  const shotNo = Number(c.req.param("no"));
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.mode === "grid") return c.json({ ok: false, error: "grid_unavailable" }, 400);

  const shot = loaded.episode.shots.find((s) => s.no === shotNo);
  if (!shot) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = parseRegenBody(body);
  if (!parsed) return c.json({ ok: false, error: "invalid_body" }, 400);

  const regenStage = parsed.regenStage ?? inferRegenStage(shot.status);
  const result = submitShotRegeneration({ episode_id: episodeId, owner_id: c.get("ownerId"),
    row_version: parsed.rowVersion, shot_no: shotNo, stage: regenStage, report_bad: false });
  if (!result.ok) {
    if (result.error === "insufficient_credits") return c.json(result, 402);
    if (result.error === "version_conflict") return c.json(result, 409);
    return c.json(result, result.error === "not_found" ? 404 : 400);
  }
  return c.json({ ok: true, row_version: result.row_version });
});

review.post("/:id/shots/:no/remove", async (c) => {
  const episodeId = c.req.param("id");
  const shotNo = Number(c.req.param("no"));
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.script_pending_task_id) return c.json({ ok: false, error: "action_pending" }, 400);

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

review.post("/:id/recompose", async (c) => {
  const episodeId = c.req.param("id");
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.mode === "grid") return c.json({ ok: false, error: "grid_unavailable" }, 400);

  // 重新合成仅从已完成作品发起，和正常审核推进分开。
  if (loaded.episode.status !== "done") {
    return c.json({ ok: false, error: "illegal_transition" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);

  const result = submitReviewAdvance({ episode_id: episodeId, owner_id: c.get("ownerId"),
    row_version: rowVersion, next_status: "composing" });
  if (!result.ok) {
    if (result.error === "insufficient_credits") return c.json(result, 402);
    if (result.error === "version_conflict") return c.json(result, 409);
    return c.json(result, result.error === "not_found" ? 404 : 400);
  }
  return c.json({ ok: true, row_version: result.row_version });
});

review.post("/:id/shots/:no/report-bad", async (c) => {
  const episodeId = c.req.param("id");
  const shotNo = Number(c.req.param("no"));
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);
  if (loaded.episode.mode === "grid") return c.json({ ok: false, error: "grid_unavailable" }, 400);

  const shot = loaded.episode.shots.find((s) => s.no === shotNo);
  if (!shot) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = parseRegenBody(body);
  if (!parsed) return c.json({ ok: false, error: "invalid_body" }, 400);

  // FR-06: 免费重生成一次——不涉及积分扣减/次数上限，那是 M0-6 定价公式
  // 落地之后的事，这里只负责把镜标记为坏镜并触发一次重生成。
  const regenStage = parsed.regenStage ?? inferRegenStage(shot.status);
  const result = submitShotRegeneration({ episode_id: episodeId, owner_id: c.get("ownerId"),
    row_version: parsed.rowVersion, shot_no: shotNo, stage: regenStage, report_bad: true });
  if (!result.ok) {
    if (result.error === "insufficient_credits") return c.json(result, 402);
    if (result.error === "version_conflict") return c.json(result, 409);
    return c.json(result, result.error === "not_found" ? 404 : 400);
  }
  return c.json({ ok: true, row_version: result.row_version });
});

// FR-12：开关分享。slug 生成锁在 packages/store 的 setShare 里，不接受
// 调用方传 slug——关掉分享不清 slug，链接发出去了不该失效，重新开启
// 拿回同一个。
review.post("/:id/share", async (c) => {
  const episodeId = c.req.param("id");
  const loaded = await loadOwnedEpisode(c.get("ownerId"), episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  const enabled = (body as Record<string, unknown> | null)?.enabled;
  if (rowVersion === null || typeof enabled !== "boolean") {
    return c.json({ ok: false, error: "invalid_body" }, 400);
  }

  const result = await setShare(episodeId, rowVersion, enabled);
  if (!result.ok) return patchErrorResponse(c, result);
  return c.json({ ok: true, row_version: result.row_version, slug: result.slug });
});

export default review;
