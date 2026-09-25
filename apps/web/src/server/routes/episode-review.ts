import type { Episode, EpisodeStatus, RegenStage, StageName } from "@kelvoy/engine";
import {
  checkContent,
  checkScriptRules,
  isLegalShotStatusChange,
  removeShot,
  reorderShots,
  transitionEpisode,
  validatePatchShotRequest,
} from "@kelvoy/engine";
import type { PatchResult } from "@kelvoy/store";
import {
  enqueueTask,
  getDestination,
  patchEpisode,
  patchShot,
  replaceEpisode,
  setShare,
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
  episode: Episode,
  shotNo: number,
  rowVersion: number,
  regenStage: RegenStage,
  bad_shot_reported?: true,
): Promise<PatchResult> {
  const shot = episode.shots.find((item) => item.no === shotNo);
  if (!shot || !isLegalShotStatusChange(shot.status, "rejected")) {
    return { ok: false, error: "illegal_transition" };
  }
  const nextStatus = regenStage === "keyframe" ? "kf_review" : "clip_review";
  if (episode.status !== nextStatus &&
      !(episode.status === "done" || (episode.status === "clip_review" && nextStatus === "kf_review"))) {
    return { ok: false, error: "illegal_transition" };
  }
  if (regenStage === "video" && (!shot.kf_selected || !shot.candidates.includes(shot.kf_selected))) {
    return { ok: false, error: "illegal_transition" };
  }
  const updatedShot = { ...shot,
    status: "rejected",
    regen_stage: regenStage,
    ...(bad_shot_reported ? { bad_shot_reported } : {}),
  } as const;
  const result = await replaceEpisode(episode.episode_id, rowVersion, {
    ...episode,
    status: nextStatus,
    shots: episode.shots.map((item) => item.no === shotNo ? updatedShot : item),
  });
  if (result.ok) {
    await enqueueTask({ episode_id: episode.episode_id, stage: regenStage, shot_no: shotNo });
  }
  return result;
}

review.patch("/:id/shots/:no", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const result = validatePatchShotRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);
  const patch = result.value.patch;

  // 审核 1/2 改的这三个字段是用户自由输入的文本，和建期时的 season/tone/
  // banned 一样要过关键词拦截（PRD §8/§11，#29）——否则拦了建期这一处，
  // 用户在审片台里改 prompt 就绕过去了。
  const contentViolations = checkContent([
    ...(patch.beat !== undefined ? [{ field: "beat", text: patch.beat }] : []),
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
const REVIEW_GATE_ADVANCE: Partial<Record<EpisodeStatus, { stage: StageName; perShot: boolean }>> = {
  script_review: { stage: "assets", perShot: false },
  kf_review: { stage: "video", perShot: true },
  clip_review: { stage: "compose", perShot: false },
};

review.post("/:id/continue", async (c) => {
  const loaded = await loadOwnedEpisode(c.get("ownerId"), c.req.param("id"));
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const rowVersion = parseRowVersion(body);
  if (rowVersion === null) return c.json({ ok: false, error: "invalid_row_version" }, 400);

  const gate = REVIEW_GATE_ADVANCE[loaded.episode.status];
  if (!gate) return c.json({ ok: false, error: "illegal_transition" }, 400);
  if (loaded.episode.status === "kf_review" &&
      (!loaded.episode.shots.some((shot) => shot.status === "kf_selected") ||
       loaded.episode.shots.some((shot) =>
        !(shot.status === "approved" && !!shot.clip) &&
        (shot.status !== "kf_selected" || !shot.kf_selected || !shot.candidates.includes(shot.kf_selected))))) {
    return c.json({ ok: false, error: "keyframes_not_selected" }, 400);
  }
  if (loaded.episode.status === "clip_review" &&
      (loaded.episode.shots.length === 0 || loaded.episode.shots.some((shot) =>
        shot.status !== "approved" || !shot.clip))) {
    return c.json({ ok: false, error: "clips_not_approved" }, 400);
  }
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

review.post("/:id/shots/:no/regen", async (c) => {
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
  const result = await regenShotAndEnqueue(loaded.episode, shotNo, parsed.rowVersion, regenStage);
  if (!result.ok) return patchErrorResponse(c, result);
  return c.json({ ok: true, row_version: result.row_version });
});

review.post("/:id/shots/:no/remove", async (c) => {
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

review.post("/:id/recompose", async (c) => {
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

review.post("/:id/shots/:no/report-bad", async (c) => {
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
  const result = await regenShotAndEnqueue(loaded.episode, shotNo, parsed.rowVersion, regenStage, true);
  if (!result.ok) return patchErrorResponse(c, result);
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
