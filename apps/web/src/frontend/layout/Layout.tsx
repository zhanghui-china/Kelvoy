import { NavLink, Outlet } from "react-router-dom";
import { logout } from "../api/client";

export default function Layout() {
  async function handleLogout() {
    await logout();
    window.location.assign("/login");
  }

  return (
    <div>
      <nav className="k-nav">
        <span className="k-nav-brand">Kelvoy</span>
        <NavLink to="/episodes" className={({ isActive }) => `k-nav-link${isActive ? " active" : ""}`}>
          期
        </NavLink>
        <NavLink to="/personas" className={({ isActive }) => `k-nav-link${isActive ? " active" : ""}`}>
          角色
        </NavLink>
        <NavLink to="/destinations" className={({ isActive }) => `k-nav-link${isActive ? " active" : ""}`}>
          目的地
        </NavLink>
        <span className="k-nav-spacer" />
        <button type="button" className="k-btn k-btn-secondary" onClick={handleLogout}>
          退出登录
        </button>
      </nav>
      <main className="k-page">
        <Outlet />
      </main>
    </div>
  );
}
