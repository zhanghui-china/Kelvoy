import { useRef, useState } from "react";
import { LibraryFilters } from "./LibraryFilters";
import { filterDestinations, type LibraryType } from "./resource-library";
import { AssetImage } from "../AssetImage";
import { GuideTip } from "../GuideTip";
import { Link, useNavigate } from "react-router-dom";
import { getMe, listDestinations } from "../api/client";
import { createDestinationDraft, editDestination } from "../api/destination-drafts";
import { MIN_LANDMARK_REFS } from "../destination-refs";
import { canEditSharedDestination, destinationDraftError } from "../destination-draft-form";
import { useApiResource } from "../hooks/useApiResource";
import { DESTINATION_TYPE_LABELS } from "../labels";

export default function DestinationsPage() {
  const navigate = useNavigate();
  const user = useApiResource(getMe, []);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  async function create() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setFailure("");
    const result = await createDestinationDraft();
    lock.current = false; setBusy(false);
    if (result.ok) navigate(`/destinations/drafts/${encodeURIComponent(result.draft.draft_id)}`);
    else { if (result.error === "unauthorized") navigate("/login"); setFailure(destinationDraftError(result.error, result.message)); }
  }
  async function edit(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setFailure("");
    const result = await editDestination(id);
    lock.current = false; setBusy(false);
    if (result.ok) navigate(`/destinations/drafts/${encodeURIComponent(result.draft.draft_id)}`);
    else { if (result.error === "unauthorized") navigate("/login"); setFailure(destinationDraftError(result.error, result.message)); }
  }
  const [query, setQuery] = useState("");
  const [type, setType] = useState<LibraryType>("all");
  const [reload, setReload] = useState(0);
  const { loading, data, error } = useApiResource(listDestinations, [reload]);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error" role="alert">{destinationDraftError(error)} <button onClick={() => setReload(value => value + 1)}>重试</button></p>;
  const destinations = filterDestinations(data?.destinations ?? [], query, type);

  return (
    <div>
      <div className="k-eyebrow">官方与用户共享 · 实景为准</div>
      <h1>目的地库</h1>
      <GuideTip section="destinations">目的地包括官方资源与用户共享景区，地标以实景参考图为准。选好地方后可在<Link to="/episodes/new">新建一期</Link>中使用。</GuideTip>
      <button className="k-btn k-btn-primary" disabled={busy} onClick={() => void create()}>创建目的地</button> <Link className="k-btn k-btn-secondary" to="/destinations/drafts">我的草稿</Link>
      {failure && <p className="k-error" role="alert">{failure}</p>}
      <LibraryFilters label="目的地" query={query} type={type} onQuery={setQuery} onType={setType} count={destinations.length} />
      {destinations.length === 0 ? (
        <p className="k-empty">{query || type !== "all" ? "没有匹配的目的地，试试其他关键词或清除筛选。" : "还没有目的地。"}</p>
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
              {(d.country_code || d.province) && <p className="k-card-meta">{[d.country_code, d.province, d.city].filter(Boolean).join(" · ")}</p>}
              {d.description && <p className="k-card-meta">{d.description}</p>}
              <Link to={`/episodes/new?destination=${encodeURIComponent(d.destination_id)}`} className="k-btn k-btn-secondary">用这个目的地新建一期 →</Link>
              <span className="k-pill">{d.creator_id ? "用户共享" : "官方资源"}</span>
              {canEditSharedDestination(d.creator_id, user.data?.user.user_id) && <button className="k-btn k-btn-secondary" disabled={busy} onClick={() => void edit(d.destination_id)}>{busy ? "处理中…" : "编辑我的目的地"}</button>}
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
