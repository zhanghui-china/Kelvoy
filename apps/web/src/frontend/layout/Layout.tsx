import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { logout } from "../api/client";

const NAV_ITEMS = [
  { to: "/episodes", label: "首页" },
  { to: "/episodes/new", label: "新建一期" },
  { to: "/personas", label: "角色" },
  { to: "/destinations", label: "目的地库" },
  { to: "/templates", label: "模板中心" },
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
        <div className="k-sidebar-brand">Kelvoy</div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/episodes"}
            className={({ isActive }) => `k-sidebar-link${isActive ? " active" : ""}`}
          >
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
          退出登录
        </button>
      </nav>
      <main className="k-content">
        <Outlet />
      </main>
    </div>
  );
}
