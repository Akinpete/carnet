import { Link } from "react-router";
import { Button } from "../components/Button.tsx";
import { SettingsIcon } from "../components/icons.tsx";
import { frenchDayLabel } from "../lib/dates.ts";
import { useMe } from "../lib/session.ts";
import s from "./screens.module.css";

/** The default tab. M0 shows it empty; typed capture arrives in M1. */
export default function Capture() {
  const { data: me } = useMe();
  return (
    <div className={s.screen}>
      <header className={s.header}>
        <h1 className={s.wordmark}>Carnet</h1>
        <div className={s.headerRight}>
          <span className={s.label}>{frenchDayLabel(new Date(), me?.timezone)}</span>
          <Link to="/settings" className={`${s.iconLink} ${s.phoneOnly}`} aria-label="Settings">
            <SettingsIcon />
          </Link>
        </div>
      </header>

      <section className={s.section}>
        <label htmlFor="dump" className={s.label}>
          Add to the pool
        </label>
        <div className={s.captureBox}>
          <input id="dump" type="text" placeholder="A word, a phrase, or paste a link" disabled aria-describedby="dump-note" />
          <div className={s.captureActions}>
            <Button disabled>Paste image</Button>
            <Button variant="primary" disabled>
              Add
            </Button>
          </div>
        </div>
        <p id="dump-note" className={s.note}>
          Adding words arrives in the next update.
        </p>
      </section>

      <section className={s.section} aria-labelledby="inbox-label">
        <h2 id="inbox-label" className={s.label}>
          Inbox
        </h2>
        <div className={s.empty}>
          <p className={s.emptyTitle}>Nothing collected yet.</p>
          <p>The French you collect will wait here until you choose what to keep.</p>
        </div>
      </section>
    </div>
  );
}
