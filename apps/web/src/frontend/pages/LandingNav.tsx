import type { MouseEvent } from "react";
import { Link } from "react-router-dom";

const NAV_ANCHORS: { id: string; label: string }[] = [
  { id: "solutions", label: "适合谁" },
  { id: "features", label: "产品优势" },
  { id: "how", label: "创作流程" },
  { id: "destinations", label: "目的地" },
  { id: "faq", label: "常见问题" },
];

// 手动 scrollIntoView + pushState 而不是纯 <a href="#id">：纯 hash 跳转没有
// 平滑滚动（要开 `html{scroll-behavior:smooth}` 得改 index.css，这次不碰），
// 自己接管点击既能要平滑滚动又能保留原生 hash 语义（浏览器前进/后退、
// 直接带 hash 访问都还能用，因为 href 本身没变，只是拦截了点击）。
function handleAnchorClick(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  window.history.pushState(null, "", `#${id}`);
}

export default function LandingNav() {
  return (
    <nav className="k-lp-nav" aria-label="官网导航">
      <a href="#top" className="k-lp-nav-brand" onClick={(e) => handleAnchorClick(e, "top")}>
        <span className="k-lp-logo-mark" aria-hidden="true">旅</span>
        <span>可旅<span className="k-lp-brand-en">Kelvoy</span></span>
      </a>
      <div className="k-lp-nav-links">
        {NAV_ANCHORS.map((a) => (
          <a key={a.id} href={`#${a.id}`} onClick={(e) => handleAnchorClick(e, a.id)}>
            {a.label}
          </a>
        ))}
      </div>
      <Link to="/login" className="k-lp-button k-lp-nav-cta">
        登录 / 开始创作 <span aria-hidden="true">→</span>
      </Link>
    </nav>
  );
}
