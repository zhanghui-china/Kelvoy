import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./layout/Layout";
import DestinationsPage from "./pages/DestinationsPage";
import EpisodeDetailPage from "./pages/EpisodeDetailPage";
import EpisodesPage from "./pages/EpisodesPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import PersonasPage from "./pages/PersonasPage";

// M2-7: read-only skeleton (ADR-0005). Brief form / review desk / template
// management pages are explicitly out of scope — those wait for M0 results.
// M2-11 (#38): "/" is the public marketing page, not a redirect into the
// authenticated workspace — that's reached via the nav after login.
// 比赛 demo 阶段不开放注册（防止其他参赛队误入），账号由 packages/cli 的
// create-user 预置，见 auth.ts。
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route path="/episodes" element={<EpisodesPage />} />
          <Route path="/episodes/:id" element={<EpisodeDetailPage />} />
          <Route path="/personas" element={<PersonasPage />} />
          <Route path="/destinations" element={<DestinationsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
