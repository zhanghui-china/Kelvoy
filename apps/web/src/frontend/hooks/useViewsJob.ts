import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ViewsStatus } from "@kelvoy/engine";
import { cancelViewsJob, createViewsJob, getViewsJob, listViewsJobs } from "../api/client";
import { isViewsJobActive, type ViewsJobView } from "../../shared/views-job";
import { pickJobForTarget } from "../pages/views-view";
import { describeWriteError } from "../review/errors";
import { singleFlight } from "./singleFlight";

const POLL_INTERVAL_MS = 3000;

/**
 * 一个三视图目标（默认穿搭或某套穿搭）的生成 job：创建、取消、轮询。
 * 轮询只在 job 在途且标签页可见时发请求，用 singleFlight 避免请求堆积；组件卸载或目标切换时停掉。
 * job 一进入终态就调 onSettled，由调用方重新读取角色文档（views_status / views 以角色文档为准）。
 */
export function useViewsJob({ personaId, outfitId, status, onSettled }: {
  personaId: string; outfitId: string | null; status: ViewsStatus; onSettled: () => void;
}) {
  const navigate = useNavigate();
  const [job, setJob] = useState<ViewsJobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  // 目标切换：丢掉上一个目标的 job 和提示。
  useEffect(() => { setJob(null); setError(null); }, [personaId, outfitId]);

  // 页面刷新后 pending / failed 的目标没有 job 在手里：读一次 job 列表认领，拿到进度或失败原因。
  useEffect(() => {
    if (job || (status !== "pending" && status !== "failed")) return;
    let cancelled = false;
    void listViewsJobs(personaId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.error === "unauthorized") navigate("/login");
        else setError(describeWriteError(result));
        return;
      }
      setJob(pickJobForTarget(result.jobs, outfitId, status));
    });
    return () => { cancelled = true; };
  }, [personaId, outfitId, status, job, navigate]);

  const jobId = job && isViewsJobActive(job) ? job.job_id : null;
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const poll = singleFlight(() => getViewsJob(personaId, jobId), (result) => {
      if (stopped) return;
      if (!result.ok) {
        if (result.error === "unauthorized") navigate("/login");
        else if (result.error === "not_found") settledRef.current();
        else setError(describeWriteError(result));
        return;
      }
      setError(null);
      setJob(result.job);
      if (!isViewsJobActive(result.job)) settledRef.current();
    });
    const tick = () => { if (!document.hidden) poll.trigger(); };
    const id = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      poll.stop();
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [personaId, jobId, navigate]);

  const start = useCallback(async (regenerate: boolean) => {
    setBusy(true);
    setError(null);
    const result = await createViewsJob(personaId, outfitId, regenerate);
    setBusy(false);
    if (!result.ok) {
      if (result.error === "unauthorized") navigate("/login");
      else setError(describeWriteError(result));
      return;
    }
    setJob(result.job);
    settledRef.current();
  }, [personaId, outfitId, navigate]);

  const cancel = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    const result = await cancelViewsJob(personaId, job.job_id);
    setBusy(false);
    if (!result.ok) {
      if (result.error === "unauthorized") navigate("/login");
      else setError(describeWriteError(result));
      // 409 not_cancellable 说明 job 已经结束，刷新角色文档即可看到最终状态。
      if (result.error === "not_cancellable") settledRef.current();
      return;
    }
    setJob(result.job);
    settledRef.current();
  }, [personaId, job, navigate]);

  return { job, busy, error, start, cancel };
}
