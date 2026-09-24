import { Link } from "react-router-dom";
import type { Episode } from "@kelvoy/engine";
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

      {series.length === 0 ? (
        <p className="k-empty">
          还没有期，<Link to="/episodes/new">新建一期</Link>开始第一期。
        </p>
      ) : (
        <div className="k-card k-series-list">
          {series.map((s) => {
            const latest = s.episodes[0]!;
            return (
              <div className="k-series-row" key={s.personaId}>
                <div>
                  <div className="k-card-title">{s.persona?.name ?? s.personaId}</div>
                  <div className="k-card-meta">
                    <span className="k-mono">{s.episodes.length}</span> 期
                  </div>
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
