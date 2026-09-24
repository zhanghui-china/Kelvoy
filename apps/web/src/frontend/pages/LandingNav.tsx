import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "../icons";

// 六个锚点，顺序即导航顺序（#45 M2-17）。id 对应各 section 的锚点，label 是
// 导航展示文案——跟 section 大标题不同字，导航要短。
const NAV_ANCHORS: { id: string; label: string }[] = [
  { id: "top", label: "首页" },
  { id: "solutions", label: "为什么" },
  { id: "features", label: "护城河" },
  { id: "how", label: "怎么做" },
  { id: "destinations", label: "目的地库" },
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
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.pushState(null, "", `#${id}`);
}

export default function LandingNav() {
  return (
    <nav className="k-lp-nav">
      <a href="#top" className="k-lp-nav-brand" onClick={(e) => handleAnchorClick(e, "top")}>
        <LogoMark size={24} />
        Kelvoy
      </a>
      <div className="k-lp-nav-links">
        {NAV_ANCHORS.map((a) => (
          <a key={a.id} href={`#${a.id}`} onClick={(e) => handleAnchorClick(e, a.id)}>
            {a.label}
          </a>
        ))}
      </div>
      <Link to="/login" className="k-btn k-btn-primary k-lp-nav-cta">
        登录
      </Link>
    </nav>
  );
}
