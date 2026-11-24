// The card player: full screen, no tab bar, one exit ("Close"). Rungs 1–2
// are graded on the device for instant feedback; the server's grade is the
// record and reconciles if it ever disagrees. An answer that fails to save
// is retried and never stops the session. Rung 3 is judged by the model and
// is never optimistic: it shows "Checking…" until the grade arrives.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { gradeLocally, isLocal, stripAccents, type Card, type LocalAnswer, type LocalResult } from "../../shared/cards.ts";
import type { AnswerResult, SessionView } from "../../shared/types.ts";
import { Button } from "../components/Button.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useToast } from "../components/Toast.tsx";
import { ApiError } from "../lib/api.ts";
import { posLabel } from "../lib/labels.ts";
import { isPlaySlot, useAnswer, useCompleteSession, useStartSession } from "../lib/review.ts";
import s from "./Player.module.css";

const PASS_ADVANCE_MS = 600;

type Shown = LocalResult & { chosen: number | null; judged?: AnswerResult["judged"] };

export default function Player() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get("slot");
  const slot = isPlaySlot(requested) ? requested : "morning";
  const practice = slot === "practice";
  const toast = useToast();
  const start = useStartSession();
  const answer = useAnswer();
  const complete = useCompleteSession();

  const [session, setSession] = useState<SessionView | null>(null);
  const [index, setIndex] = useState(0);
  // A ref, not state: the auto-advance timer must read the latest count.
  const correctCount = useRef(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const [finished, setFinished] = useState<{ correct: number; total: number } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);

  const finish = useCallback(
    (s: SessionView) => {
      setFinished({ correct: correctCount.current, total: s.cards.length });
      complete.mutate(s.id);
    },
    [complete],
  );

  // Open (or resume) today's session once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start.mutate(slot, {
      onSuccess: (s) => {
        setSession(s);
        const done = new Set(s.answered.map((a) => a.wordId));
        const resumeAt = s.cards.findIndex((c) => !done.has(c.wordId));
        correctCount.current = s.answered.filter((a) => a.correct).length;
        if (resumeAt === -1) finish(s);
        else setIndex(resumeAt);
        shownAt.current = Date.now();
      },
    });
  }, [start, finish, slot]);

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);

  const card: Card | undefined = session?.cards[index];

  const advance = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (!session) return;
    setShown(null);
    setJudgeError(null);
    if (index + 1 >= session.cards.length) finish(session);
    else {
      setIndex(index + 1);
      shownAt.current = Date.now();
    }
  }, [session, index, finish]);

  /** Rung 3: wait for the model's judgement. A failure keeps the answer, to try again. */
  const submitJudged = (given: LocalAnswer) => {
    if (!session || !card || shown || judging) return;
    setJudging(true);
    setJudgeError(null);
    answer.mutate(
      { sessionId: session.id, wordId: card.wordId, latencyMs: Date.now() - shownAt.current, idempotencyKey: crypto.randomUUID(), ...given },
      {
        onSuccess: (server) => {
          if (server.correct) correctCount.current += 1;
          setShown({ correct: server.correct, expected: server.expected, accentSlip: false, chosen: null, judged: server.judged });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "already_answered") return advance();
          setJudgeError(err instanceof ApiError ? err.message : "Couldn't check that answer just now. Try again.");
        },
        onSettled: () => setJudging(false),
      },
    );
  };

  const submit = (given: LocalAnswer) => {
    if (!session || !card || shown) return;
    if (!isLocal(card)) return submitJudged(given);
    const local = gradeLocally(card, given);
    setShown({ ...local, chosen: "choice" in given ? given.choice : null });
    if (local.correct) correctCount.current += 1;

    answer.mutate(
      { sessionId: session.id, wordId: card.wordId, latencyMs: Date.now() - shownAt.current, idempotencyKey: crypto.randomUUID(), ...given },
      {
        onSuccess: (server) => {
          // The server's grade is the record. If it disagrees, show and count its result.
          if (server.correct !== local.correct) {
            correctCount.current += server.correct ? 1 : -1;
            setShown((current) => (current ? { ...current, correct: server.correct, accentSlip: server.accentSlip } : current));
          }
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "already_answered") return;
          toast("Couldn't save that answer. It will count from your next session.");
        },
      },
    );

    // A clean pass moves on by itself, unless there's a note worth reading.
    if (local.correct && !local.accentSlip && !card.usageNote) {
      advanceTimer.current = setTimeout(advance, PASS_ADVANCE_MS);
    }
  };

  const close = () => {
    const left = session ? session.cards.length - index - (shown ? 1 : 0) : 0;
    if (left > 0 && !finished) setConfirmClose(true);
    else navigate("/review");
  };

  if (start.isError) {
    const message = start.error instanceof ApiError ? start.error.message : "Couldn't open today's session.";
    return (
      <div className={s.player}>
        <div className={s.centre}>
          <p className={s.doneTitle}>{message}</p>
          <Button variant="secondary" onClick={() => navigate("/review")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className={s.player}>
        <div className={s.centre}>
          <p className={s.mono}>{practice ? "Practice done" : "Session done"}</p>
          <h1 className={s.doneTitle}>
            {finished.correct} of {finished.total} right.
          </h1>
          <p className={s.doneLine}>
            {practice
              ? "Practice doesn't change when words come back. Your sessions still decide that."
              : "Words you add later today can go into another session. The rest come back when they're due."}
          </p>
          <Button variant="ink" block onClick={() => navigate("/review")}>
            Back to Review
          </Button>
        </div>
      </div>
    );
  }

  if (!session || !card) return <div className={s.player} aria-busy="true" />;

  return (
    <div className={s.player}>
      <div className={s.top}>
        <div className={s.topRow}>
          <button type="button" className={s.close} onClick={close}>
            Close
          </button>
          <span className={s.mono}>
            {practice ? "Practice" : "Today"} · {index + 1} of {session.cards.length}
          </span>
        </div>
        <div
          className={s.progress}
          role="progressbar"
          aria-label="Session progress"
          aria-valuemin={0}
          aria-valuemax={session.cards.length}
          aria-valuenow={index}
        >
          <span style={{ width: `${(index / session.cards.length) * 100}%` }} />
        </div>
      </div>

      <main className={s.stage}>
        {card.type === "recognition" ? (
          <RecognitionView key={card.wordId} card={card} shown={shown} onAnswer={submit} onContinue={advance} />
        ) : card.type === "recall" ? (
          <RecallView key={card.wordId} card={card} shown={shown} onAnswer={submit} onContinue={advance} />
        ) : (
          <ComprehensionView
            key={card.wordId}
            card={card}
            shown={shown}
            judging={judging}
            error={judgeError}
            onAnswer={submit}
            onContinue={advance}
          />
        )}
      </main>

      <Sheet open={confirmClose} onClose={() => setConfirmClose(false)} title="Leave the session?">
        <p className={s.doneLine}>
          {practice ? "Practice doesn't change your schedule, so nothing is lost." : "Your answers so far are saved. You can finish it later today."}
        </p>
        <Button variant="ink" block onClick={() => navigate("/review")}>
          Leave
        </Button>
        <Button variant="secondary" block onClick={() => setConfirmClose(false)}>
          Keep going
        </Button>
      </Sheet>
    </div>
  );
}

type ViewProps<C extends Card> = {
  card: C;
  shown: Shown | null;
  onAnswer: (answer: LocalAnswer) => void;
  onContinue: () => void;
};

function Verdict({ shown, note, onContinue }: { shown: Shown; note: string | null; onContinue: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const waits = !shown.correct || shown.accentSlip || !!note;
  useEffect(() => {
    if (waits) ref.current?.focus();
  }, [waits]);
  return (
    <div className={s.verdict} role="status">
      <p className={shown.correct ? s.right : s.wrong}>
        {shown.correct ? <CheckIcon /> : <CrossIcon />}
        {shown.correct
          ? shown.accentSlip
            ? <span>Right. Watch the accents: <strong lang="fr">{shown.expected}</strong></span>
            : <span>Right.</span>
          : <span>Not quite. It's <strong>{shown.expected}</strong>.</span>}
      </p>
      {note ? <p className={s.note}>{note}</p> : null}
      {waits ? (
        <Button ref={ref} variant="ink" block onClick={onContinue}>
          Continue
        </Button>
      ) : null}
    </div>
  );
}

function RecognitionView({ card, shown, onAnswer, onContinue }: ViewProps<Extract<Card, { type: "recognition" }>>) {
  // Keys 1–4 choose, before an answer is given.
  useEffect(() => {
    if (shown) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= card.choices.length) onAnswer({ choice: n - 1 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, shown, onAnswer]);

  return (
    <>
      <section className={s.card} aria-label="Recognition card">
        <div className={s.cardHead}>
          <span className={s.monoSmall}>{posLabel(card.pos, card.gender)}</span>
          <span className={s.monoSmall}>Rung 1 · Recognition</span>
        </div>
        <p className={s.word} lang="fr">
          {card.prompt}
        </p>
        <hr className={s.rule} />
        <p className={s.ask}>What does it mean?</p>
        <div className={s.choices}>
          {card.choices.map((choice, i) => {
            const state = !shown
              ? ""
              : i === card.answerIndex
                ? s.choiceRight
                : i === shown.chosen
                  ? s.choiceWrong
                  : s.choiceIdle;
            return (
              <button
                key={choice}
                type="button"
                className={`${s.choice} ${state}`}
                disabled={!!shown}
                onClick={() => onAnswer({ choice: i })}
                aria-keyshortcuts={String(i + 1)}
              >
                {choice}
              </button>
            );
          })}
        </div>
        {shown ? <Verdict shown={shown} note={card.usageNote ?? null} onContinue={onContinue} /> : null}
      </section>
      {!shown ? (
        <Button variant="quiet" className={s.dontKnow} onClick={() => onAnswer({ dontKnow: true })}>
          I don't know this one
        </Button>
      ) : null}
    </>
  );
}

function RecallView({ card, shown, onAnswer, onContinue }: ViewProps<Extract<Card, { type: "recall" }>>) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onAnswer({ text });
  };
  return (
    <>
      <section className={s.card} aria-label="Recall card">
        <div className={s.cardHead}>
          <span className={s.monoSmall}>{posLabel(card.pos, card.gender)}</span>
          <span className={s.monoSmall}>Rung 2 · Recall</span>
        </div>
        <p className={s.ask}>Say it in French</p>
        <p className={s.english}>{card.prompt}</p>
        {card.gloss ? <p className={s.gloss}>{card.gloss}</p> : null}
        <hr className={s.rule} />
        <form className={s.recallForm} onSubmit={submit}>
          <label htmlFor="recall" className="visually-hidden">
            The French
          </label>
          <input
            id="recall"
            className={s.recallInput}
            lang="fr"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Type the French"
            value={text}
            readOnly={!!shown}
            onChange={(e) => setText(e.target.value)}
          />
          {!shown ? (
            <Button type="submit" variant="primary" block disabled={!text.trim()}>
              Check
            </Button>
          ) : null}
        </form>
        {shown ? <Verdict shown={shown} note={card.usageNote ?? null} onContinue={onContinue} /> : null}
      </section>
      {!shown ? (
        <Button variant="quiet" className={s.dontKnow} onClick={() => onAnswer({ dontKnow: true })}>
          I don't know this one
        </Button>
      ) : null}
    </>
  );
}

/** Marks the word where it sits in the sentence. */
function highlight(sentence: string, form: string | null) {
  if (!form) return sentence;
  const fold = (t: string) => stripAccents(t.toLowerCase());
  const at = fold(sentence).indexOf(fold(form));
  if (at === -1 || fold(sentence).length !== sentence.length) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      <mark className={s.mark}>{sentence.slice(at, at + form.length)}</mark>
      {sentence.slice(at + form.length)}
    </>
  );
}

function JudgedVerdict({ shown, card, onContinue }: { shown: Shown; card: Extract<Card, { type: "comprehension" }>; onContinue: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const close = shown.judged?.close ?? false;
  const explanation = shown.judged?.explanation ?? null;
  return (
    <div className={s.verdict} role="status">
      <p className={shown.correct ? s.right : s.wrong}>
        {shown.correct ? <CheckIcon /> : <CrossIcon />}
        {shown.correct && !close ? (
          <span>
            Right. Here it means <strong>{shown.expected}</strong>.
          </span>
        ) : shown.correct ? (
          <span>
            Nearly. Here it means <strong>{shown.expected}</strong>.
          </span>
        ) : (
          <span>
            Not quite. Here it means <strong>{shown.expected}</strong>.
          </span>
        )}
      </p>
      {explanation ? <p className={s.note}>{explanation}</p> : null}
      {card.usageNote && !explanation ? <p className={s.note}>{card.usageNote}</p> : null}
      <Button ref={ref} variant="ink" block onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

type ComprehensionProps = ViewProps<Extract<Card, { type: "comprehension" }>> & { judging: boolean; error: string | null };

function ComprehensionView({ card, shown, judging, error, onAnswer, onContinue }: ComprehensionProps) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && !judging) onAnswer({ text });
  };
  const shownForm = card.form ?? card.lemma;
  return (
    <>
      <section className={s.card} aria-label="Comprehension card" aria-busy={judging || undefined}>
        <div className={s.cardHead}>
          <span className={s.monoSmall}>{posLabel(card.pos, card.gender)}</span>
          <span className={s.monoSmall}>Rung 3 · In context</span>
        </div>
        <blockquote className={s.sentence} lang="fr">
          « {highlight(card.prompt, card.form)} »
        </blockquote>
        {card.source === "example" ? <p className={s.monoSmall}>An example sentence</p> : null}
        <hr className={s.rule} />
        <p className={s.ask}>
          What does <strong lang="fr">{shownForm}</strong> mean here?
        </p>
        <form className={s.recallForm} onSubmit={submit}>
          <label htmlFor="meaning" className="visually-hidden">
            The meaning, in English
          </label>
          <input
            id="meaning"
            className={s.meaningInput}
            lang="en"
            autoFocus
            autoComplete="off"
            enterKeyHint="go"
            placeholder="In English"
            maxLength={200}
            value={text}
            readOnly={!!shown || judging}
            onChange={(e) => setText(e.target.value)}
          />
          {!shown ? (
            <Button type="submit" variant="primary" block disabled={!text.trim() || judging}>
              {judging ? "Checking…" : error ? "Try again" : "Check"}
            </Button>
          ) : null}
          {error && !judging ? (
            <p className={s.judgeError} role="alert">
              {error}
            </p>
          ) : null}
        </form>
        {shown ? <JudgedVerdict shown={shown} card={card} onContinue={onContinue} /> : null}
      </section>
      {!shown && !judging ? (
        <Button variant="quiet" className={s.dontKnow} onClick={() => onAnswer({ dontKnow: true })}>
          I don't know this one
        </Button>
      ) : null}
    </>
  );
}

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <path d="M2.5 6.8 5.2 9.5l5.3-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CrossIcon = () => (
  <svg width="16" height="16" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <path d="M3.5 3.5l6 6M9.5 3.5l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
