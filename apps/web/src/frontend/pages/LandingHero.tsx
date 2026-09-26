import { Link } from "react-router-dom";

// #38 定下的规则延续：次 CTA"看样片"要在没有真实成片时隐藏，不能放播放
// 假样片或占位视频（§1 MVP 明确不做"一键成片"，也不该在官网暗示已有现成
// 样片）。M0 出真实样片、#38 的播放页需求落地之后再加这颗按钮。
export default function LandingHero() {
  return (
    <section id="top" className="k-lp-hero">
      <div className="k-lp-hero-image" role="img" aria-label="山川与旅行中的目的地风景" />
      <div className="k-lp-hero-content">
      <div className="k-eyebrow">虚拟角色 × 真实目的地</div>
      <h1>一个虚拟角色，走遍你的每一个目的地</h1>
      <p>
        定一个跨期一致的虚拟角色，从目的地库选一个真实景区——地标以实景参考图为准，人只在脚本、关键帧、片段三个节点做
        选择，其余自动生成。一期 24–30 镜、约 30 秒、9:16 竖屏 vlog，同一角色走遍不同目的地，攒成一个旅行账号的内容。
      </p>
      <div className="k-lp-hero-cta">
        <Link to="/login" className="k-btn k-btn-primary">
          登录，出你的第一期
        </Link>
      </div>
      </div>
    </section>
  );
}
