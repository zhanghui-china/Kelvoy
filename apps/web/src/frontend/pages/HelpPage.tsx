import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { updateMySettings } from "../api/client";
import { GUIDE_RESOURCES, GUIDE_SECTIONS, guideHref } from "../guide";
import "./HelpPage.css";

const GUIDE_ANCHORS = new Set([...GUIDE_SECTIONS.map((section) => section.id), ...GUIDE_RESOURCES.map((resource) => resource.id), "retries", "faq"]);

/** Router hash changes do not always trigger the browser's native anchor scroll. */
export function focusGuideHash(hash: string, doc: { getElementById(id: string): { scrollIntoView(): void; focus(): void } | null }): boolean {
  let id: string;
  try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch { return false; }
  if (!GUIDE_ANCHORS.has(id)) return false;
  const target = doc.getElementById(id);
  if (!target) return false;
  target.scrollIntoView();
  target.focus();
  return true;
}

/** A repeated click on the current hash does not change location, so focus explicitly. */
export function GuideJumpLink({ section, currentHash, children }: {
  section: (typeof GUIDE_SECTIONS)[number]["id"];
  currentHash: string;
  children: React.ReactNode;
}) {
  const targetHash = `#${section}`;
  return <Link to={guideHref(section)} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (currentHash === targetHash) focusGuideHash(targetHash, document);
  }}>{children}</Link>;
}

/** Resetting to zero makes the current onboarding version visible on /episodes. */
export function reopenOnboarding() {
  return updateMySettings({ onboarding_dismissed_version: 0 });
}

function ReopenOnboarding() {
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">("idle");

  async function reopen() {
    setState("pending");
    try {
      const result = await reopenOnboarding();
      setState(result.ok ? "success" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="k-card k-help-reopen" aria-labelledby="reopen-heading">
      <div>
        <h2 id="reopen-heading">想再看一次新手引导？</h2>
        <p>引导会重新出现在<Link to="/episodes">作品首页</Link>，已完成的创作记录仍会保留。</p>
      </div>
      <div className="k-help-reopen-actions">
        <button type="button" className="k-btn k-btn-secondary" disabled={state === "pending"} onClick={() => void reopen()}>
          {state === "pending" ? "正在恢复…" : "重新显示新手引导"}
        </button>
        {state === "pending" && <span role="status">正在保存设置…</span>}
        {state === "success" && <span role="status">已恢复。<Link to="/episodes">去作品首页查看 →</Link></span>}
        {state === "error" && <span role="alert">恢复失败，请重试。</span>}
      </div>
    </section>
  );
}

export default function HelpPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) focusGuideHash(hash, document);
  }, [hash]);

  return (
    <div className="k-help-page">
      <div className="k-eyebrow">使用指南</div>
      <h1>从第一期到可分享的旅行作品</h1>
      <p className="k-page-intro">一期开一个角色与真实目的地的旅行故事。按下面六步创作，脚本、关键帧和片段由你逐关审核。</p>

      <section className="k-help-quick" aria-labelledby="quick-start-heading">
        <div>
          <div className="k-eyebrow">3 分钟上手</div>
          <h2 id="quick-start-heading">先看一遍路线，再开始第一期</h2>
          <p>直接使用官方角色，选择目的地与模板；创建后按页面顺序审核。生成会花时间和积分，提交前查看预估积分，处理失败可在作品页重试失败任务。</p>
          <Link to="/episodes/new" className="k-btn k-btn-primary">新建一期 →</Link>
        </div>
        <ol className="k-help-map">
          {GUIDE_SECTIONS.map((section) => <li key={section.id}><GuideJumpLink section={section.id} currentHash={hash}><span>{section.number}</span>{section.title}</GuideJumpLink></li>)}
        </ol>
      </section>

      <nav className="k-help-prep" aria-label="创作前可查看">
        <span>创作前可查看：</span>
        <Link to="/personas">角色库</Link>
        <Link to="/destinations">目的地库</Link>
        <Link to="/templates">模板库</Link>
        <Link to="/settings">出片默认设置</Link>
      </nav>

      <section className="k-help-resources" aria-label="创作资源说明">
        <article className="k-card" id="personas" tabIndex={-1}><h2>角色怎么选</h2><p><Link to="/personas">官方角色</Link>已经可用，直接选就能开始。想持续使用自己的原创角色，可在角色页新建并上传多个视角的参考图；它们有助于跨期保持形象一致。</p></article>
        <article className="k-card" id="destinations" tabIndex={-1}><h2>目的地看什么</h2><p>在<Link to="/destinations">目的地库</Link>查看景区地标和实景参考，选与你想呈现的行程相符的地方。缺少足够参考图的地标会提示，生成前先核对地标与季节。</p></article>
        <article className="k-card" id="templates" tabIndex={-1}><h2>模板如何搭配</h2><p>新建一期会按目的地类型预选匹配的模板；高级设置可手动换。去<Link to="/templates">模板库</Link>查看骨架、调色、片头片尾和标题样式，选与你的叙事相符的组合。</p></article>
        <article className="k-card" id="settings" tabIndex={-1}><h2>出片默认值</h2><p>在<Link to="/settings">设置页</Link>保存默认语气与每镜 1–3 张候选图；只预填之后新建的作品，每期仍可改。候选越多，用量通常越高，提交前看预估积分。</p></article>
        <article className="k-card" id="credits" tabIndex={-1}><h2>积分与流水</h2><p>团队发放积分；可用余额可用于新任务，任务预留会先锁定积分，成功结算，失败退回。到<Link to="/usage">用量页</Link>看可用、预留余额及实际流水。</p></article>
      </section>

      <div className="k-help-stages">
        {GUIDE_SECTIONS.map((section) => <section className="k-card k-help-stage" id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`} tabIndex={-1}>
          <div className="k-help-stage-heading"><span className="k-help-step">{section.number}</span><div><h2 id={`${section.id}-heading`}>{section.title}</h2><p>{section.summary}</p></div></div>
          <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="k-help-review"><strong>通过前看什么：</strong>{section.review}</p>
          <Link to={section.href}>{section.action} →</Link>
        </section>)}
      </div>

      <section className="k-card k-help-extra" id="retries" tabIndex={-1}>
        <h2>失败、重试与积分</h2>
        <p>后台生成失败时，在对应作品页查看原因并点“重新执行失败任务”。已有的产物和已通过镜头会保留。对某一镜不满意，可在审核页重生成；不同操作可能增加实际用量，请在提交前看预估积分，并在 <Link to="/usage">用量页</Link>查看实际积分记录。</p>
        <p>脚本可直接编辑、按指令优化或重新生成；暂不支持 CSV/PDF 导出。片段审核中的首次报告坏镜提供一次免费重生成，其他重生成可能消耗积分，实际用量可在用量页查看。</p>
        <Link to="/works">去我的作品查看进度 →</Link>
      </section>

      <section className="k-card k-help-extra" id="faq" tabIndex={-1}>
        <h2>常见问题</h2>
        <dl>
          <dt>必须先上传自己的角色吗？</dt><dd>不必。<Link to="/personas">官方角色</Link>可直接使用；想让原创角色跨期保持一致，再新建自己的角色。</dd>
          <dt>能横屏吗？</dt><dd>可以。<Link to="/episodes/new">新建一期</Link>默认 9:16，可切换 16:9。</dd>
          <dt>候选图会自动挑最好的一张吗？</dt><dd>不会。关键帧审核需要你逐镜选择，没有自动排名。</dd>
          <dt>分享会帮我发布到平台吗？</dt><dd>不会。开启分享只生成可访问的作品链接；平台发布需自行完成。</dd>
        </dl>
      </section>
      <ReopenOnboarding />
    </div>
  );
}
