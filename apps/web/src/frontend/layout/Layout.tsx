import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { logout } from "../api/client";
import {
  DestinationIcon,
  HomeIcon,
  LogoMark,
  LogoutIcon,
  NewEpisodeIcon,
  PersonaIcon,
  SettingsIcon,
  TemplateIcon,
  UsageIcon,
  WorksIcon,
} from "../icons";

// 侧栏 8 项（M2-12, #40 把 5 项扩到 7 项；M2-14, #42 把完整作品列表从首页
// 拆出来后再加一项"我的作品"）。label 用"用量"而不是"积分与用量"：PRD §14
// 明确这一版不做积分/余额，导航里出现"积分"会让人以为有充值体系（#44）。
const NAV_ITEMS = [
  { to: "/episodes", label: "首页", Icon: HomeIcon },
  { to: "/episodes/new", label: "新建一期", Icon: NewEpisodeIcon },
  { to: "/works", label: "我的作品", Icon: WorksIcon },
  { to: "/personas", label: "角色", Icon: PersonaIcon },
  { to: "/destinations", label: "目的地库", Icon: DestinationIcon },
  { to: "/templates", label: "模板中心", Icon: TemplateIcon },
  { to: "/usage", label: "用量", Icon: UsageIcon },
  { to: "/settings", label: "设置", Icon: SettingsIcon },
];

function readStoredUsername(): string | null {
  try {
    return localStorage.getItem("kelvoy_username");
  } catch {
    return null;
  }
}

export default function Layout() {
  const [username] = useState(readStoredUsername);

  async function handleLogout() {
    await logout();
    try {
      localStorage.removeItem("kelvoy_username");
    } catch {
      // 同上，隐私模式下清不掉也无所谓——session cookie 才是真正的凭据。
    }
    window.location.assign("/login");
  }

  return (
    <div className="k-shell">
      <nav className="k-sidebar">
        <div className="k-sidebar-brand">
          <LogoMark size={24} />
          Kelvoy
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/episodes"}
            className={({ isActive }) => `k-sidebar-link${isActive ? " active" : ""}`}
          >
            <item.Icon size={20} />
            {item.label}
          </NavLink>
        ))}
        <span className="k-sidebar-spacer" />
        {username && (
          <div className="k-sidebar-account">
            <span className="k-sidebar-account-label">当前账号</span>
            <span className="k-sidebar-account-name">{username}</span>
          </div>
        )}
        <button type="button" className="k-btn k-sidebar-logout" onClick={handleLogout}>
          <LogoutIcon size={18} />
          退出登录
        </button>
      </nav>
      <main className="k-content">
        <Outlet />
      </main>
    </div>
  );
}
