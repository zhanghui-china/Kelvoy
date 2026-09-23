import { Link, Outlet } from "react-router-dom";
import { logout } from "../api/client";

export default function Layout() {
  async function handleLogout() {
    await logout();
    window.location.assign("/login");
  }

  return (
    <div>
      <nav style={{ display: "flex", gap: "1rem", padding: "1rem", borderBottom: "1px solid #ddd" }}>
        <Link to="/episodes">期</Link>
        <Link to="/personas">角色</Link>
        <Link to="/destinations">目的地</Link>
        <span style={{ flex: 1 }} />
        <button onClick={handleLogout}>退出登录</button>
      </nav>
      <main style={{ padding: "1rem" }}>
        <Outlet />
      </main>
    </div>
  );
}
