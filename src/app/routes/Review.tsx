import { useNavigate } from "react-router";
import type { TodayView } from "../../shared/types.ts";
import { Button } from "../components/Button.tsx";
import { useToday } from "../lib/review.ts";
import s from "./screens.module.css";

const cards = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;
const minutes = (n: number) => {
  const m = Math.max(1, Math.round((n * 20) / 60));
  return `About ${m} ${m === 1 ? "minute" : "minutes"}.`;
};

/**
 * The Review tab: up to three sessions a day, each opening only when words
 * are really due, and practice, which never touches the schedule.
 */
export default function Review() {
  const today = useToday();
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
      ) : (
        <>
          <Session t={t} />
          {t.practice > 0 ? <Practice /> : null}
        </>
      )}
    </div>
  );
}

function Session({ t }: { t: TodayView }) {
  const navigate = useNavigate();
  const open = () => navigate(`/review/session?slot=${t.slot ?? "morning"}`);

  if (t.state === "in_progress") {
    return (
      <div className={s.sessionCard}>
        <p className={s.label}>{t.done > 0 ? "Another session" : "Today's session"}</p>
        <h2 className={s.sessionTitle}>
          {t.total - t.answered} of {t.total} cards left
        </h2>
        <p className={s.sessionLine}>Pick up where you stopped.</p>
        <Button variant="primary" block onClick={open}>
          Continue
        </Button>
      </div>
    );
  }

  if (t.state === "nothing_due") {
    return (
      <div className={s.empty}>
        <p className={s.emptyTitle}>Nothing due today.</p>
        <p>Add a word on Capture and it will be in today's session.</p>
      </div>
    );
  }

  if (t.state === "ready" && t.done === 0) {
    return (
      <div className={s.sessionCard}>
        <p className={s.label}>Today's session</p>
        <h2 className={s.sessionTitle}>{cards(t.total)}</h2>
        <p className={s.sessionLine}>{minutes(t.total)}</p>
        <Button variant="primary" block onClick={open}>
          Start
        </Button>
      </div>
    );
  }

  // At least one session is done today.
  return (
    <div className={s.sessionCard}>
      <p className={s.label}>Today</p>
      <h2 className={s.sessionTitle}>{t.state === "ready" ? "More is due." : "Done for today."}</h2>
      <p className={s.sessionLine}>
        {cards(t.reviewedToday)} reviewed so far.{" "}
        {t.state === "ready"
          ? `${cards(t.total)} ready for another session: words you've added since, or ones that didn't fit.`
          : t.slot
            ? "Words you add later today can go into another session."
            : "That's all three sessions for today. The rest come back when they're due."}
      </p>
      {t.state === "ready" ? (
        <Button variant="primary" block onClick={open}>
          Start another session
        </Button>
      ) : null}
    </div>
  );
}

function Practice() {
  const navigate = useNavigate();
  return (
    <div className={s.sessionCard}>
      <p className={s.label}>Practice</p>
      <h2 className={s.sessionTitle}>Go over words that aren't due.</h2>
      <p className={s.sessionLine}>
        Up to ten of your weakest words. It doesn't change when they come back, so it's safe whenever you like.
      </p>
      <Button block onClick={() => navigate("/review/session?slot=practice")}>
        Practise
      </Button>
    </div>
  );
}
