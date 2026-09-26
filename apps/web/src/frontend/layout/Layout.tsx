import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { logout } from "../api/client";
import { clearDraft } from "../pages/episode-draft";
import {
  DestinationIcon,
  HomeIcon,
  HelpIcon,
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
  { to: "/help", label: "帮助", Icon: HelpIcon },
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
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    clearDraft();
    try {
      localStorage.removeItem("kelvoy_username");
    } catch {
      // 同上，隐私模式下清不掉也无所谓——session cookie 才是真正的凭据。
    }
    window.location.assign("/login");
  }

  return (
    <div className="k-shell">
      <nav className={`k-sidebar${menuOpen ? " k-sidebar-open" : ""}`} aria-label="工作台导航">
        <div className="k-sidebar-header">
          <div className="k-sidebar-brand">
            <LogoMark size={24} />
            Kelvoy
          </div>
          <button
            type="button"
            className="k-sidebar-menu"
            aria-controls="workspace-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "收起菜单" : "菜单"}
          </button>
        </div>
        <div className="k-sidebar-drawer" id="workspace-navigation">
        <div className="k-sidebar-links">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/episodes"}
              className={({ isActive }) => `k-sidebar-link${isActive ? " active" : ""}`}
              aria-label={item.label}
              title={item.label}
              onClick={() => setMenuOpen(false)}
            >
              <item.Icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </div>
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
        </div>
      </nav>
      <main className="k-content">
        <Outlet />
      </main>
    </div>
  );
}
