// Rung 4, after the canvas's Speak.dc.html: a dark card, a round mic you
// hold (or tap) to speak, a level meter or live transcript, and the text to
// check before sending. "Type it instead" is always there.
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import type { ProductionCard } from "../../shared/cards.ts";
import { Button } from "../components/Button.tsx";
import { useSpeech } from "../lib/speech.ts";
import s from "./Player.module.css";

export type SpokenAnswer = { text: string; mode: "spoken" | "typed"; edited: boolean };

type Props = {
  card: ProductionCard;
  judging: boolean;
  error: string | null;
  onSend: (answer: SpokenAnswer) => void;
  onSkip: () => void;
};

/** A press shorter than this is a tap: recording keeps going until the next tap. */
const TAP_MS = 350;

export function ProductionView({ card, judging, error, onSend, onSkip }: Props) {
  const speech = useSpeech();
  const [typing, setTyping] = useState(speech.path === "none");
  const [draft, setDraft] = useState("");
  const pressedAt = useRef(0);
  const toggled = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // The transcript lands in the editable field; sending it untouched is the one-tap path.
  useEffect(() => {
    if (speech.state === "done") setDraft(speech.text);
  }, [speech.state, speech.text]);

  const listening = speech.state === "listening";
  const heard = speech.state === "done";
  const showField = typing || heard;

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (listening) {
      // Second tap of tap-to-talk.
      toggled.current = false;
      return speech.stop();
    }
    pressedAt.current = Date.now();
    toggled.current = false;
    speech.start();
  };
  const up = () => {
    if (!listening && speech.state !== "idle") return;
    if (Date.now() - pressedAt.current < TAP_MS) toggled.current = true;
    else speech.stop();
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || judging) return;
    onSend({ text, mode: typing && !heard ? "typed" : "spoken", edited: heard && text !== speech.text.trim() });
  };

  const typeInstead = () => {
    speech.reset();
    setTyping(true);
    setDraft("");
    requestAnimationFrame(() => field.current?.focus());
  };

  const status = judging
    ? "Checking…"
    : speech.state === "transcribing"
      ? "Transcribing…"
      : listening
        ? toggled.current
          ? "Tap to stop"
          : "Release when you're done"
        : heard
          ? "Check it, then send"
          : "Hold to speak";

  return (
    <section className={s.speak} aria-label="Production card" aria-busy={judging || undefined}>
      <div>
        <p className={s.speakLabel}>Rung 4 · Production</p>
        <p className={s.speakAsk}>{typing ? "Write a sentence of your own using" : "Say a sentence of your own using"}</p>
        <p className={s.word} lang="fr">
          {card.lemma}
        </p>
        <p className={s.speakMeaning}>{card.translation}</p>
      </div>

      {showField ? (
        <form className={s.speakForm} onSubmit={send}>
          <label htmlFor="sentence" className={s.speakLabel}>
            {typing && !heard ? "Your sentence" : "What Carnet heard"}
          </label>
          <textarea
            id="sentence"
            ref={field}
            className={s.speakField}
            lang="fr"
            rows={2}
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={400}
            value={draft}
            readOnly={judging}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
            }}
          />
          <Button type="submit" variant="primary" block disabled={!draft.trim() || judging}>
            {judging ? "Checking…" : error ? "Try again" : "Send"}
          </Button>
          {error && !judging ? (
            <p className={s.judgeError} role="alert">
              {error}
            </p>
          ) : null}
          {heard && !judging ? (
            <Button variant="quiet" onClick={() => (speech.reset(), setDraft(""))}>
              Say it again
            </Button>
          ) : null}
        </form>
      ) : (
        <>
          <div className={s.listening} aria-live="polite">
            <p className={s.speakLabel}>{listening ? "Listening" : speech.state === "transcribing" ? "Transcribing" : "Your sentence"}</p>
            <p className={s.speakTranscript} lang="fr">
              « {speech.interim || (listening ? "" : "…")}
              {listening ? <span className={s.speakEllipsis}> …</span> : null} »
            </p>
            {speech.path === "cloud" ? (
              <div className={s.meter} role="img" aria-label="Microphone level">
                {speech.levels.map((l, i) => (
                  <span key={i} style={{ height: `${Math.max(4, Math.round(l * 26))}px` }} className={l > 0.15 ? s.meterOn : ""} />
                ))}
              </div>
            ) : null}
            {speech.error ? (
              <p className={s.judgeError} role="alert">
                {speech.error}
              </p>
            ) : null}
          </div>
          <div className={s.micRow}>
            <button
              type="button"
              className={`${s.mic} ${listening ? s.micOn : ""}`}
              aria-label={listening ? "Stop" : "Hold to speak"}
              aria-pressed={listening}
              disabled={speech.state === "transcribing" || judging}
              onPointerDown={down}
              onPointerUp={up}
              onPointerCancel={up}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key !== " " && e.key !== "Enter") return;
                e.preventDefault();
                if (listening) speech.stop();
                else {
                  toggled.current = true;
                  speech.start();
                }
              }}
            >
              <svg width="24" height="30" viewBox="0 0 16 20" fill="none" aria-hidden="true">
                <rect x="5" y="1" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M1.5 9a6.5 6.5 0 0 0 13 0M8 15.5V19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className={s.speakHint}>{status}</p>
        </>
      )}

      <div className={s.speakFoot}>
        {!typing ? (
          <button type="button" className={s.typeInstead} onClick={typeInstead} disabled={judging}>
            Type it instead
          </button>
        ) : speech.path !== "none" ? (
          <button type="button" className={s.typeInstead} onClick={() => (setTyping(false), setDraft(""))} disabled={judging}>
            Say it instead
          </button>
        ) : null}
        <Button variant="quiet" onClick={onSkip} disabled={judging}>
          Skip — I can't say this yet
        </Button>
      </div>
    </section>
  );
}
