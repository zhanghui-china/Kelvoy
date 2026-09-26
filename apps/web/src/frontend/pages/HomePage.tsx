import { useState } from "react";
import { Link } from "react-router-dom";
import type { Destination, DestinationType, Episode } from "@kelvoy/engine";
import { AssetImage } from "../AssetImage";
import { getMySettings, listDestinations, listEpisodes, listPersonas, updateMySettings } from "../api/client";
import { OnboardingChecklist } from "../OnboardingChecklist";
import { GuideTip } from "../GuideTip";
import { deriveOnboarding } from "../onboarding";
import { countRefs, hasEnoughRefs } from "../destination-refs";
import { episodeLabel, weekStats } from "../episode-view";
import { useApiResource } from "../hooks/useApiResource";
import { DESTINATION_TYPE_LABELS, EPISODE_STATUS_LABELS } from "../labels";

const TERMINAL_STATUSES = new Set(["done", "failed"]);
const RECENT_LIMIT = 5;
const CAPABILITIES = [
  { number: "01", title: "固定角色", body: "管理角色形象与参考图，让同一个人跨期出镜。", to: "/personas", action: "查看角色" },
  { number: "02", title: "真实目的地", body: "从地标、动线与实景参考图出发构建旅程。", to: "/destinations", action: "浏览目的地" },
  { number: "03", title: "创作模板", body: "选择与目的地类型匹配的叙事和视觉设置。", to: "/templates", action: "查看模板" },
  { number: "04", title: "逐步审核", body: "在脚本、关键帧和片段节点检查实际生成结果。", to: "/works", action: "继续作品" },
];

export default function HomePage() {
  const episodesRes = useApiResource(listEpisodes, []);
  const personasRes = useApiResource(listPersonas, []);
  const destinationsRes = useApiResource(listDestinations, []);
  const [settingsRetry, setSettingsRetry] = useState(0);
  const settingsRes = useApiResource(getMySettings, [settingsRetry]);
  const [dismissedOverride, setDismissedOverride] = useState<0 | 1 | null>(null);
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const [dismissPending, setDismissPending] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<DestinationType | "all">("all");

  if (episodesRes.loading) return <p className="k-empty">加载中…</p>;
  if (episodesRes.error) return <p className="k-error">加载失败：{episodesRes.error}</p>;

  const episodes = episodesRes.data?.episodes ?? [];
  const personas = personasRes.data?.personas ?? [];
  const destinations = destinationsRes.data?.destinations ?? [];
  const personaById = new Map(personas.map((p) => [p.persona_id, p]));
  const destinationById = new Map(destinations.map((d) => [d.destination_id, d]));
  const byNewest = [...episodes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const inProgress = byNewest.find((e) => !TERMINAL_STATUSES.has(e.status));
  const stats = weekStats(episodes, new Date());
  const recent = byNewest.slice(0, RECENT_LIMIT);
  const types = [...new Set(destinations.map((d) => d.type))];
  const shownDestinations = typeFilter === "all" ? destinations : destinations.filter((d) => d.type === typeFilter);
  const onboarding = deriveOnboarding(episodes);
  const dismissal = dismissedOverride ?? settingsRes.data?.settings.onboarding_dismissed_version;
  const collapsed = collapsedOverride ?? (onboarding.completed[4] && dismissal !== 0);

  async function dismissOnboarding() {
    setDismissPending(true);
    setDismissError(null);
    const result = await updateMySettings({ onboarding_dismissed_version: 1 });
    setDismissPending(false);
    if (result.ok) setDismissedOverride(1);
    else setDismissError("引导状态保存失败，请重试。");
  }

  function episodeMeta(e: Episode): string {
    const persona = personaById.get(e.persona_id)?.name ?? e.persona_id;
    const destination = destinationById.get(e.destination_id)?.name ?? e.destination_id;
    return `${persona} · ${destination} · ${EPISODE_STATUS_LABELS[e.status]}`;
  }

  return (
    <div className="k-home-page">
      <div className="k-home-welcome">
        <div>
          <div className="k-eyebrow">创作工作台</div>
          <h1>开启下一段旅程</h1>
          <p>选一个角色，去一个真实的地方，创作属于你的旅行故事。</p>
          <Link to="/episodes/new" className="k-btn k-btn-primary">新建一期 <span aria-hidden="true">↗</span></Link>
          <GuideTip section="create">可直接选官方角色和目的地开始，无需先上传参考图或创建模板。</GuideTip>
        </div>
        <div className="k-home-welcome-art" aria-hidden="true"><span>Kelvoy</span><strong>让故事<br />走向远方。</strong></div>
      </div>

      {settingsRes.loading ? <p className="k-empty">正在加载创作指引…</p> : settingsRes.error ? (
        <div className="k-card k-onboarding"><p className="k-error">创作指引加载失败。</p><button type="button" className="k-btn k-btn-secondary" onClick={() => setSettingsRetry((n) => n + 1)}>重试</button></div>
      ) : dismissal !== 1 && (
        <><OnboardingChecklist {...onboarding} collapsed={collapsed} pending={dismissPending}
          onToggle={() => setCollapsedOverride(!collapsed)} onDismiss={() => void dismissOnboarding()} />
          {dismissError && <p className="k-error" role="alert">{dismissError}</p>}</>
      )}

      {inProgress && (
        <Link to={`/episodes/${inProgress.episode_id}`} className="k-card k-home-resume">
          <span className="k-eyebrow">继续上次</span>
          <span className="k-card-title">{episodeLabel(inProgress)}</span>
          <span className="k-card-meta">{episodeMeta(inProgress)}</span>
          <span className="k-home-resume-link">继续创作 →</span>
        </Link>
      )}

      <section className="k-home-section" aria-labelledby="home-capabilities">
        <div className="k-home-section-head"><div><div className="k-eyebrow">创作流程</div><h2 id="home-capabilities">你的创作空间</h2></div></div>
        <div className="k-home-capability-grid">
          {CAPABILITIES.map((item) => (
            <Link className="k-card k-home-capability" key={item.number} to={item.to}>
              <span className="k-home-capability-number">{item.number}</span>
              <strong>{item.title}</strong><span>{item.body}</span><em>{item.action} →</em>
            </Link>
          ))}
        </div>
      </section>

      <section className="k-home-section" aria-labelledby="home-destinations">
        <div className="k-home-section-head"><div><div className="k-eyebrow">旅行灵感</div><h2 id="home-destinations">发现目的地</h2></div><Link to="/destinations" className="k-home-section-more">查看全部 →</Link></div>
        {destinationsRes.loading ? <p className="k-empty">加载中…</p> : destinationsRes.error ? <p className="k-error">目的地加载失败：{destinationsRes.error}</p> : destinations.length === 0 ? <p className="k-empty">目的地库建设中，敬请期待。</p> : (
          <>
            <div className="k-home-filters" role="group" aria-label="按目的地类型筛选">
              <button type="button" className={typeFilter === "all" ? "active" : ""} aria-pressed={typeFilter === "all"} onClick={() => setTypeFilter("all")}>全部</button>
              {types.map((type) => <button type="button" key={type} className={typeFilter === type ? "active" : ""} aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type)}>{DESTINATION_TYPE_LABELS[type]}</button>)}
            </div>
            <div className="k-home-dest-grid">
              {shownDestinations.map((d) => <DestinationCard key={d.destination_id} destination={d} />)}
            </div>
          </>
        )}
      </section>

      <section className="k-home-section" aria-labelledby="home-recent">
        <div className="k-home-section-head"><div><div className="k-eyebrow">作品记录</div><h2 id="home-recent">最近作品</h2></div><Link to="/works" className="k-home-section-more">查看全部 →</Link></div>
        {recent.length === 0 ? <p className="k-empty">还没有期，<Link to="/episodes/new">新建一期</Link>开始第一期。</p> : (
          <div className="k-card k-series-list">
            {recent.map((e) => <div className="k-series-row" key={e.episode_id}><div><div className="k-card-title">{episodeLabel(e)}</div><div className="k-card-meta">{episodeMeta(e)}</div></div><span className="k-pill">{EPISODE_STATUS_LABELS[e.status]}</span><Link to={`/episodes/${e.episode_id}`} className="k-series-action">{e.status === "done" ? "查看" : "继续"} →</Link></div>)}
          </div>
        )}
      </section>

      <section className="k-home-section k-home-week" aria-label="本周实际记录">
        <div className="k-home-section-head"><div><div className="k-eyebrow">数据概览</div><h2>本周记录</h2></div><Link to="/usage" className="k-home-section-more">查看用量 →</Link></div>
        <div className="k-home-week-grid"><div className="k-card"><div className="k-home-stat-value">{stats.doneEpisodes}</div><div className="k-card-meta">本周完成期数</div></div><div className="k-card"><div className="k-home-stat-value">{stats.gpuMinutes}</div><div className="k-card-meta">本周已用积分</div></div><div className="k-card"><div className="k-home-stat-value">{stats.approvedShots}</div><div className="k-card-meta">本周通过的镜数</div></div></div>
      </section>
    </div>
  );
}

function DestinationCard({ destination: d }: { destination: Destination }) {
  const firstRef = d.landmarks.flatMap((landmark) => landmark.refs)[0];
  return (
    <Link to={`/episodes/new?destination=${encodeURIComponent(d.destination_id)}`} className="k-home-dest-card">
      <div className="k-home-dest-image">{firstRef ? <AssetImage src={`/api/assets/${firstRef}`} alt={`${d.name}实景`} /> : <div className="k-media-missing">暂无实景参考图</div>}<span className="k-home-dest-type">{DESTINATION_TYPE_LABELS[d.type] ?? d.type}</span></div>
      <div className="k-home-dest-content"><span className="k-card-meta">{d.city}</span><strong>{d.name}</strong><span className="k-card-meta">{d.landmarks.length} 个地标 · {countRefs(d)} 张参考图</span>{!hasEnoughRefs(d) && <span className="k-home-dest-warning">参考图不足</span>}</div>
    </Link>
  );
}
