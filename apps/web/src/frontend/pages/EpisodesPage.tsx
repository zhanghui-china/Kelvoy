import { Link } from "react-router-dom";
import type { Episode } from "@kelvoy/engine";
import { listDestinations, listEpisodes, listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { EPISODE_STATUS_LABELS } from "../labels";

const TERMINAL_STATUSES = new Set(["done", "failed"]);

function episodeLabel(e: Episode): string {
  return e.render.title || e.episode_id;
}

export default function EpisodesPage() {
  const episodesRes = useApiResource(listEpisodes, []);
  const personasRes = useApiResource(listPersonas, []);
  const destinationsRes = useApiResource(listDestinations, []);

  if (episodesRes.loading) return <p className="k-empty">加载中…</p>;
  if (episodesRes.error) return <p className="k-error">加载失败：{episodesRes.error}</p>;

  const episodes = episodesRes.data?.episodes ?? [];
  const personas = personasRes.data?.personas ?? [];
  const destinations = destinationsRes.data?.destinations ?? [];
  const personaById = new Map(personas.map((p) => [p.persona_id, p]));
  const destinationById = new Map(destinations.map((d) => [d.destination_id, d]));

  // "继续上次"：最近创建的、还没到 done/failed 的一期——真有这期才显示，
  // 不编一个占位卡片出来。
  const inProgress = episodes
    .filter((e) => !TERMINAL_STATUSES.has(e.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const doneCount = episodes.filter((e) => e.status === "done").length;
  const totalCredits = episodes.reduce((sum, e) => sum + e.credits_used, 0);

  // "我的作品·按系列"：FR-13 说系列是按 persona_id 归组的浏览视图，不是
  // 新增表——这里就是那句话的落地，没有 series 表可查。
  const seriesGroups = new Map<string, Episode[]>();
  for (const e of episodes) {
    const list = seriesGroups.get(e.persona_id) ?? [];
    list.push(e);
    seriesGroups.set(e.persona_id, list);
  }
  const series = [...seriesGroups.entries()]
    .map(([personaId, list]) => ({
      personaId,
      persona: personaById.get(personaId),
      episodes: list.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
    .sort((a, b) => b.episodes[0]!.created_at.localeCompare(a.episodes[0]!.created_at));

  return (
    <div>
      <div className="k-eyebrow">一期一个目的地</div>
      <h1>我的作品</h1>

      <div className="k-home-top-row">
        {inProgress && (
          <Link to={`/episodes/${inProgress.episode_id}`} className="k-card k-home-resume">
            <div className="k-eyebrow">继续上次</div>
            <div className="k-card-title">{episodeLabel(inProgress)}</div>
            <div className="k-card-meta">
              {personaById.get(inProgress.persona_id)?.name ?? inProgress.persona_id}
              {" · "}
              {destinationById.get(inProgress.destination_id)?.name ?? inProgress.destination_id}
              {" · "}
              {EPISODE_STATUS_LABELS[inProgress.status]}
            </div>
            <span className="k-btn k-btn-primary k-home-resume-btn">继续审片</span>
          </Link>
        )}
        <Link to="/episodes/new" className="k-card k-home-new">
          <div className="k-home-new-plus">+</div>
          <div className="k-card-title">新建一期</div>
          <div className="k-card-meta">选角色、选目的地，开始新的一期</div>
        </Link>
        <div className="k-card k-home-stats">
          <div className="k-eyebrow">总览</div>
          <div className="k-home-stats-row">
            <div>
              <div className="k-home-stat-value">{episodes.length}</div>
              <div className="k-card-meta">总期数</div>
            </div>
            <div>
              <div className="k-home-stat-value">{doneCount}</div>
              <div className="k-card-meta">已完成</div>
            </div>
            <div>
              <div className="k-home-stat-value">{totalCredits}</div>
              <div className="k-card-meta">累计 GPU 分钟</div>
            </div>
          </div>
        </div>
      </div>

      <div className="k-eyebrow" style={{ marginTop: "0.5rem" }}>
        我的作品 · 按系列
      </div>
      {series.length === 0 ? (
        <p className="k-empty">
          还没有期，点上面"新建一期"开始第一期。
        </p>
      ) : (
        <div className="k-card k-series-list">
          {series.map((s) => {
            const latest = s.episodes[0]!;
            return (
              <div className="k-series-row" key={s.personaId}>
                <div>
                  <div className="k-card-title">{s.persona?.name ?? s.personaId}</div>
                  <div className="k-card-meta">{s.episodes.length} 期</div>
                </div>
                <div className="k-card-meta">
                  最新：{episodeLabel(latest)} · {EPISODE_STATUS_LABELS[latest.status]}
                </div>
                <Link to={`/episodes/${latest.episode_id}`} className="k-series-action">
                  {latest.status === "done" ? "查看" : "继续"} →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
