import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { DashboardLayout } from "@/layouts";

const dashboardPages = {
  Dashboard: () => import("@/pages/dashboard"),
  Chats: () => import("@/pages/chats"),
  ViewChat: () => import("@/pages/chats/components/View"),
  SystemPrompts: () => import("@/pages/system-prompts"),
  Settings: () => import("@/pages/settings"),
  DevSpace: () => import("@/pages/dev"),
  Shortcuts: () => import("@/pages/shortcuts"),
  Audio: () => import("@/pages/audio"),
  Screenshot: () => import("@/pages/screenshot"),
  Responses: () => import("@/pages/responses"),
  Knowledge: () => import("@/pages/knowledge"),
  Meetings: () => import("@/pages/meetings"),
  Notes: () => import("@/pages/notes"),
};

const App = lazy(() => import("@/pages/app"));
const Dashboard = lazy(dashboardPages.Dashboard);
const Chats = lazy(dashboardPages.Chats);
const ViewChat = lazy(dashboardPages.ViewChat);
const SystemPrompts = lazy(dashboardPages.SystemPrompts);
const Settings = lazy(dashboardPages.Settings);
const DevSpace = lazy(dashboardPages.DevSpace);
const Shortcuts = lazy(dashboardPages.Shortcuts);
const Audio = lazy(dashboardPages.Audio);
const Screenshot = lazy(dashboardPages.Screenshot);
const Responses = lazy(dashboardPages.Responses);
const Knowledge = lazy(dashboardPages.Knowledge);
const Meetings = lazy(dashboardPages.Meetings);
const Notes = lazy(dashboardPages.Notes);

export default function AppRoutes() {
  useEffect(() => {
    // The overlay window only needs "/"; the dashboard warms its other pages
    // after first paint so sidebar navigation never waits on a chunk.
    if (window.location.pathname === "/") return;
    const warm = () => Object.values(dashboardPages).forEach((load) => void load());
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 500);
    return () => clearTimeout(id);
  }, []);

  return (
    <Router>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chats" element={<Chats />} />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/system-prompts" element={<SystemPrompts />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/chats/view/:conversationId" element={<ViewChat />} />
            <Route path="/shortcuts" element={<Shortcuts />} />
            <Route path="/screenshot" element={<Screenshot />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audio" element={<Audio />} />
            <Route path="/responses" element={<Responses />} />
            <Route path="/dev-space" element={<DevSpace />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}
