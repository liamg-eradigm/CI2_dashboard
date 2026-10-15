/** The Epilepsy project's pages (request 61). */
import { Navigate, Route, Routes } from "react-router-dom";
import type { Me } from "@eradigm/shared";
import { LaunchesPage } from "./pages/LaunchesPage";
import { NewsPage } from "./pages/NewsPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { RcaPage } from "./pages/RcaPage";
import { TrialsPage } from "./pages/TrialsPage";
import "./styles/epilepsy.css";

export const PAGES = [
  { path: "/news", label: "News" },
  { path: "/competitors", label: "Competitor Profiles" },
  { path: "/launches", label: "Asset Launches" },
  { path: "/rca", label: "RCA" },
  { path: "/trials", label: "Trial Tracker" },
] as const;

export function EpilepsyApp({ me }: { me: Me }) {
  return (
    <Routes>
      <Route path="/news" element={<NewsPage me={me} />} />
      <Route path="/competitors" element={<ProfilesPage me={me} />} />
      <Route path="/launches" element={<LaunchesPage me={me} />} />
      <Route path="/rca" element={<RcaPage me={me} />} />
      <Route path="/trials" element={<TrialsPage me={me} />} />
      <Route path="*" element={<Navigate to="/news" replace />} />
    </Routes>
  );
}
