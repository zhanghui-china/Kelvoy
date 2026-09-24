import { Link } from "react-router-dom";
import type { Destination, Episode } from "@kelvoy/engine";
import { listDestinations, listEpisodes, listPersonas } from "../api/client";
import { countRefs, hasEnoughRefs } from "../destination-refs";
import { episodeLabel, weekStats } from "../episode-view";
import { useApiResource } from "../hooks/useApiResource";
import { DESTINATION_TYPE_LABELS, EPISODE_STATUS_LABELS } from "../labels";

// #42：首页只回答"今天要干什么"，完整作品列表在 /works（WorksPage）。
const TERMINAL_STATUSES = new Set(["done", "failed"]);

// "最近作品"预览的条数，不分组不分页——看全部去我的作品页。
const RECENT_LIMIT = 6;

export default function HomePage() {
  const episodesRes = useApiResource(listEpisodes, []);
  const personasRes = useApiResource(listPersonas, []);
  const destinationsRes = useApiResource(listDestinations, []);

  if (episodesRes.loading) return <p className="k-empty">加载中…</p>;
  if (episodesRes.error) return <p className="k-error">加载失败：{episodesRes.error}</p>;

  const episodes = episodesRes.data?.episodes ?? [];
  const personas = personasRes.data?.personas ?? [];
  const personaById = new Map(personas.map((p) => [p.persona_id, p]));
  const destinationById = new Map(
    (destinationsRes.data?.destinations ?? []).map((d) => [d.destination_id, d]),
  );

  const byNewest = [...episodes].sort((a, b) => b.created_at.localeCompare(a.created_at));

  // "继续上次"：最近创建的、还没到 done/failed 的一期——真有这期才显示，
  // 不编一个占位卡片出来。
  const inProgress = byNewest.find((e) => !TERMINAL_STATUSES.has(e.status));

  // 每次渲染都用当下时间算周界：这页不轮询，停留跨过周一零点的概率可以忽略。
  const stats = weekStats(episodes, new Date());

  const recent = byNewest.slice(0, RECENT_LIMIT);

  function episodeMeta(e: Episode): string {
    const persona = personaById.get(e.persona_id)?.name ?? e.persona_id;
    const destination = destinationById.get(e.destination_id)?.name ?? e.destination_id;
    return `${persona} · ${destination} · ${EPISODE_STATUS_LABELS[e.status]}`;
  }

  return (
    <div>
      <div className="k-eyebrow">一期一个目的地</div>
      <h1>首页</h1>

      {inProgress && (
        <Link to={`/episodes/${inProgress.episode_id}`} className="k-card k-home-resume">
          <div className="k-eyebrow">继续上次</div>
          <div className="k-card-title">{episodeLabel(inProgress)}</div>
          <div className="k-card-meta">{episodeMeta(inProgress)}</div>
          <span className="k-btn k-btn-primary k-home-resume-btn">继续审片</span>
        </Link>
      )}

      <div className="k-home-section">
        <div className="k-home-section-head">
          <div className="k-eyebrow">本周</div>
        </div>
        <div className="k-home-week-grid">
          <div className="k-card">
            <div className="k-home-stat-value">{stats.doneEpisodes}</div>
            <div className="k-card-meta">本周完成期数</div>
          </div>
          <div className="k-card">
            <div className="k-home-stat-value">{stats.gpuMinutes}</div>
            <div className="k-card-meta">本周 GPU 分钟</div>
          </div>
          <div className="k-card">
            <div className="k-home-stat-value">{stats.approvedShots}</div>
            <div className="k-card-meta">本周审核过的镜数</div>
          </div>
        </div>
      </div>

      <div className="k-home-section">
        <div className="k-home-section-head">
          <div className="k-eyebrow">灵感目的地</div>
          <Link to="/destinations" className="k-home-section-more">
            目的地库 →
          </Link>
        </div>
        <DestinationStrip
          loading={destinationsRes.loading}
          error={destinationsRes.error}
          destinations={destinationsRes.data?.destinations ?? []}
        />
      </div>

      <div className="k-home-section">
        <div className="k-home-section-head">
          <div className="k-eyebrow">最近作品</div>
          <Link to="/works" className="k-home-section-more">
            查看全部 →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="k-empty">
            还没有期，<Link to="/episodes/new">新建一期</Link>开始第一期。
          </p>
        ) : (
          <div className="k-card k-series-list">
            {recent.map((e) => (
              <div className="k-series-row" key={e.episode_id}>
                <div>
                  <div className="k-card-title">{episodeLabel(e)}</div>
                </div>
                <div className="k-card-meta">{episodeMeta(e)}</div>
                <Link to={`/episodes/${e.episode_id}`} className="k-series-action">
                  {e.status === "done" ? "查看" : "继续"} →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 目的地库全列表横向排，顺序按 GET /api/destinations 的返回顺序（入库时间），
// 不做推荐、不做个性化（#42 明确排除）。参考图不足的也显示，只标一句。
function DestinationStrip(props: {
  loading: boolean;
  error: string | null;
  destinations: Destination[];
}) {
  if (props.loading) return <p className="k-empty">加载中…</p>;
  if (props.error) return <p className="k-error">目的地加载失败：{props.error}</p>;
  if (props.destinations.length === 0) return <p className="k-empty">目的地库建设中，敬请期待。</p>;

  return (
    <div className="k-dest-strip">
      {props.destinations.map((d) => (
        <Link
          key={d.destination_id}
          to={`/episodes/new?destination=${encodeURIComponent(d.destination_id)}`}
          className="k-card k-dest-strip-card"
        >
          <div className="k-card-title">{d.name}</div>
          <div className="k-card-meta">
            {d.city} · {DESTINATION_TYPE_LABELS[d.type] ?? d.type}
          </div>
          <div className="k-card-meta">
            <span className="k-mono">{d.landmarks.length}</span> 个地标 ·{" "}
            <span className="k-mono">{countRefs(d)}</span> 张参考图
          </div>
          {!hasEnoughRefs(d) && <span className="k-pill k-dest-strip-warn">参考图不足</span>}
        </Link>
      ))}
    </div>
  );
}
