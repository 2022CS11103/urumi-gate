import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AuditPage } from "./pages/Audit";
import { ChatPage } from "./pages/Chat";
import { LoginPage } from "./pages/Login";
import { ServersPage } from "./pages/Servers";
import { TeamPage } from "./pages/Team";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/servers" replace />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:threadId" element={<ChatPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/team" element={<TeamPage />} />
      </Route>
    </Routes>
  );
}
