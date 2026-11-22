import { NavLink, Outlet } from "react-router";
import { CaptureIcon, GrammarIcon, JournalIcon, ReviewIcon, SettingsIcon } from "./icons.tsx";
import s from "./Shell.module.css";

// Badges (inbox count, cards due, journal dot, stage) arrive with the data
// they count, from M1 on. Never a streak.
const tabs = [
  { to: "/", label: "Capture", Icon: CaptureIcon },
  { to: "/review", label: "Review", Icon: ReviewIcon },
  { to: "/journal", label: "Journal", Icon: JournalIcon },
  { to: "/grammar", label: "Grammar", Icon: GrammarIcon },
] as const;

/** Bottom tab bar below 900px, left sidebar at 900px and up. */
export function Shell() {
  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <p className={s.wordmark}>Carnet</p>
        <nav className={s.sideNav} aria-label="Main">
          {tabs.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end className={s.sideLink}>
              <Icon />
              {label}
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
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
