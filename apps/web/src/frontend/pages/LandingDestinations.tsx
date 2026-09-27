import type { Destination } from "@kelvoy/engine";
import { Link } from "react-router-dom";
import { DESTINATION_TYPE_LABELS } from "../labels";
import { AssetImage } from "../AssetImage";

interface Props {
  loading: boolean;
  error: string | null;
  destinations: Destination[];
}

export default function LandingDestinations({ loading, error, destinations }: Props) {
  return (
    <section id="destinations" className="k-lp-section k-lp-destinations">
      <div className="k-lp-section-head k-lp-section-head-center">
        <span className="k-lp-section-tag">真实目的地库</span>
        <h2>下一站，去哪里？</h2>
        <p>{loading || error ? "正在读取目的地…" : `目前有 ${destinations.length} 个目的地可供选择，每一处都关联实景参考。`}</p>
      </div>
      {loading ? (
        <p className="k-lp-state" role="status">目的地加载中…</p>
      ) : error ? (
        <p className="k-lp-state k-lp-state-error" role="alert">目的地加载失败：{error}</p>
      ) : destinations.length === 0 ? (
        <p className="k-lp-state">目的地库建设中，请稍后再来看看。</p>
      ) : (
        <div className="k-lp-dest-grid">
          {destinations.map((d) => {
            const refCount = d.landmarks.reduce((sum, l) => sum + l.refs.length, 0);
            const firstRef = d.landmarks[0]?.refs[0];
            return (
              <article className="k-lp-dest-card" key={d.destination_id}>
                <div className="k-lp-dest-image">
                  {firstRef ? <AssetImage src={`/api/destinations/${encodeURIComponent(d.destination_id)}/assets/${firstRef}`} alt={`${d.name}实景参考图`} /> : <div className="k-lp-dest-placeholder">暂无实景参考图</div>}
                  <span className="k-lp-dest-type">{DESTINATION_TYPE_LABELS[d.type] ?? d.type}</span>
                </div>
                <div className="k-lp-dest-info">
                  <h3>{d.name}</h3>
                  <p>{d.city}</p>
                  <div className="k-lp-dest-stats"><span>{d.landmarks.length} 个地标</span><span>{refCount} 张参考图</span></div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="k-lp-dest-action"><Link to="/login" className="k-lp-button-secondary">登录后选择目的地 <span aria-hidden="true">→</span></Link></div>
    </section>
  );
}
