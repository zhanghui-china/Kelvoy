import { Link } from "react-router-dom";

export default function HelpPage() {
  return (
    <div className="k-help-page">
      <div className="k-eyebrow">使用指南</div>
      <h1>从角色到旅行作品</h1>
      <p className="k-page-intro">每一期让一个角色前往一个真实目的地。开始前，准备好角色参考图并从目的地库选择景区。</p>
      <div className="k-help-grid">
        <section className="k-card"><span className="k-help-step">01</span><h2>准备角色</h2><p>在角色页建立可跨期复用的形象，上传不同视角的参考图，并设置稳定的外观特征。</p><Link to="/personas">管理角色 →</Link></section>
        <section className="k-card"><span className="k-help-step">02</span><h2>选择目的地</h2><p>浏览真实地标、路线和参考图。参考图不足的地标会在库中标出。</p><Link to="/destinations">查看目的地 →</Link></section>
        <section className="k-card"><span className="k-help-step">03</span><h2>创建并审核</h2><p>选择角色、目的地与模板后创建一期。脚本、关键帧和片段生成后，按页面提示逐一审核。</p><Link to="/episodes/new">新建一期 →</Link></section>
        <section className="k-card"><span className="k-help-step">04</span><h2>查看作品与用量</h2><p>在我的作品中继续未完成的期，在用量页查看已有生成记录与成本。</p><Link to="/works">我的作品 →</Link></section>
      </div>
    </div>
  );
}
