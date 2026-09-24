import { Link } from "react-router-dom";

export default function LandingFooter() {
  return (
    <footer className="k-lp-footer">
      <span className="k-lp-nav-brand">Kelvoy</span>
      <span>成片自带 AI 标识与元数据：「AI 生成 · 虚构角色 · 真实目的地」。</span>
      <Link to="/login" className="k-lp-footer-login">
        登录
      </Link>
    </footer>
  );
}
