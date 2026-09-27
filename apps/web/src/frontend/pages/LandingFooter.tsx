import { Link } from "react-router-dom";

export default function LandingFooter() {
  return (
    <>
      <section className="k-lp-bottom-cta">
        <div><span className="k-lp-bottom-glow" aria-hidden="true" /><h2>下一段旅程，从这里开始</h2><p>选一个角色、一处风景，让你的旅行故事有了第一帧。</p><Link to="/login" className="k-lp-button k-lp-button-light">登录并开始创作 <span aria-hidden="true">→</span></Link></div>
      </section>
      <footer className="k-lp-footer">
        <div className="k-lp-footer-inner">
          <div><a href="#top" className="k-lp-footer-brand"><span className="k-lp-logo-mark" aria-hidden="true">旅</span><span>可旅 Kelvoy</span></a><p>让每一场旅行都有 vlog。</p></div>
          <nav aria-label="页脚导航"><a href="#features">产品优势</a><a href="#how">创作流程</a><a href="#destinations">目的地</a><a href="#faq">常见问题</a><Link to="/login">登录</Link></nav>
        </div>
        <div className="k-lp-footer-bottom">可旅 Kelvoy · AI 旅行 Vlog 创作平台</div>
      </footer>
    </>
  );
}
