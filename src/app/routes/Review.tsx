import { useNavigate } from "react-router";
import { Button } from "../components/Button.tsx";
import { useToday } from "../lib/review.ts";
import s from "./screens.module.css";

/** The Review tab: today's one session and where it stands. */
export default function Review() {
  const today = useToday();
  const navigate = useNavigate();
  const t = today.data;

  return (
    <div className={s.screen}>
      <header className={s.header}>
        <h1 className={s.wordmark}>Review</h1>
      </header>

      {today.isPending ? null : today.isError || !t ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>Couldn't load today's session.</p>
          <p>Check your connection and try again.</p>
        </div>
      ) : t.state === "nothing_due" ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>Nothing due today.</p>
          <p>Add a word on Capture and it will be in today's session.</p>
        </div>
      ) : t.state === "completed" ? (
        <div className={s.sessionCard}>
          <p className={s.label}>Today</p>
          <h2 className={s.sessionTitle}>Done for today.</h2>
          <p className={s.sessionLine}>
            {t.answered} {t.answered === 1 ? "card" : "cards"} reviewed. Your next session opens tomorrow.
          </p>
        </div>
      ) : (
        <div className={s.sessionCard}>
          <p className={s.label}>Today's session</p>
          <h2 className={s.sessionTitle}>
            {t.state === "in_progress" ? `${t.total - t.answered} of ${t.total} cards left` : `${t.total} ${t.total === 1 ? "card" : "cards"}`}
          </h2>
          <p className={s.sessionLine}>
            {t.state === "in_progress"
              ? "Pick up where you stopped."
              : `About ${Math.max(1, Math.round((t.total * 20) / 60))} ${t.total * 20 < 90 ? "minute" : "minutes"}.`}
          </p>
          <Button variant="primary" block onClick={() => navigate("/review/session")}>
            {t.state === "in_progress" ? "Continue" : "Start"}
          </Button>
        </div>
      )}
    </div>
  );
}
