import { useParams } from "react-router-dom";
import type { Episode } from "@kelvoy/engine";
import { getEpisode, listDestinations, listPersonas } from "../api/client";
import { useApiResource, usePolledApiResource } from "../hooks/useApiResource";
import { EPISODE_STATUS_LABELS } from "../labels";
import ClipReview from "../review/ClipReview";
import DoneView from "../review/DoneView";
import KeyframeReview from "../review/KeyframeReview";
import ProgressView from "../review/ProgressView";
import SaveAsTemplateForm from "../review/SaveAsTemplateForm";
import ScriptReview from "../review/ScriptReview";
import { useEpisodeMutation } from "../review/useEpisodeMutation";
import "../review/review.css";

/**
 * 审片台（M2-9/#31，FR-05）。这一页只负责取数据、3 秒轮询、按 status 分发
 * 视图；三个审核点各自的交互都在 frontend/review/ 下。
 *
 * 目的地/角色走已有的列表接口按 id 找（审片台要地标实景图和角色参考图），
 * 不为此加新的单查接口——列表是登录后就要用的数据，多取几条比多一条路由
 * 便宜。
 */
export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, data, error, refresh } = usePolledApiResource(() => getEpisode(id!), [id]);
  const destinations = useApiResource(listDestinations, []);
  const personas = useApiResource(listPersonas, []);

  const mutation = useEpisodeMutation(data?.row_version ?? 0, refresh);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  if (!data) return null;

  const episode: Episode = data.episode;
  const destination =
    destinations.data?.destinations.find((d) => d.destination_id === episode.destination_id) ?? null;
  const persona = personas.data?.personas.find((p) => p.persona_id === episode.persona_id) ?? null;

  return (
    <div>
      <div className="k-eyebrow">审片台</div>
      <h1>
        {episode.render.title || episode.episode_id}{" "}
        <span className="k-pill k-pill-accent">{EPISODE_STATUS_LABELS[episode.status]}</span>
      </h1>
      <div className="k-desk-head">
        <span className="k-card-meta">{episode.episode_id}</span>
        <span className="k-card-meta">角色：{persona?.name ?? episode.persona_id}</span>
        <span className="k-card-meta">
          目的地：{destination ? `${destination.city} · ${destination.name}` : episode.destination_id}
        </span>
        {/* FR-09/FR-11 当前阶段口径：只说"预估 GPU 分钟"，不做积分余额、不做扣减动画。 */}
        <span className="k-card-meta">预估：约 {episode.estimated_credits} GPU 分钟</span>
        <span className="k-card-meta">{episode.shots.length} 镜 · 每 3 秒自动刷新</span>
      </div>

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
      {(episode.status === "done" || episode.status === "composing") && (
        <DoneView episode={episode} mutation={mutation} />
      )}
      {(episode.status === "draft" ||
        episode.status === "scripting" ||
        episode.status === "assets" ||
        episode.status === "failed") && <ProgressView episode={episode} mutation={mutation} />}

      <SaveAsTemplateForm episodeId={episode.episode_id} />
    </div>
  );
}
