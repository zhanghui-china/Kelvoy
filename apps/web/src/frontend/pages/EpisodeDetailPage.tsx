import { useParams } from "react-router-dom";
import type { Episode } from "@kelvoy/engine";
import { getEpisode, listDestinations } from "../api/client";
import { useApiResource, usePolledApiResource } from "../hooks/useApiResource";
import { EPISODE_STATUS_LABELS } from "../labels";
import { episodeLabel } from "../episode-view";
import ClipReview from "../review/ClipReview";
import ComposeSetup from "../review/ComposeSetup";
import DoneView from "../review/DoneView";
import KeyframeReview from "../review/KeyframeReview";
import ProgressView from "../review/ProgressView";
import SaveAsTemplateForm from "../review/SaveAsTemplateForm";
import StageSteps from "../review/StageSteps";
import ScriptReview from "../review/ScriptReview";
import { useEpisodeMutation } from "../review/useEpisodeMutation";
import "../review/review.css";

/**
 * 审片台（M2-9/#31，FR-05）。这一页只负责取数据、3 秒轮询、按 status 分发
 * 视图；三个审核点各自的交互都在 frontend/review/ 下。
 *
 * 目的地从共享列表读取；角色由期详情接口按 persona_version 返回不可变
 * 快照，避免官方角色更新后审片台显示新版本的参考图。
 */
export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, data, error, refresh } = usePolledApiResource(() => getEpisode(id!), [id]);
  const destinations = useApiResource(listDestinations, []);

  const mutation = useEpisodeMutation(data?.row_version ?? 0, refresh);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  if (!data) return null;

  const episode: Episode = data.episode;
  const destination =
    destinations.data?.destinations.find((d) => d.destination_id === episode.destination_id) ?? null;
  const persona = data.persona;

  return (
    <div>
      <div className="k-eyebrow">审片台</div>
      <h1>
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
        <span className="k-card-meta">{episode.shots.length} 镜 · 每 3 秒自动刷新</span>
      </div>
      <StageSteps status={episode.status} />

      {episode.status === "script_review" && (
        <ScriptReview episode={episode} destination={destination} mutation={mutation} />
      )}
      {(episode.status === "kf_review" || episode.status === "keyframing") && (
        <KeyframeReview
          episode={episode}
          destination={destination}
          persona={persona}
          mutation={mutation}
        />
      )}
      {(episode.status === "clip_review" || episode.status === "clipping") && (
        <ClipReview episode={episode} mutation={mutation} />
      )}
      {episode.status === "compose_ready" && <ComposeSetup episode={episode} mutation={mutation} />}
      {(episode.status === "done" || episode.status === "composing") && (
        <DoneView episode={episode} mutation={mutation} />
      )}
      {(episode.status === "draft" ||
        episode.status === "scripting" ||
        episode.status === "assets" ||
        episode.status === "failed") && <ProgressView episode={episode} mutation={mutation} />}
      {(episode.status === "keyframing" || episode.status === "clipping") &&
        episode.shots.some((shot) => shot.status === "failed") &&
        <ProgressView episode={episode} mutation={mutation} />}

      <SaveAsTemplateForm episodeId={episode.episode_id} />
    </div>
  );
}
