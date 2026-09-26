import { Link, useNavigate } from "react-router-dom";
import { listDestinations, listEpisodes, listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import type { ProviderTally } from "../review/tally";
import { tally } from "../review/tally";
import "../review/review.css";
import "./UsagePage.css";
import CreditPanel from "./CreditPanel";
import { GuideTip } from "../GuideTip";

// 期的 created_at 是唯一记录在 Episode 上的时间戳（PRD v0.2 §6 没有
// completed_at/updated_at 字段），所以"按期"表格显示的是创建时间，不是
// issue 文案里写的"完成时间"——数据模型现在给不出真正的完成时间，宁可少
// 一列语义准确的信息，也不编一个假时间戳出来。
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

// 跨期把每期的 tally() 结果按 provider+model 再合并一遍（M2-16, #44）。
// 这是展示聚合，不是业务规则，所以留在 frontend 里，不下沉到 engine。
function mergeTally(perEpisodeRows: ProviderTally[][]): ProviderTally[] {
  const merged = new Map<string, ProviderTally>();
  for (const rows of perEpisodeRows) {
    for (const row of rows) {
      const key = `${row.provider}/${row.model}`;
      const existing = merged.get(key) ?? {
        provider: row.provider,
        model: row.model,
        shots: 0,
        attempts: 0,
        costUsd: 0,
      };
      existing.shots += row.shots;
      existing.attempts += row.attempts;
      existing.costUsd += row.costUsd;
      merged.set(key, existing);
    }
  }
  return [...merged.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export default function UsagePage() {
  const navigate = useNavigate();
  const episodesRes = useApiResource(listEpisodes, []);
  const personasRes = useApiResource(listPersonas, []);
  const destinationsRes = useApiResource(listDestinations, []);

  if (episodesRes.loading) return <p className="k-empty">加载中…</p>;
  if (episodesRes.error) return <p className="k-error">加载失败：{episodesRes.error}</p>;

  const episodes = episodesRes.data?.episodes ?? [];
  const personaById = new Map((personasRes.data?.personas ?? []).map((p) => [p.persona_id, p]));
  const destinationById = new Map(
    (destinationsRes.data?.destinations ?? []).map((d) => [d.destination_id, d]),
  );

  if (episodes.length === 0) {
    return (
      <div>
        <div className="k-eyebrow">账号级成本聚合</div>
        <h1>用量</h1>
        <GuideTip section="credits">这里记录账户可用与预留积分，以及实际流水；额度由团队发放。</GuideTip>
        <CreditPanel />
        <p className="k-empty">还没有出片记录。</p>
      </div>
    );
  }

  // 按期：一期算一次 tally()，行内附带这期的 API 费用小计；按 created_at
  // 倒序，跟首页"我的作品"同一个排序口径。
  const periods = episodes
    .map((episode) => {
      const rows = tally(episode);
      const costUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
      return { episode, rows, costUsd };
    })
    .sort((a, b) => b.episode.created_at.localeCompare(a.episode.created_at));

  const providerRows = mergeTally(periods.map((p) => p.rows));

  const totalCredits = episodes.reduce((sum, e) => sum + e.credits_used, 0);
  const totalCost = periods.reduce((sum, p) => sum + p.costUsd, 0);

  return (
    <div>
      <div className="k-eyebrow">账号级成本聚合</div>
      <h1>用量</h1>
      <GuideTip section="credits">这里记录账户可用与预留积分，以及实际流水；额度由团队发放。</GuideTip>

      <CreditPanel />

      <div className="k-usage-totals">
        <div className="k-card">
          <div className="k-usage-total-value k-mono">{totalCredits}</div>
          <div className="k-card-meta">已用积分</div>
        </div>
        <div className="k-card">
          <div className="k-usage-total-value k-mono">{totalCost.toFixed(4)}</div>
          <div className="k-card-meta">总 API 费用 (USD)</div>
        </div>
        <div className="k-card">
          <div className="k-usage-total-value k-mono">{episodes.length}</div>
          <div className="k-card-meta">总期数</div>
        </div>
      </div>

      <div className="k-card">
        <div className="k-card-title">按期</div>
        <div className="k-desk-tablewrap">
          <table className="k-desk-table">
            <thead>
              <tr>
                <th>目的地</th>
                <th>角色</th>
                <th>创建时间</th>
                <th>镜数</th>
                <th>已用积分</th>
                <th>API 费用 (USD)</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(({ episode, costUsd }) => (
                <tr
                  key={episode.episode_id}
                  className="k-usage-table-row"
                  onClick={() => navigate(`/episodes/${episode.episode_id}`)}
                >
                  <td>
                    <Link to={`/episodes/${episode.episode_id}`} onClick={(e) => e.stopPropagation()}>
                      {destinationById.get(episode.destination_id)?.name ?? episode.destination_id}
                    </Link>
                  </td>
                  <td>{personaById.get(episode.persona_id)?.name ?? episode.persona_id}</td>
                  <td>{formatDate(episode.created_at)}</td>
                  <td className="k-mono">{episode.shots.length}</td>
                  <td className="k-mono">{episode.credits_used}</td>
                  <td className="k-mono">{costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="k-card">
        <div className="k-card-title">按 provider / model</div>
        {providerRows.length === 0 ? (
          <p className="k-empty">还没有模型调用记录。</p>
        ) : (
          <div className="k-desk-tablewrap">
            <table className="k-desk-table">
              <thead>
                <tr>
                  <th>provider</th>
                  <th>模型</th>
                  <th>镜次</th>
                  <th>尝试次数</th>
                  <th>成本 (USD)</th>
                </tr>
              </thead>
              <tbody>
                {providerRows.map((row) => (
                  <tr key={`${row.provider}/${row.model}`}>
                    <td>{row.provider}</td>
                    <td>{row.model}</td>
                    <td className="k-mono">{row.shots}</td>
                    <td className="k-mono">{row.attempts}</td>
                    <td className="k-mono">{row.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
