import "@fontsource/archivo/latin-400.css";
import "@fontsource/archivo/latin-500.css";
import "@fontsource/archivo/latin-600.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./styles/tokens.css";
import "./styles/base.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Shell } from "./components/Shell.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { useMe } from "./lib/session.ts";
import { Login, Signup } from "./routes/Auth.tsx";
import Capture from "./routes/Capture.tsx";

// Capture is the only screen in the initial bundle; the rest load on demand.
const Settings = lazy(() => import("./routes/Settings.tsx"));
const Review = lazy(() => import("./routes/Review.tsx"));
const Player = lazy(() => import("./session/Player.tsx"));
const Extract = lazy(() => import("./routes/Extract.tsx"));
const Journal = lazy(() => import("./routes/Placeholder.tsx").then((m) => ({ default: m.Journal })));
const Grammar = lazy(() => import("./routes/Placeholder.tsx").then((m) => ({ default: m.Grammar })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  if (isPending) return null;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  if (isPending) return null;
  if (me) return <Navigate to="/" replace />;
  return children;
}

const router = createBrowserRouter([
  { path: "/login", element: <PublicOnly><Login /></PublicOnly> },
  { path: "/signup", element: <PublicOnly><Signup /></PublicOnly> },
  // The session player takes the whole screen: no tab bar, one exit.
  { path: "/review/session", element: <RequireAuth><Suspense><Player /></Suspense></RequireAuth> },
  // So does review-before-commit: its action bar sits where the tab bar would.
  { path: "/inbox/:id", element: <RequireAuth><Suspense><Extract /></Suspense></RequireAuth> },
  {
    element: <RequireAuth><Shell /></RequireAuth>,
    children: [
      { index: true, element: <Capture /> },
      { path: "review", element: <Suspense><Review /></Suspense> },
      { path: "journal", element: <Suspense><Journal /></Suspense> },
      { path: "grammar", element: <Suspense><Grammar /></Suspense> },
      { path: "settings", element: <Suspense><Settings /></Suspense> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

const queryClient = new QueryClient();

// A new version's service worker takes over in the background (autoUpdate).
// Reload onto it straight away, so nobody keeps running last week's app,
// except mid-session, where the next navigation picks it up instead.
// Only on updates: on a first visit there was no worker to replace.
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!location.pathname.startsWith("/review/session")) location.reload();
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
