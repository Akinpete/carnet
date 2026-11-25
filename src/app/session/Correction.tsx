// The correction interstitial, after the canvas's Correction.dc.html: a warm
// slide that is read, not answered. What you said, the fix, why, an example,
// where the word goes next, and "This was unfair".
import { useEffect, useRef, useState } from "react";
import type { Card } from "../../shared/cards.ts";
import type { AnswerResult } from "../../shared/types.ts";
import { Button } from "../components/Button.tsx";
import { api, unwrap } from "../lib/api.ts";
import s from "./Player.module.css";

type Props = {
  card: Extract<Card, { type: "comprehension" | "production" }>;
  answer: string;
  result: AnswerResult;
  sessionId: string;
  progress: string;
  onContinue: () => void;
};

export function Correction({ card, answer, result, sessionId, progress, onContinue }: Props) {
  const next = useRef<HTMLButtonElement>(null);
  const [contest, setContest] = useState<"idle" | "sending" | "sent">("idle");
  useEffect(() => next.current?.focus(), []);

  const j = result.judged;
  const passed = result.correct; // a note or a "nearly": it counts, with something to learn
  const production = card.type === "production";
  const rungFrom = card.rung;
  const rungTo = result.next.rung;

  const unfair = async () => {
    setContest("sending");
    try {
      await unwrap(api.sessions[":id"].contest.$post({ param: { id: sessionId }, json: { wordId: card.wordId } }));
      setContest("sent");
    } catch {
      setContest("idle");
    }
  };

  return (
    <div className={s.correction} role="dialog" aria-labelledby="correction-title">
      <div className={s.correctionTop}>
        <span id="correction-title" className={s.correctionLabel}>
          {passed ? "Nearly" : "Not quite"}
        </span>
        <span className={s.mono}>{progress}</span>
      </div>

      <div className={s.correctionBody}>
        <div className={s.correctionCard}>
          <p className={s.correctionLabel}>{production ? "You said" : "You answered"}</p>
          <p className={passed ? s.saidKept : s.saidStruck} lang={production ? "fr" : "en"}>
            {answer}
          </p>
          <hr className={s.rule} />
          {production ? (
            <>
              <p className={s.monoSmall}>{j?.corrected ? "A way to say it" : `${card.lemma} means`}</p>
              <p className={s.correctionFix} lang={j?.corrected ? "fr" : "en"}>
                {j?.corrected ?? result.expected}
              </p>
            </>
          ) : (
            <>
              <p className={s.monoSmall}>
                <span lang="fr">{card.form ?? card.lemma}</span> here means
              </p>
              <p className={s.correctionFix}>{result.expected}</p>
            </>
          )}
        </div>

        {j?.explanation ? (
          <div className={s.correctionPanel}>
            <p className={s.monoSmall}>{passed ? "Worth knowing" : "Why you missed it"}</p>
            <p className={s.correctionWhy}>{j.explanation}</p>
          </div>
        ) : null}

        {j?.example ? (
          <div className={s.correctionPanel}>
            <p className={s.monoSmall}>In use</p>
            <p className={s.correctionExample} lang="fr">
              « {j.example.fr} »
            </p>
            <p className={s.correctionEnglish}>{j.example.en}</p>
          </div>
        ) : !production ? (
          <div className={s.correctionPanel}>
            <p className={s.monoSmall}>In use</p>
            <p className={s.correctionExample} lang="fr">
              « {card.prompt} »
            </p>
          </div>
        ) : null}

        <p className={s.correctionNext}>
          {rungTo < rungFrom
            ? production
              ? "Back tomorrow as a sentence to understand before you say it again."
              : "Back tomorrow as a word to recall first."
            : passed
              ? "It counts. It stays on this rung a little longer."
              : "Back tomorrow, same question."}{" "}
          {rungTo !== rungFrom ? (
            <span className={s.correctionRung}>
              Rung {rungFrom} → {rungTo}
            </span>
          ) : null}
        </p>
      </div>

      <div className={s.correctionFoot}>
        <Button ref={next} variant="ink" block onClick={onContinue}>
          Got it — next card
        </Button>
        <Button variant="quiet" onClick={unfair} disabled={contest !== "idle"}>
          {contest === "sent" ? "Flagged. Thanks — it helps tune the grading." : "This was unfair"}
        </Button>
      </div>
    </div>
  );
}
