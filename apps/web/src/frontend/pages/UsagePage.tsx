import { Link, useNavigate } from "react-router-dom";
import { getUsageSummary } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
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

export default function UsagePage() {
  const navigate = useNavigate();
  const usageRes = useApiResource(getUsageSummary, []);

  if (usageRes.loading) return <p className="k-empty">加载中…</p>;
  if (usageRes.error) return <p className="k-error">加载失败：{usageRes.error}</p>;

  const usage = usageRes.data?.usage;
  const periods = usage?.periods ?? [];
  const providerRows = usage?.providers ?? [];

  if (periods.length === 0) {
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

  return (
    <div>
      <div className="k-eyebrow">账号级成本聚合</div>
      <h1>用量</h1>
      <GuideTip section="credits">这里记录账户可用与预留积分，以及实际流水；额度由团队发放。</GuideTip>

      <CreditPanel />

      <div className="k-usage-totals">
        <div className="k-card">
          <div className="k-usage-total-value k-mono">{usage?.totals.credits_used ?? 0}</div>
          <div className="k-card-meta">已用积分</div>
        </div>
        <div className="k-card">
          <div className="k-usage-total-value k-mono">{(usage?.totals.cost_usd ?? 0).toFixed(4)}</div>
          <div className="k-card-meta">总 API 费用 (USD)</div>
        </div>
        <div className="k-card">
          <div className="k-usage-total-value k-mono">{usage?.totals.episodes ?? 0}</div>
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
              {periods.map((period) => (
                <tr
                  key={period.episode_id}
                  className="k-usage-table-row"
                  onClick={() => navigate(`/episodes/${period.episode_id}`)}
                >
                  <td>
                    <Link to={`/episodes/${period.episode_id}`} onClick={(e) => e.stopPropagation()}>
                      {period.destination_name}
                    </Link>
                  </td>
                  <td>{period.persona_name}</td>
                  <td>{formatDate(period.created_at)}</td>
                  <td className="k-mono">{period.shot_count}</td>
                  <td className="k-mono">{period.credits_used}</td>
                  <td className="k-mono">{period.cost_usd.toFixed(4)}</td>
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
