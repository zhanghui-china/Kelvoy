import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { logout } from "../api/client";
import { clearDraft } from "../pages/episode-draft";
import AccountSummary from "./AccountSummary";
import { focusWrapIndex } from "./dialog-focus";
import { readCollapsed, saveCollapsed } from "./sidebar-preference";
import { Button, ErrorState } from "../ui";
import {
  DestinationIcon, HomeIcon, HelpIcon, LogoMark, LogoutIcon, NewEpisodeIcon,
  PersonaIcon, SettingsIcon, TemplateIcon, UsageIcon, WorksIcon, MenuIcon, CloseIcon,
} from "../icons";

const NAV_GROUPS = [
  { label: "工作台", items: [
    { to: "/episodes", label: "首页", Icon: HomeIcon },
    { to: "/episodes/new", label: "新建一期", Icon: NewEpisodeIcon },
    { to: "/works", label: "我的作品", Icon: WorksIcon },
  ] },
  { label: "资源库", items: [
    { to: "/personas", label: "角色", Icon: PersonaIcon },
    { to: "/destinations", label: "目的地库", Icon: DestinationIcon },
    { to: "/templates", label: "模板中心", Icon: TemplateIcon },
  ] },
  { label: "账户", items: [
    { to: "/usage", label: "积分与用量", Icon: UsageIcon },
    { to: "/settings", label: "设置", Icon: SettingsIcon },
    { to: "/help", label: "帮助", Icon: HelpIcon },
  ] },
];

export function workspaceTitle(path: string): string {
  if (/^\/destinations\/drafts\/?$/.test(path)) return "我的目的地草稿";
  if (/^\/destinations\/drafts\/[^/]+\/?$/.test(path)) return "编辑目的地草稿";
  if (path === "/personas/new") return "新建角色";
  if (/^\/personas\/[^/]+\/edit\/?$/.test(path)) return "编辑角色";
  if (/^\/episodes\/(?!new\/?$)[^/]+\/?$/.test(path)) return "作品详情";
  return NAV_GROUPS.flatMap((group) => group.items).find((item) => item.to === path.replace(/\/$/, ""))?.label ?? "工作台";
}

export default function Layout() {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => { setMobile(media.matches); setMenuOpen(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const dialog = dialogRef.current!;
    const previousOverflow = document.body.style.overflow;
    // Native modal dialog supplies focus containment, inert background and Escape.
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      menuRef.current?.focus();
    };
  }, [menuOpen, mobile]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const result = await logout();
    setLoggingOut(false);
    if (!result.ok) { setLogoutError("退出登录失败，请重试。"); return; }
    clearDraft();
    window.location.assign("/login");
  }

  const navigation = <>
    <nav className="k-sidebar-links" aria-label="工作台导航">
      {NAV_GROUPS.map((group) => <section className="k-nav-group" key={group.label} aria-label={group.label}>
        <div className="k-nav-group-label">{group.label}</div>
        {group.items.map((item) => <NavLink key={item.to} to={item.to} end={item.to === "/episodes"}
          className={({ isActive }) => `k-sidebar-link${isActive ? " active" : ""}`}
          aria-label={item.label} title={item.label} onClick={() => setMenuOpen(false)}>
          <item.Icon size={20} /><span className="k-nav-label">{item.label}</span>
        </NavLink>)}
      </section>)}
    </nav>
    <div className="k-sidebar-footer">
      <AccountSummary />
      <Button variant="secondary" className="k-sidebar-logout" aria-label="退出登录" title="退出登录"
        disabled={loggingOut} onClick={handleLogout}>
        <LogoutIcon size={18} /><span className="k-nav-label">{loggingOut ? "退出中…" : "退出登录"}</span>
      </Button>
      {mobile && logoutError && <ErrorState message={logoutError} onRetry={handleLogout} retrying={loggingOut} />}
    </div>
  </>;

  return <div className={`k-shell${collapsed ? " k-shell-collapsed" : ""}`}>
    <a className="k-skip-link" href="#workspace-content">跳到主要内容</a>
    {!mobile && <aside className="k-sidebar">
      <div className="k-sidebar-header">
        <div className="k-sidebar-brand"><LogoMark size={28} /><span className="k-nav-label">可旅 Kelvoy</span></div>
        <Button variant="ghost" className="k-icon-button" aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"} aria-expanded={!collapsed}
          onClick={() => { setCollapsed(!collapsed); saveCollapsed(!collapsed); }}><MenuIcon /></Button>
      </div>
      {navigation}
    </aside>}
    <div className="k-main">
      <header className="k-topbar">
        <button ref={menuRef} type="button" className="k-btn k-btn-ghost k-icon-button k-mobile-menu"
          aria-label="打开工作台导航" aria-expanded={menuOpen} aria-controls="workspace-navigation"
          onClick={() => setMenuOpen(true)}><MenuIcon /></button>
        <span className="k-topbar-title">{workspaceTitle(pathname)}</span>
        <span className="k-topbar-brand">可旅 Kelvoy</span>
      </header>
      <main className="k-content" id="workspace-content" tabIndex={-1}>
        {!menuOpen && logoutError && <ErrorState message={logoutError} onRetry={handleLogout} retrying={loggingOut} />}
        <Outlet />
      </main>
    </div>
    {mobile && <dialog ref={dialogRef} id="workspace-navigation" className="k-mobile-drawer" aria-label="工作台导航"
      onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex="0"]',
        )].filter((element) => element.getClientRects().length > 0);
        const target = focusWrapIndex(focusable.indexOf(document.activeElement as HTMLElement), focusable.length, event.shiftKey);
        if (target !== null) { event.preventDefault(); focusable[target]?.focus(); }
      }}
      onClick={(event) => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setMenuOpen(false);
      } }}>
      <div className="k-sidebar-header">
        <div className="k-sidebar-brand"><LogoMark /><span>可旅 Kelvoy</span></div>
        <Button variant="ghost" className="k-icon-button" aria-label="关闭导航" onClick={() => setMenuOpen(false)}><CloseIcon /></Button>
      </div>
      {menuOpen && navigation}
    </dialog>}
  </div>;
}
