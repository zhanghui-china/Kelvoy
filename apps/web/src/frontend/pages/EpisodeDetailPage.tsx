import type { ShotFailureSummary } from "../api/client";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Destination, Episode, Persona } from "@kelvoy/engine";
import { getEpisode } from "../api/client";
import type { StoryboardPrices, FailedTaskSummary } from "../api/client";
import { usePolledApiResource } from "../hooks/useApiResource";
import { EPISODE_STATUS_LABELS } from "../labels";
import { episodeLabel } from "../episode-view";
import ClipReview from "../review/ClipReview";
import ComposeSetup from "../review/ComposeSetup";
import DoneView from "../review/DoneView";
import KeyframeReview from "../review/KeyframeReview";
import ProgressView from "../review/ProgressView";
import SaveAsTemplateForm from "../review/SaveAsTemplateForm";
import StageSteps, { episodeStages, currentEpisodeStage, failedStageLabel, type StageId } from "../review/StageSteps";
import StagePlayback from "../review/StagePlayback";
import PriorFinal from "../review/PriorFinal";
import StoryboardEditor from "../review/StoryboardEditor";
import ScriptReview from "../review/ScriptReview";
import { useEpisodeMutation } from "../review/useEpisodeMutation";
import { versionForEpisode } from "../review/episode-mutation-version";
import type { EpisodeMutation } from "../review/useEpisodeMutation";
import "../review/review.css";
import DeleteEpisodeButton from "./DeleteEpisodeButton";

/**
 * 审片台（M2-9/#31，FR-05）。这一页只负责取数据、3 秒轮询、按 status 分发
 * 视图；三个审核点各自的交互都在 frontend/review/ 下。
 *
 * 目的地和角色均由期详情接口按记录的版本返回快照。
 */
export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, data, error, refresh } = usePolledApiResource(
    () => getEpisode(id!), [id],
    (result) => (result.episode.status !== "done" && result.episode.status !== "failed") || Boolean(result.storyboard_busy),
  );

  const mutation = useEpisodeMutation(id ?? "", versionForEpisode(id, data), refresh);

  if (error === "not_found") return <div><p role="status">作品已删除或不存在。</p><Link to="/works">返回作品列表</Link></div>;
  if (loading || (data && data.episode.episode_id !== id)) return <p className="k-empty">加载中…</p>;
  if (error && !data) return <p className="k-error">加载失败：{error}</p>;
  if (!data) return null;

  const episode: Episode = data.episode;
  return <>{error && <p className="k-error" role="alert">刷新失败：{error}。表单内容已保留，请稍后重试。</p>}<EpisodeDetailContent key={id} episode={episode} destination={data.destination} persona={data.persona}
    destinationHistoryApproximate={data.destination_history_approximate}
    shotFailures={data.shot_failures} failedTask={data.failed_task} mutation={mutation} storyboardBusy={data.storyboard_busy}
    storyboardWarnings={data.storyboard_warnings} storyboardPrices={data.storyboard_prices} /></>;
}

export function EpisodeDetailContent({ episode, destination, persona, destinationHistoryApproximate, failedTask, shotFailures, mutation, storyboardBusy, storyboardWarnings, storyboardPrices }: {
  episode: Episode;
  destination: Destination | null;
  persona: Persona | null;
  destinationHistoryApproximate?: boolean;
  failedTask?: FailedTaskSummary | null;
  shotFailures?: ShotFailureSummary[];
  mutation: EpisodeMutation;
  storyboardBusy?: boolean;
  storyboardWarnings?: string[];
  storyboardPrices?: StoryboardPrices;
}) {

  const [viewing, setViewing] = useState<{ episodeId: string; stage: StageId } | null>(null);
  const operationRef = useRef<HTMLDivElement>(null);
  const stages = episodeStages(episode, failedTask);
  const currentStage = currentEpisodeStage(episode, failedTask);
  const selectedStage = viewing?.episodeId === episode.episode_id &&
    stages.some(stage => stage.id === viewing.stage && stage.available) ? viewing.stage : null;
  const replaying = selectedStage !== null && selectedStage !== currentStage;
  useEffect(() => {
    if (viewing && !selectedStage) setViewing(null);
  }, [viewing, selectedStage]);
  useEffect(() => {
    if (replaying) operationRef.current?.querySelectorAll("video").forEach(video => video.pause());
  }, [replaying, episode]);
  function selectStage(stage: StageId) {
    // Pause immediately, including any delayed preview play event in the hidden view.
    operationRef.current?.querySelectorAll("video").forEach(video => video.pause());
    setViewing(stage === currentStage ? null : { episodeId: episode.episode_id, stage });
  }

  return (
    <div>
      <div className="k-eyebrow">审片台</div>
      <h1 className="k-desk-title">
        {episodeLabel(episode)}{" "}
        <span className="k-pill k-pill-accent">{EPISODE_STATUS_LABELS[episode.status]}</span>
      </h1>
      <div className="k-desk-head">
        <span className="k-card-meta">{episode.episode_id}</span>
        <span className="k-card-meta">角色：{persona?.name ?? episode.persona_id}</span>
        <span className="k-card-meta">
          目的地：{destination ? `${destination.city} · ${destination.name}` : episode.destination_id}
        </span>
        <span className="k-card-meta">预计完整创作：{episode.estimated_credits} 积分</span>
        <span className="k-card-meta">{episode.shots.length} 镜 · 活跃时按需自动刷新</span>
        <DeleteEpisodeButton episodeId={episode.episode_id} name={episodeLabel(episode)} disabled={mutation.pending} />
      </div>
      {destinationHistoryApproximate && <p className="k-card-meta">
        此期使用旧数据创建：原始目的地版本已无法恢复，显示的是迁移时保存的近似资料。
      </p>}
      <StageSteps status={episode.status} failedTask={failedTask} videoSource={episode.video_source}
        stages={stages} selectedStage={selectedStage ?? currentStage} onSelect={selectStage} />
      {replaying && <section className="k-playback" aria-label="只读阶段回看">
        <div className="k-desk-toolbar k-playback-banner">
          <p role="status">正在回看：{stages.find(stage => stage.id === selectedStage)?.label.slice(2)} · 只读</p>
          <button type="button" className="k-btn k-btn-secondary" onClick={() => setViewing(null)}>返回当前进度</button>
        </div>
        {(episode.status === "failed" || episode.shots.some(shot => shot.status === "failed")) && <p className="k-error" role="alert">
          生成失败{failedTask ? ` · 失败阶段：${failedStageLabel(failedTask)}${failedTask.shot_no !== null ? ` · 第 ${failedTask.shot_no} 镜` : ""}` : " · 阶段未知"}
          {episode.failure_reason ? `：${episode.failure_reason}` : ""}。返回当前进度后可查看重试操作。
        </p>}
        <StagePlayback key={`${episode.episode_id}:${selectedStage}`} stage={selectedStage} episode={episode} destination={destination} persona={persona} />
      </section>}
      {/* Keep local edits mounted while replaying, but remove all operation entries from view. */}
      <div ref={operationRef} hidden={replaying} data-episode-operations
        onBlurCapture={event => {
          // Stage navigation must not submit an edit through a review field's blur autosave.
          if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-stage]")) event.stopPropagation();
        }}
        onPlayCapture={event => { if (replaying && event.target instanceof HTMLVideoElement) event.target.pause(); }}>
        {episode.status !== "done" && episode.final && <PriorFinal episode={episode} />}

        {episode.status === "script_review" && (
          <ScriptReview episode={episode} destination={destination} mutation={mutation} busy={storyboardBusy} warnings={storyboardWarnings} prices={storyboardPrices} showEditor={false} />
        )}
        {(episode.status === "kf_review" || episode.status === "keyframing") && (
          <KeyframeReview shotFailures={shotFailures}
            episode={episode}
            destination={destination}
            persona={persona}
            mutation={mutation}
            busy={storyboardBusy}
          />
        )}
        {(episode.status === "clip_review" || episode.status === "clipping") && (
          <ClipReview shotFailures={shotFailures} episode={episode} mutation={mutation} />
        )}
        {episode.status === "compose_ready" && <ComposeSetup episode={episode} mutation={mutation} />}
        {(episode.status === "done" || episode.status === "composing") && (
          <DoneView episode={episode} mutation={mutation} />
        )}
        {(episode.status === "draft" ||
          episode.status === "scripting" ||
          episode.status === "assets" ||
          episode.status === "failed") && <ProgressView shotFailures={shotFailures} episode={episode} mutation={mutation} failedTask={failedTask} />}
        {(episode.status === "keyframing" || episode.status === "kf_review" ||
          episode.status === "clipping" || episode.status === "clip_review") &&
          episode.shots.some((shot) => shot.status === "failed") &&
          <ProgressView shotFailures={shotFailures} episode={episode} mutation={mutation} failedTask={failedTask} />}

        {episode.mode === "per_shot" && <details className="k-desk-main" open={episode.status === "script_review" ? true : undefined}>
          <summary>编辑分镜 · {episode.shots.length} 镜</summary>
          <StoryboardEditor episode={episode} destination={destination} mutation={mutation} busy={storyboardBusy}
            warnings={storyboardWarnings} prices={storyboardPrices} />
        </details>}
        <SaveAsTemplateForm episodeId={episode.episode_id} />
      </div>
    </div>
  );
}
