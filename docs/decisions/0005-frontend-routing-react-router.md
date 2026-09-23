# 0005 · 前端路由：react-router-dom（classic 模式，不用 data router）

- **Date**: 2026-09-24
- **Status**: Accepted

## Context

M2-7（前端骨架）要给 `apps/web/src/frontend` 加登录/注册、角色列表、目的地列表、期列表、期详情四个页面 + 导航。现在 `App.tsx` 只有一行占位 `h1`，没有任何路由方案。CLAUDE.md「不提前加依赖……先在 ADR 里定」——`react-router` 不是内置的，要加依赖就先在这定下来，不要写到一半改主意。

候选是 issue 里点名的 react-router，没有别的候选需要认真比较（`@tanstack/router` 之类没有被提出，且会引入额外的类型生成步骤，和"没有构建步骤"的仓库风格不搭）。真正要定的是**怎么用**：react-router v6 同时支持 classic 模式（`<BrowserRouter>` + `<Routes>`/`<Route>`，纯组件树里 `useEffect` 自己 fetch 数据）和 data router 模式（`createBrowserRouter` + `loader`/`action`，路由跳转前预加载数据、表单提交走 `action`）。

这一批页面全部是只读展示（角色/目的地/期列表 + 期详情轮询），没有表单提交需要 `action`，没有需要路由跳转前预加载的场景——`loader` 相对 `useEffect` fetch 的优势（避免 loading 瀑布、跳转前就开始加载）在只有单层路由、没有嵌套数据依赖的骨架阶段基本体现不出来。等 M0 之后拆 brief 表单、审片台交互页面（这两个issue 明确不在这次范围内）时，表单提交、乐观更新这些场景会让 data router 的 `action`/`loader` 更值得用，到时候再迁移不难（v6 两种模式共享底层路由匹配逻辑）。现在选更简单的 classic 模式。

## Decision

- 加依赖：`react-router-dom` v6（`^6.26.0`，不锁 v7——v7 把 data router 合并成默认使用方式且改了不少 API，现在用不到那些特性，没必要提前吃迁移成本）。浏览器 App 用 `react-router-dom`（带 `BrowserRouter`/`Link` 这些 DOM 绑定），不是裸 `react-router`（纯路由匹配核心，没有 `BrowserRouter`）。
- 用法：根组件 `<BrowserRouter>` 包一层，`<Routes>`/`<Route>` 声明式列路由，页面组件内部 `useEffect` + `fetch` 拿数据（配一个 `useApiResource` 小 hook 收敛 loading/error/401 跳转这几个列表页/详情页共用的样板代码，不是路由方案本身的一部分）。
- 不使用 `createBrowserRouter`/`loader`/`action`：等真的要写会提交数据的页面（brief 表单、审片台）时再评估要不要切,不在这次 ADR 里预先决定。

## Consequences

- 页面级别的数据请求逻辑留在组件里（`useEffect`），比 loader 模式多一次"组件挂载 → 发请求 → 拿到数据再渲染"的瀑布,但四个只读页面数据量小、无嵌套依赖，肉眼感知不到差异。
- 以后要迁移到 data router：路由声明本身改动不大（`<Route>` 的 path/element 基本可以照搬进 `createBrowserRouter` 的 route 对象），主要工作量在把每个页面的 `useEffect` fetch 改写成 `loader`，不是推倒重来。
- 401（session 过期/未登录）的处理方式：各页面的数据请求返回 `{ok:false, error:"unauthorized"}` 时用 `useNavigate()` 跳 `/login`，没有全局的登录态 context——cookie 是 httpOnly，前端本来就读不到，"当前是否登录"这件事只能靠"发请求试一下,401 就跳转"来判断,加一个额外的 `/api/auth/me` 之类的探测接口不在这个 issue 的交付范围里,也没有别的地方要用。
