import { NavLink, Outlet } from "react-router";
import { useToday } from "../lib/review.ts";
import { CaptureIcon, GrammarIcon, JournalIcon, ReviewIcon, SettingsIcon } from "./icons.tsx";
import s from "./Shell.module.css";

// Badges are the only prompt the product gives. Review shows cards left
// today; the inbox count, journal dot and stage arrive with M2, M4 and M5.
// Never a streak.
const tabs = [
  { to: "/", label: "Capture", Icon: CaptureIcon },
  { to: "/review", label: "Review", Icon: ReviewIcon },
  { to: "/journal", label: "Journal", Icon: JournalIcon },
  { to: "/grammar", label: "Grammar", Icon: GrammarIcon },
] as const;

/** Bottom tab bar below 900px, left sidebar at 900px and up. */
export function Shell() {
  const today = useToday().data;
  const left = today && (today.state === "ready" || today.state === "in_progress") ? today.total - today.answered : 0;
  const badges: Record<string, string> = left > 0 ? { "/review": `${left} due` } : {};

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <p className={s.wordmark}>Carnet</p>
        <nav className={s.sideNav} aria-label="Main">
          {tabs.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end className={s.sideLink}>
              <Icon />
              {label}
              {badges[to] ? <span className={s.sideBadge}>{badges[to]}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className={s.spacer} />
        <NavLink to="/settings" className={s.sideLink}>
          <SettingsIcon />
          Settings
        </NavLink>
      </aside>

      <main className={s.main}>
        <Outlet />
      </main>

      <nav className={s.tabbar} aria-label="Main">
        {tabs.map(({ to, label }) => (
          <NavLink key={to} to={to} end className={s.tab}>
            <span>{label}</span>
            {badges[to] ? <span className={s.badge}>{badges[to]}</span> : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
