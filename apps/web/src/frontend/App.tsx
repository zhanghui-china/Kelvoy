import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./layout/Layout";
import DestinationsPage from "./pages/DestinationsPage";
import EpisodeDetailPage from "./pages/EpisodeDetailPage";
import HomePage from "./pages/HomePage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import NewEpisodePage from "./pages/NewEpisodePage";
import PersonaEditPage from "./pages/PersonaEditPage";
import PersonasPage from "./pages/PersonasPage";
import SettingsPage from "./pages/SettingsPage";
import SharePage from "./pages/SharePage";
import TemplatesPage from "./pages/TemplatesPage";
import UsagePage from "./pages/UsagePage";
import WorksPage from "./pages/WorksPage";

// M2-7: read-only skeleton (ADR-0005). Template management (M2-10, #32) and
// the brief form (M2-8, #30, /episodes/new below) are in scope; the review
// desk pages still wait for M0 results.
// M2-11 (#38): "/" is the public marketing page, not a redirect into the
// authenticated workspace — that's reached via the nav after login.
// 比赛 demo 阶段不开放注册（防止其他参赛队误入），账号由 packages/cli 的
// create-user 预置，见 auth.ts。
// M2-12~17（#40~#45）：/episodes 是首页仪表盘（HomePage），完整作品列表拆到
// /works（WorksPage）；/usage、/settings 的占位页在 M2-15/16 落地后已删除。
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/s/:slug" element={<SharePage />} />
        <Route element={<Layout />}>
          <Route path="/episodes" element={<HomePage />} />
          <Route path="/episodes/new" element={<NewEpisodePage />} />
          <Route path="/episodes/:id" element={<EpisodeDetailPage />} />
          <Route path="/works" element={<WorksPage />} />
          <Route path="/personas" element={<PersonasPage />} />
          <Route path="/personas/new" element={<PersonaEditPage />} />
          <Route path="/personas/:id/edit" element={<PersonaEditPage />} />
          <Route path="/destinations" element={<DestinationsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
