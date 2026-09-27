import { getMyCredits } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

const KIND_LABELS: Record<string, string> = {
  grant: "团队发放", reserve: "任务预留", settled: "任务完成", released: "失败退回",
};

export default function CreditPanel() {
  const { loading, data, error } = useApiResource(getMyCredits, []);
  return (
    <section className="k-card">
      <h2>积分账户</h2>
      <p className="k-card-meta">额度由团队发放。可用积分可用于新任务；预留积分已锁定待结算。成功后结算，失败时退回，下方列出实际记账流水。</p>
      {loading && <p className="k-card-meta">正在读取余额…</p>}
      {error && <p className="k-error" role="alert">余额加载失败：{error}</p>}
      {data && <>
        <div className="k-usage-totals">
          <div><strong className="k-usage-total-value k-mono">{data.balance.available}</strong><div className="k-card-meta">可用积分</div></div>
          <div><strong className="k-usage-total-value k-mono">{data.balance.reserved}</strong><div className="k-card-meta">任务预留</div></div>
        </div>
        <h3>最近流水</h3>
        {data.ledger.length === 0 ? <p className="k-card-meta">暂无积分流水。</p> : (
          <div className="k-desk-tablewrap"><table className="k-desk-table">
            <thead><tr><th>时间</th><th>动作</th><th>可用变化</th><th>预留变化</th></tr></thead>
            <tbody>{data.ledger.map((entry) => <tr key={entry.entry_id}>
              <td>{entry.created_at}</td><td>{KIND_LABELS[entry.kind] ?? entry.kind}</td>
              <td className="k-mono">{entry.available_delta > 0 ? "+" : ""}{entry.available_delta}</td>
              <td className="k-mono">{entry.reserved_delta > 0 ? "+" : ""}{entry.reserved_delta}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </>}
    </section>
  );
}
