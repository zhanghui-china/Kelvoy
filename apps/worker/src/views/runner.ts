import { claimViewsJob, completeViewsJob, failViewsJob, getSystemConfig, renewViewsJobLease, type ClaimedViewsJob } from "@kelvoy/store";
import { GenerationError } from "../generation/errors";
import { snapshotGenerationBackend } from "../generation/local";
import { callInference } from "../inference-client";
import { generateThreeViews, type GenerateDeps } from "./generate";
import { removePersonaFiles } from "./publish";

/**
 * Consumes persona_asset_jobs (ADR-0017). Attempt counting, requeue-or-fail and credit handling all live in
 * @kelvoy/store (VIEWS_JOB_MAX_ATTEMPTS); this file only reports one outcome per claim.
 */
export const VIEWS_JOB_TIMEOUT_MS = 20 * 60 * 1000; // 3 sequential image calls + stitching
export const VIEWS_HEARTBEAT_MS = 10_000; // lease is 90s; renew doubles as cancellation detection

export interface ViewsRunnerDeps extends Partial<GenerateDeps> {
  timeoutMs?: number;
  heartbeatMs?: number;
}

/** Stored in persona_asset_jobs.error and shown to users: fixed text only, never raw backend/path output. */
function failureMessage(error: unknown): string {
  if (error instanceof GenerationError) return error.diagnostic.message;
  return "三视图生成失败，请稍后重试。";
}

/** Claims and runs at most one job. Never throws: the poll loop must survive any single job. */
export async function runNextViewsJob(shutdown?: AbortSignal, deps: ViewsRunnerDeps = {}): Promise<boolean> {
  let job: ClaimedViewsJob | null;
  try { job = await claimViewsJob(); }
  catch (error) { console.warn("could not claim a views job", error instanceof Error ? error.message : error); return false; }
  if (!job) return false;
  try { await runViewsJob(job, shutdown, deps); }
  catch (error) { console.warn("views job crashed", job.job_id, error instanceof Error ? error.message : error); }
  return true;
}

export async function runViewsJob(job: ClaimedViewsJob, shutdown?: AbortSignal, deps: ViewsRunnerDeps = {}):
  Promise<void> {
  const execution = new AbortController();
  let timedOut = false;
  const abort = () => execution.abort();
  shutdown?.addEventListener("abort", abort, { once: true });
  if (shutdown?.aborted) abort();
  const timeoutMs = deps.timeoutMs ?? VIEWS_JOB_TIMEOUT_MS;
  const timeout = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing || execution.signal.aborted) return;
    renewing = true;
    // Renewal fails once the lease is lost or the job was cancelled; either way stop generating.
    renewViewsJobLease(job.job_id, job.lease_token)
      .then((active) => { if (!active) abort(); }, abort)
      .finally(() => { renewing = false; });
  }, deps.heartbeatMs ?? VIEWS_HEARTBEAT_MS);
  const report = (error: unknown) => failViewsJob({ job_id: job.job_id, lease_token: job.lease_token, error: failureMessage(error) });

  try {
    const backend = deps.backend ?? snapshotGenerationBackend(await getSystemConfig());
    execution.signal.throwIfAborted();
    const published = await generateThreeViews(
      { job_id: job.job_id, persona_id: job.persona_id, generation_id: job.generation_id,
        source_key: job.source_key, attempt: job.attempt },
      { call: deps.call ?? callInference, backend, ...(deps.compose ? { compose: deps.compose } : {}) },
      execution.signal);
    execution.signal.throwIfAborted();
    const done = await completeViewsJob({ job_id: job.job_id, lease_token: job.lease_token,
      expected_version: job.version, ...published });
    if (done.ok) return;
    // The store already abandoned the job for persona_gone / source_changed; lease_lost means someone else owns it.
    await removePersonaFiles(Object.values(published.views));
    if (done.error === "invalid_result") await report(new Error("invalid result"));
  } catch (error) {
    if (timedOut) { await report(new GenerationError({ stage: "inference_http", code: "generation_timeout",
      message: `三视图生成超过 ${Math.round(timeoutMs / 60000)} 分钟，已停止。`, elapsed_seconds: timeoutMs / 1000,
      budget_seconds: timeoutMs / 1000, cancellation: "unconfirmed" }, true)); return; }
    // Shutdown, cancellation or lease loss: no outcome to report. A shutdown leaves the lease to expire and be reclaimed.
    if (execution.signal.aborted) return;
    console.warn("views job failed", job.job_id, error instanceof Error ? error.name : "error");
    await report(error);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    shutdown?.removeEventListener("abort", abort);
  }
}
