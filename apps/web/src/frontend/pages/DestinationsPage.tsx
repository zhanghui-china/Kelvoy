import { AssetImage } from "../AssetImage";
import { listDestinations } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { DESTINATION_TYPE_LABELS } from "../labels";

const MIN_LANDMARK_REFS = 3;

export default function DestinationsPage() {
  const { loading, data, error } = useApiResource(listDestinations, []);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  const destinations = data?.destinations ?? [];

  return (
    <div>
      <div className="k-eyebrow">官方维护 · 实景为准</div>
      <h1>目的地库</h1>
      {destinations.length === 0 ? (
        <p className="k-empty">还没有目的地。</p>
      ) : (
        <div className="k-dest-lib-list">
          {destinations.map((d) => (
            <div className="k-card k-dest-lib-card" key={d.destination_id}>
              <div className="k-dest-lib-head">
                <div className="k-card-title">
                  {d.city} · {d.name}
                </div>
                <span className="k-pill k-pill-accent">{DESTINATION_TYPE_LABELS[d.type] ?? d.type}</span>
                {d.season_best.map((s) => (
                  <span className="k-pill" key={s}>
                    {s}
                  </span>
                ))}
              </div>
              {d.route.length > 0 && <div className="k-card-meta">动线：{d.route.join(" → ")}</div>}

              <div className="k-landmark-grid">
                {d.landmarks.map((l) => {
                  const enough = l.refs.length >= MIN_LANDMARK_REFS;
                  return (
                    <div className="k-landmark-card" key={l.id}>
                      {l.refs[0] ? (
                        <AssetImage src={`/api/assets/${l.refs[0]}`} alt={l.name} />
                      ) : (
                        <div className="k-media-missing">
                          <div className="k-card-meta">未上传</div>
                        </div>
                      )}
                      <div className="k-card-title">{l.name}</div>
                      <div className="k-card-meta">{l.best_time}</div>
                      {l.must_keep && l.must_keep.length > 0 && (
                        <div className="k-card-meta">须保真：{l.must_keep.join(" / ")}</div>
                      )}
                      <span className={`k-pill ${enough ? "k-pill-accent" : ""}`}>
                        {l.refs.length} 张参考图{enough ? "" : `（须 ≥ ${MIN_LANDMARK_REFS}）`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="k-dest-lib-meta">
                <div>
                  <span className="k-card-meta">地方饮食</span>
                  <div>{d.food.join("、") || "—"}</div>
                </div>
                <div>
                  <span className="k-card-meta">交通</span>
                  <div>{d.transport || "—"}</div>
                </div>
                <div>
                  <span className="k-card-meta">住宿</span>
                  <div>{d.stay || "—"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
