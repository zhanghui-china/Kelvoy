import { Link } from "react-router-dom";

export default function LandingHero({ destinationCount }: { destinationCount: number | null }) {
  return (
    <section id="top" className="k-lp-hero">
      <div className="k-lp-hero-image" role="img" aria-label="旅行中的人物与海边目的地风景" />
      <div className="k-lp-hero-inner">
        <div className="k-lp-hero-content">
          <span className="k-lp-kicker"><span className="k-lp-kicker-dot" />AI 旅行 Vlog 创作平台</span>
          <h1>可旅，让每一场旅行<br /><span>都有 vlog</span></h1>
          <p>选一个角色和真实目的地，让人物走进风景。按阶段审核脚本与视频片段，完成属于你的旅行故事。</p>
          <div className="k-lp-hero-actions">
            <Link to="/login" className="k-lp-button k-lp-button-large">登录并开始创作 <span aria-hidden="true">→</span></Link>
            <a href="#how" className="k-lp-button-secondary">了解创作流程 <span aria-hidden="true">↗</span></a>
          </div>
          <div className="k-lp-hero-stats" aria-label="创作参数">
            <div><strong>24–30</strong><span>镜头 / 期</span></div>
            <div><strong>1 秒</strong><span>每镜成片时长</span></div>
            <div><strong>{destinationCount ?? "—"}</strong><span>已入库目的地</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
