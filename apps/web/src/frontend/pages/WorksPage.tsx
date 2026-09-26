import { Link } from "react-router-dom";
import type { Episode, Persona } from "@kelvoy/engine";
import { listEpisodes, listPersonas } from "../api/client";
import { episodeLabel } from "../episode-view";
import { useApiResource } from "../hooks/useApiResource";
import { EPISODE_STATUS_LABELS } from "../labels";

// #42：完整作品列表。不做筛选/分页/搜索——一个账号的期数还是个位数。
export default function WorksPage() {
  const episodesRes = useApiResource(listEpisodes, []);
  const personasRes = useApiResource(listPersonas, []);

  if (episodesRes.loading) return <p className="k-empty">加载中…</p>;
  if (episodesRes.error) return <p className="k-error">加载失败：{episodesRes.error}</p>;

  const episodes = episodesRes.data?.episodes ?? [];
  const personas = personasRes.data?.personas ?? [];
  return <WorksList episodes={episodes} personas={personas} />;
}

export function WorksList({ episodes, personas }: { episodes: Episode[]; personas: Persona[] }) {
  const personaById = new Map(personas.map((p) => [p.persona_id, p]));

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
      <div className="k-eyebrow">按角色归组</div>
      <h1>我的作品</h1>
      <p className="k-card-meta">从任意一期继续创作或查看成片。需要帮助可看<Link to="/help">创作指南</Link>，也可<Link to="/episodes/new">新建一期</Link>。</p>

      {series.length === 0 ? (
        <p className="k-empty">
          还没有期，<Link to="/episodes/new">新建一期</Link>开始第一期。
        </p>
      ) : (
        <div className="k-card k-works-list">
          {series.map((s) => {
            return (
              <section className="k-works-series" key={s.personaId} aria-label={`${s.persona?.name ?? s.personaId}的作品`}>
                <h2 className="k-card-title">{s.persona?.name ?? s.personaId} <span className="k-card-meta">{s.episodes.length} 期</span></h2>
                <ol className="k-works-episodes">
                  {s.episodes.map((episode) => <li className="k-works-episode" key={episode.episode_id}>
                    <div className="k-works-episode-info">
                      <span>{episodeLabel(episode)}</span>
                      <span className="k-card-meta">{EPISODE_STATUS_LABELS[episode.status]}</span>
                    </div>
                    <Link to={`/episodes/${episode.episode_id}`} className="k-series-action"
                      aria-label={`${episode.status === "done" ? "查看" : "继续"} ${episodeLabel(episode)}`}>
                      {episode.status === "done" ? "查看" : "继续"} →
                    </Link>
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
