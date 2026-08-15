import { Routes, Route, Navigate } from "react-router-dom";
import { SocketProvider } from "./context/SocketContext.jsx";
import Chat from "./pages/Chat.jsx";
import AdminLogin from "./pages/admin/Login.jsx";
import AdminPanel from "./pages/admin/Panel.jsx";

export default function App() {
  return (
    <SocketProvider>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SocketProvider>
  );
}
