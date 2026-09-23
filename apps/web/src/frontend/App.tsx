import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./layout/Layout";
import DestinationsPage from "./pages/DestinationsPage";
import EpisodeDetailPage from "./pages/EpisodeDetailPage";
import EpisodesPage from "./pages/EpisodesPage";
import LoginPage from "./pages/LoginPage";
import PersonasPage from "./pages/PersonasPage";
import RegisterPage from "./pages/RegisterPage";

// M2-7: read-only skeleton (ADR-0005). Brief form / review desk / template
// management pages are explicitly out of scope — those wait for M0 results.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/episodes" replace />} />
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
