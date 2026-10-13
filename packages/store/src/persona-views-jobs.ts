import type { ThreeViews, ViewsGeneration } from "@kelvoy/engine";
import { finalizeCredits, reserveCredits } from "./credits";
import { getDb } from "./db";
import { readLivePersona, readTarget, withViewsState, writePersonaRevision } from "./persona-views-doc";
import type { ViewsState } from "./persona-views-doc";
import { TASK_LEASE_SECONDS } from "./tasks";

/**
 * 穿搭三视图生成任务队列（ADR-0017）。与 tasks 表分开：任务不属于任何 episode，不能放宽 tasks.episode_id。
 * 租约沿用 tasks 的口径（TASK_LEASE_SECONDS，过期可被重领，重领计一次尝试）；
 * 积分在创建时预留（kind persona_view，action_id = job_id），成功结算、终态失败/取消释放。
 */

/** 最多尝试两次：首次 + 一次重试。上限在 store 里强制，worker 无需自己数。 */
export const VIEWS_JOB_MAX_ATTEMPTS = 2;

export type ViewsJobStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type ViewsJobResult = { views: ThreeViews; views_gen: ViewsGeneration };
export type ViewsJob = {
  job_id: string; persona_id: string; owner_id: string; outfit_id: string | null;
  /** 创建 job 时（views_status 置 pending 之后）的角色版本。 */
  persona_version: number;
  source_key: string; status: ViewsJobStatus; attempt: number; generation_id: string;
  credit_action_id: string; error: string | null; result: ViewsJobResult | null;
  /** job 行乐观锁版本；每次状态变化 + 1。 */
  version: number; created_at: string; updated_at: string;
};
export type ClaimedViewsJob = ViewsJob & { lease_token: string };

interface JobRow {
  job_id: string; persona_id: string; owner_id: string; outfit_id: string | null; persona_version: number;
  source_key: string; status: ViewsJobStatus; attempt: number; generation_id: string; credit_action_id: string;
  error: string | null; result_json: string | null; prior_views_json: string | null; lease_token: string | null;
  lease_until: number | null; version: number; created_at: string; updated_at: string;
}

const COLUMNS = `job_id, persona_id, owner_id, outfit_id, persona_version, source_key, status, attempt, generation_id,
  credit_action_id, error, result_json, prior_views_json, lease_token, lease_until, version, created_at, updated_at`;

function toJob(row: JobRow): ViewsJob {
  return { job_id: row.job_id, persona_id: row.persona_id, owner_id: row.owner_id, outfit_id: row.outfit_id,
    persona_version: row.persona_version, source_key: row.source_key, status: row.status, attempt: row.attempt,
    generation_id: row.generation_id, credit_action_id: row.credit_action_id, error: row.error,
    result: row.result_json ? JSON.parse(row.result_json) as ViewsJobResult : null,
    version: row.version, created_at: row.created_at, updated_at: row.updated_at };
}

/** 事务内抛出以整体回滚（预留积分等副作用），外层转成错误结果。 */
class Abort<E extends string> extends Error { constructor(readonly code: E) { super(code); } }

function readJob(jobId: string): JobRow | null {
  return getDb().query<JobRow, [string]>(`select ${COLUMNS} from persona_asset_jobs where job_id = ?`).get(jobId);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const clip = (text: string) => text.slice(0, 500);

export type CreateViewsJobResult =
  | { ok: true; job: ViewsJob; repeated: boolean }
  | { ok: false; error: "not_found" | "outfit_not_found" | "no_source" | "already_ready" | "job_active" | "insufficient_credits" | "invalid_persona" };

/**
 * 原子：校验归属与 source → 预留积分 → 插 job → 目标 views_status 置 pending（角色修订 version + 1，
 * 旧 views 从当前文档移除，因为 engine 规定 views 仅 ready 时存在；旧文件与旧修订原样保留）。
 * 幂等：同一目标同一 source 已有在途 job 时返回它（repeated: true），不重复预留积分。
 * 已 ready 的目标须显式 `regenerate: true` 才会重新生成。
 */
export async function createViewsJob(input: {
  persona_id: string; owner_id: string; outfit_id: string | null; regenerate?: boolean;
}): Promise<CreateViewsJobResult> {
  const database = getDb();
  try {
    return database.transaction((): CreateViewsJobResult => {
      const persona = readLivePersona(input.persona_id);
      if (!persona || persona.owner_id !== input.owner_id) return { ok: false, error: "not_found" };
      const target = readTarget(persona, input.outfit_id);
      if (!target) return { ok: false, error: "outfit_not_found" };
      if (!target.source) return { ok: false, error: "no_source" };
      const active = database.query<JobRow, [string, string]>(
        `select ${COLUMNS} from persona_asset_jobs where persona_id = ? and coalesce(outfit_id, '') = ?
         and status in ('pending', 'processing')`,
      ).get(input.persona_id, input.outfit_id ?? "");
      if (active) {
        return active.source_key === target.source ? { ok: true, job: toJob(active), repeated: true }
          : { ok: false, error: "job_active" };
      }
      if (target.state.views_status === "ready" && !input.regenerate) return { ok: false, error: "already_ready" };
      const pending = writePersonaRevision(persona, withViewsState(persona, input.outfit_id, { views_status: "pending" }));
      if (!pending) return { ok: false, error: "invalid_persona" };
      const jobId = `pvj_${crypto.randomUUID()}`;
      const reserved = reserveCredits({ action_id: jobId, user_id: input.owner_id, kind: "persona_view", units: 1 });
      if (!reserved.ok) throw new Abort(reserved.error === "insufficient_credits" ? "insufficient_credits" : "not_found");
      const prior = target.state.views_status === "ready" && target.state.views && target.state.views_gen
        ? JSON.stringify({ views: target.state.views, views_gen: target.state.views_gen }) : null;
      database.query(`insert into persona_asset_jobs (job_id, persona_id, owner_id, outfit_id, persona_version,
        source_key, generation_id, credit_action_id, prior_views_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(jobId, input.persona_id, input.owner_id, input.outfit_id, pending.version, target.source,
          `vg_${crypto.randomUUID()}`, jobId, prior);
      return { ok: true, job: toJob(readJob(jobId)!), repeated: false };
    }).immediate();
  } catch (error) {
    if (error instanceof Abort) return { ok: false, error: error.code };
    throw error;
  }
}

/**
 * 放弃一个在途 job：释放积分、job 置终态，并把目标从 pending 还原（有旧三视图则回到 ready，
 * 否则首次生成失败 → failed、取消 → 缺省）。角色已删除或目标已被他人改动（不再 pending）时不动文档。
 */
function abandon(row: JobRow, status: "failed" | "cancelled", error: string): void {
  const database = getDb();
  finalizeCredits(row.credit_action_id, "released");
  const persona = readLivePersona(row.persona_id);
  const target = persona ? readTarget(persona, row.outfit_id) : null;
  if (persona && target && target.state.views_status === "pending") {
    const prior = row.prior_views_json ? JSON.parse(row.prior_views_json) as ViewsState : null;
    const state: ViewsState = prior ? { views: prior.views, views_gen: prior.views_gen, views_status: "ready" }
      : status === "failed" ? { views_status: "failed" } : {};
    writePersonaRevision(persona, withViewsState(persona, row.outfit_id, state));
  }
  database.query(`update persona_asset_jobs set status = ?, error = ?, lease_token = null, lease_until = null,
    version = version + 1, updated_at = datetime('now') where job_id = ?`).run(status, clip(error), row.job_id);
}

/** Worker 领取最早的待处理 job，或租约已过期的 processing job（重领计一次尝试）。 */
export async function claimViewsJob(): Promise<ClaimedViewsJob | null> {
  const database = getDb();
  const leaseUntil = nowSeconds() + TASK_LEASE_SECONDS;
  const leaseToken = `lease_${crypto.randomUUID()}`;
  return database.transaction(() => {
    // 已用完尝试次数的过期 job 不再重领，直接终态失败（释放积分）。
    for (const row of database.query<JobRow, [number]>(
      `select ${COLUMNS} from persona_asset_jobs where status = 'processing'
       and (lease_until is null or lease_until <= unixepoch('now')) and attempt >= ?`,
    ).all(VIEWS_JOB_MAX_ATTEMPTS)) abandon(row, "failed", "lease expired after the last attempt");
    const row = database.query<JobRow, [number, string]>(
      `update persona_asset_jobs set status = 'processing',
         attempt = attempt + case when status = 'processing' then 1 else 0 end,
         lease_until = ?, lease_token = ?, version = version + 1, updated_at = datetime('now')
       where job_id = (select job_id from persona_asset_jobs
         where status = 'pending' or (status = 'processing' and (lease_until is null or lease_until <= unixepoch('now')))
         order by created_at asc, rowid asc limit 1)
       returning ${COLUMNS}`,
    ).get(leaseUntil, leaseToken);
    return row ? { ...toJob(row), lease_token: leaseToken } : null;
  }).immediate();
}

export async function renewViewsJobLease(jobId: string, leaseToken: string): Promise<boolean> {
  return getDb().query(`update persona_asset_jobs set lease_until = ?, updated_at = datetime('now')
    where job_id = ? and lease_token = ? and status = 'processing' and lease_until > unixepoch('now')`)
    .run(nowSeconds() + TASK_LEASE_SECONDS, jobId, leaseToken).changes === 1;
}

function ownsLease(row: JobRow | null, leaseToken: string): row is JobRow {
  return !!row && row.status === "processing" && row.lease_token === leaseToken &&
    row.lease_until !== null && row.lease_until > nowSeconds();
}

export type CompleteViewsJobResult =
  | { ok: true; job: ViewsJob }
  | { ok: false; error: "not_found" | "lease_lost" | "version_conflict" | "persona_gone" | "source_changed" | "invalid_result" };

/**
 * 原子：写入 views 四个 key 与 views_gen、views_status = ready（角色修订 + 1）、结算积分、job succeeded。
 * `expected_version` 是 claim 返回的 job.version（乐观锁）。角色在此期间被删或源图变了：放弃并释放积分。
 * 其间角色的其他编辑（改名等）不影响提交，只比对 source 与 pending 状态。
 */
export async function completeViewsJob(input: {
  job_id: string; lease_token: string; expected_version: number;
  views: ThreeViews; views_gen: ViewsGeneration;
}): Promise<CompleteViewsJobResult> {
  const database = getDb();
  return database.transaction((): CompleteViewsJobResult => {
    const row = readJob(input.job_id);
    if (!row) return { ok: false, error: "not_found" };
    if (!ownsLease(row, input.lease_token)) return { ok: false, error: "lease_lost" };
    if (row.version !== input.expected_version) return { ok: false, error: "version_conflict" };
    const persona = readLivePersona(row.persona_id);
    if (!persona) {
      abandon(row, "cancelled", "persona deleted");
      return { ok: false, error: "persona_gone" };
    }
    const target = readTarget(persona, row.outfit_id);
    if (!target || target.source !== row.source_key || target.state.views_status !== "pending") {
      abandon(row, "cancelled", "source changed");
      return { ok: false, error: "source_changed" };
    }
    const ready = writePersonaRevision(persona, withViewsState(persona, row.outfit_id,
      { views: input.views, views_status: "ready", views_gen: input.views_gen }));
    if (!ready) return { ok: false, error: "invalid_result" }; // 无副作用；由 worker 走 failViewsJob
    const settled = finalizeCredits(row.credit_action_id, "settled");
    if (!settled.ok) throw new Error(`views job credit settle failed: ${settled.error}`);
    database.query(`update persona_asset_jobs set status = 'succeeded', error = null, result_json = ?,
      lease_token = null, lease_until = null, version = version + 1, updated_at = datetime('now') where job_id = ?`)
      .run(JSON.stringify({ views: input.views, views_gen: input.views_gen } satisfies ViewsJobResult), row.job_id);
    return { ok: true, job: toJob(readJob(row.job_id)!) };
  }).immediate();
}

export type FailViewsJobResult =
  | { ok: true; outcome: "requeued" | "failed"; job: ViewsJob }
  | { ok: false; error: "not_found" | "lease_lost" };

/** 失败重试语义：未用完 VIEWS_JOB_MAX_ATTEMPTS 则回到 pending（attempt + 1，积分保持预留）；否则终态 failed 并释放积分。 */
export async function failViewsJob(input: { job_id: string; lease_token: string; error: string }):
  Promise<FailViewsJobResult> {
  const database = getDb();
  return database.transaction((): FailViewsJobResult => {
    const row = readJob(input.job_id);
    if (!row) return { ok: false, error: "not_found" };
    if (!ownsLease(row, input.lease_token)) return { ok: false, error: "lease_lost" };
    if (row.attempt < VIEWS_JOB_MAX_ATTEMPTS) {
      database.query(`update persona_asset_jobs set status = 'pending', attempt = attempt + 1, error = ?,
        lease_token = null, lease_until = null, version = version + 1, updated_at = datetime('now') where job_id = ?`)
        .run(clip(input.error), row.job_id);
      return { ok: true, outcome: "requeued", job: toJob(readJob(row.job_id)!) };
    }
    abandon(row, "failed", input.error);
    return { ok: true, outcome: "failed", job: toJob(readJob(row.job_id)!) };
  }).immediate();
}

export type CancelViewsJobResult =
  | { ok: true; job: ViewsJob; repeated: boolean }
  | { ok: false; error: "not_found" | "not_cancellable" };

/** 用户取消在途 job：释放积分并还原目标状态；处理中的 worker 之后提交会得到 lease_lost。 */
export async function cancelViewsJob(jobId: string, ownerId: string): Promise<CancelViewsJobResult> {
  return getDb().transaction((): CancelViewsJobResult => {
    const row = readJob(jobId);
    if (!row || row.owner_id !== ownerId) return { ok: false, error: "not_found" };
    if (row.status === "cancelled") return { ok: true, job: toJob(row), repeated: true };
    if (row.status !== "pending" && row.status !== "processing") return { ok: false, error: "not_cancellable" };
    abandon(row, "cancelled", "cancelled by user");
    return { ok: true, job: toJob(readJob(jobId)!), repeated: false };
  }).immediate();
}

/** deletePersona 在同一事务里调用：角色已软删，在途 job 取消并释放积分（不再还原文档）。 */
export function cancelViewsJobsForPersona(personaId: string): number {
  const rows = getDb().query<JobRow, [string]>(
    `select ${COLUMNS} from persona_asset_jobs where persona_id = ? and status in ('pending', 'processing')`,
  ).all(personaId);
  for (const row of rows) abandon(row, "cancelled", "persona deleted");
  return rows.length;
}

export async function getViewsJob(jobId: string, ownerId: string): Promise<ViewsJob | null> {
  const row = readJob(jobId);
  return row && row.owner_id === ownerId ? toJob(row) : null;
}

export async function listViewsJobs(personaId: string, ownerId: string, limit = 50): Promise<ViewsJob[]> {
  return getDb().query<JobRow, [string, string, number]>(
    `select ${COLUMNS} from persona_asset_jobs where persona_id = ? and owner_id = ?
     order by created_at desc, rowid desc limit ?`,
  ).all(personaId, ownerId, Math.max(1, Math.min(200, limit))).map(toJob);
}
