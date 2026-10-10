import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Destination, Episode, Persona } from "@kelvoy/engine";
import type { EpisodeOverview } from "../../shared/episode-overview";
import { listDestinations, listEpisodeOverviews, listPersonas } from "../api/client";
import { episodeLabel } from "../episode-view";
import { useApiResource } from "../hooks/useApiResource";
import { EPISODE_STATUS_LABELS } from "../labels";
import DeleteEpisodeButton, { EPISODE_DELETED_MESSAGE } from "./DeleteEpisodeButton";

// #42：完整作品列表使用概览投影，详情和模型记录仅在期页面读取。
export default function WorksPage() {
  const episodesRes = useApiResource(listEpisodeOverviews, []);
  const personasRes = useApiResource(listPersonas, []);
  const destinationsRes = useApiResource(listDestinations, []);

  if (episodesRes.error) return <p className="k-error">作品加载失败：{episodesRes.error}</p>;
  if (personasRes.error) return <p className="k-error">角色目录加载失败：{personasRes.error}</p>;
  if (destinationsRes.error) return <p className="k-error">目的地目录加载失败：{destinationsRes.error}</p>;
  if (episodesRes.loading || personasRes.loading || destinationsRes.loading) return <p className="k-empty">加载中…</p>;

  const episodes = episodesRes.data?.episodes ?? [];
  const personas = personasRes.data?.personas ?? [];
  const destinations = destinationsRes.data?.destinations ?? [];
  return <WorksList episodes={episodes} personas={personas} destinations={destinations} />;
}

type WorkStatus = "all" | "draft" | "active" | "done" | "failed";
type Region = "all" | "CN" | "overseas";
type Work = EpisodeOverview | Episode;
const workSeason = (episode: Work) => "season" in episode ? episode.season : episode.brief?.season ?? "";

export function filterWorks(episodes: Work[], personas: Persona[], destinations: Destination[], query: string, status: WorkStatus, region: Region, province: string, season: string): Work[] {
  const personaById = new Map(personas.map((p) => [p.persona_id, p]));
  const destinationById = new Map(destinations.map((d) => [d.destination_id, d]));
  const needle = query.trim().toLocaleLowerCase();
  return episodes.filter((episode) => {
    const destination = destinationById.get(episode.destination_id);
    const persona = personaById.get(episode.persona_id);
    if (status === "draft" && episode.status !== "draft") return false;
    if (status === "done" && episode.status !== "done") return false;
    if (status === "failed" && episode.status !== "failed") return false;
    if (status === "active" && ["draft", "done", "failed"].includes(episode.status)) return false;
    // Older destinations may lack country metadata. Keep them under "all" only.
    if (region === "CN" && destination?.country_code !== "CN") return false;
    if (region === "overseas" && (!destination?.country_code || destination.country_code === "CN")) return false;
    if (province && destination?.province !== province) return false;
    if (season && workSeason(episode) !== season) return false;
    if (!needle) return true;
    return [episodeLabel(episode), persona?.name, destination?.name, destination?.city, destination?.province]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

export function WorksList({ episodes, personas, destinations = [] }: { episodes: Work[]; personas: Persona[]; destinations?: Destination[] }) {
  const location = useLocation();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(() => location.state?.message ?? null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkStatus>("all");
  const [region, setRegion] = useState<Region>("all");
  const [province, setProvince] = useState("");
  const [season, setSeason] = useState("");
  const personaById = new Map(personas.map((p) => [p.persona_id, p]));
  const destinationById = new Map(destinations.map((d) => [d.destination_id, d]));
  const provinces = [...new Set(destinations.filter((d) => d.country_code === "CN" && d.province).map((d) => d.province!))].sort();
  const seasons = [...new Set(episodes.map(workSeason).filter(Boolean))].sort();
  const remaining = episodes.filter(episode => !deletedIds.has(episode.episode_id));
  const filtered = filterWorks(remaining, personas, destinations, query, status, region, province, season);

  // "我的作品·按系列"：FR-13 说系列是按 persona_id 归组的浏览视图，不是
  // 新增表——这里就是那句话的落地，没有 series 表可查。
  const seriesGroups = new Map<string, (EpisodeOverview | Episode)[]>();
  for (const e of filtered) {
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
      <div className="k-eyebrow">按角色归组</div>
      <h1>我的作品</h1>
      {message && <p role="status">{message}</p>}
      <p className="k-card-meta">从任意一期继续创作或查看成片。需要帮助可看<Link to="/help">创作指南</Link>，也可<Link to="/episodes/new">新建一期</Link>。</p>

      {remaining.length > 0 && <div className="k-works-filters" aria-label="筛选作品">
        <label>搜索作品<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="作品、角色或目的地" /></label>
        <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as WorkStatus)}>
          <option value="all">全部状态</option><option value="draft">草稿</option><option value="active">进行中</option><option value="done">已完成</option><option value="failed">失败</option>
        </select></label>
        <label>地区<select value={region} onChange={(event) => { setRegion(event.target.value as Region); setProvince(""); }}>
          <option value="all">全部地区</option><option value="CN">国内</option><option value="overseas">海外</option>
        </select></label>
        {region === "CN" && provinces.length > 0 && <label>省份<select value={province} onChange={(event) => setProvince(event.target.value)}>
          <option value="">全部省份</option>{provinces.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>}
        {seasons.length > 0 && <label>季节<select value={season} onChange={(event) => setSeason(event.target.value)}>
          <option value="">全部季节</option>{seasons.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>}
        <span className="k-card-meta" aria-live="polite">{filtered.length} 期作品</span>
      </div>}

      {remaining.length === 0 ? (
        <p className="k-empty">
          还没有期，<Link to="/episodes/new">新建一期</Link>开始第一期。
        </p>
      ) : series.length === 0 ? (
        <p className="k-empty">没有匹配的作品，请调整筛选条件。</p>
      ) : (
        <div className="k-card k-works-list">
          {series.map((s) => {
            return (
              <section className="k-works-series" key={s.personaId} aria-label={`${s.persona?.name ?? s.personaId}的作品`}>
                <h2 className="k-card-title">{s.persona?.name ?? s.personaId} <span className="k-card-meta">{s.episodes.length} 期</span></h2>
                <ol className="k-works-episodes k-works-grid">
                  {s.episodes.map((episode) => <li className="k-works-episode" key={episode.episode_id}>
                    <div className="k-works-episode-info">
                      <strong>{episodeLabel(episode)}</strong>
                      <span className="k-card-meta">{destinationById.get(episode.destination_id)?.name ?? episode.destination_id}</span>
                      {workSeason(episode) && <span className="k-card-meta">{workSeason(episode)}</span>}
                      <span className="k-pill">{EPISODE_STATUS_LABELS[episode.status]}</span>
                      <span className="k-card-meta">{new Date(episode.created_at).toLocaleDateString("zh-CN")}</span>
                    </div>
                    <div className="k-work-actions"><Link to={`/episodes/${episode.episode_id}`} className="k-series-action"
                      aria-label={`${episode.status === "done" ? "查看" : "继续"} ${episodeLabel(episode)}`}>
                      {episode.status === "done" ? "查看" : "继续"} →
                    </Link>
                    <DeleteEpisodeButton episodeId={episode.episode_id} name={episodeLabel(episode)} onDeleted={() => {
                      setDeletedIds(previous => new Set(previous).add(episode.episode_id));
                      setMessage(EPISODE_DELETED_MESSAGE);
                    }} /></div>
                  </li>)}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
