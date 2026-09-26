import type { Destination } from "@kelvoy/engine";
import { DESTINATION_TYPE_LABELS } from "../labels";
import { AssetImage } from "../AssetImage";

// 全页唯一的动态数据（#45 验收项）：真实调 GET /api/destinations，数量和每
// 条的地标数 / 参考图张数都是算出来的，不编 §3 首批五个景区的名字。
interface Props {
  loading: boolean;
  error: string | null;
  destinations: Destination[];
}

export default function LandingDestinations({ loading, error, destinations }: Props) {
  return (
    <section id="destinations" className="k-lp-section">
      <div className="k-lp-section-head">
        <div className="k-eyebrow">目的地库</div>
        <h2>
          已入库 <span className="k-mono">{loading || error ? "—" : destinations.length}</span> 个目的地
        </h2>
      </div>
      {loading ? (
        <p className="k-empty">加载中…</p>
      ) : error ? (
        <p className="k-error">加载失败：{error}</p>
      ) : destinations.length === 0 ? (
        <p className="k-empty">目的地库建设中，敬请期待。</p>
      ) : (
        <div className="k-lp-dest-grid">
          {destinations.map((d) => {
            const refCount = d.landmarks.reduce((sum, l) => sum + l.refs.length, 0);
            return (
              <div className="k-card k-lp-dest-card" key={d.destination_id}>
                <div className="k-lp-dest-image">{d.landmarks[0]?.refs[0] ? <AssetImage src={`/api/destinations/${encodeURIComponent(d.destination_id)}/assets/${d.landmarks[0].refs[0]}`} alt={`${d.name}实景`} /> : <div className="k-media-missing">暂无实景参考图</div>}</div>
                <div className="k-card-title">
                  {d.city} · {d.name}
                </div>
                <span className="k-pill">{DESTINATION_TYPE_LABELS[d.type] ?? d.type}</span>
                <div className="k-lp-dest-stats">
                  <span>
                    <span className="k-mono">{d.landmarks.length}</span> 个地标
                  </span>
                  <span>
                    <span className="k-mono">{refCount}</span> 张参考图
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
