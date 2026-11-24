// Review before commit (the canvas's Extract.dc.html): the one deliberate
// friction in the product, where the learner decides what's worth learning.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { stripAccents } from "../../shared/cards.ts";
import type { CandidateView, DumpDetail } from "../../shared/types.ts";
import { Button } from "../components/Button.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useToast } from "../components/Toast.tsx";
import { ApiError } from "../lib/api.ts";
import { posLabel } from "../lib/labels.ts";
import { useCommitDump, useCorrectCandidate, useDiscardDump, useDump } from "../lib/pool.ts";
import s from "./Extract.module.css";

const NUMBERS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const spell = (n: number) => NUMBERS[n] ?? String(n);
const words = (n: number) => `${n} ${n === 1 ? "word" : "words"}`;

export default function Extract() {
  const { id = "" } = useParams();
  const dump = useDump(id);

  const notFound = dump.error instanceof ApiError && dump.error.status === 404;
  return (
    <div className={s.screen}>
      <div className={s.top}>
        <Link to="/" className={s.back}>
          ← Inbox
        </Link>
      </div>
      {dump.data?.status === "awaiting_review" ? (
        <Review dump={dump.data} />
      ) : dump.data ? (
        <Status dump={dump.data} />
      ) : notFound ? (
        <div className={s.body}>
          <h1 className={s.title}>Nothing here.</h1>
          <p className={s.lead}>This was discarded, or it never existed.</p>
        </div>
      ) : dump.error ? (
        <div className={s.body}>
          <p className={s.error}>{dump.error.message}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Anything not waiting for review: still looking, failed, or already kept. */
function Status({ dump }: { dump: DumpDetail }) {
  const discard = useDiscardDump();
  const navigate = useNavigate();
  return (
    <div className={s.body}>
      {dump.status === "extracting" ? (
        <>
          <h1 className={s.title}>Looking it up…</h1>
          <p className={s.lead} aria-live="polite">
            Picking out the words worth learning. This takes a few seconds.
          </p>
        </>
      ) : dump.status === "failed" ? (
        <>
          <h1 className={s.title}>That didn't work.</h1>
          <p className={s.error}>{dump.error ?? "Something went wrong."}</p>
          <div>
            <Button onClick={() => discard.mutate(dump.id, { onSuccess: () => navigate("/") })} disabled={discard.isPending}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1 className={s.title}>In your pool.</h1>
          <p className={s.lead}>
            {dump.kept > 0 ? `You kept ${words(dump.kept)} from this.` : "These words were already in your pool."} They come
            back in your sessions.
          </p>
        </>
      )}
      <Source dump={dump} />
    </div>
  );
}

function Review({ dump }: { dump: DumpDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const commit = useCommitDump(dump.id);
  const discard = useDiscardDump();
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const fresh = dump.candidates.filter((c) => !c.known);
  const known = dump.candidates.length - fresh.length;
  // Until the learner touches anything, every new word is ticked and every known one isn't.
  const selected = picked ?? new Set(fresh.map((c) => c.wordId));
  const live = dump.candidates.filter((c) => selected.has(c.wordId));

  const toggle = (wordId: string) => {
    const next = new Set(selected);
    if (!next.delete(wordId)) next.add(wordId);
    setPicked(next);
  };

  const onFixed = (oldId: string, newId: string) => {
    const next = new Set(selected);
    next.delete(oldId);
    next.add(newId);
    setPicked(next);
  };

  const keep = () =>
    commit.mutate(
      live.map((c) => c.wordId),
      {
        onSuccess: () => {
          toast(`Added ${words(live.length)} to your pool.`);
          navigate("/");
        },
      },
    );

  return (
    <>
      <div className={s.body}>
        <header className={s.header}>
          <h1 className={s.title}>
            Keep what you
            <br />
            want to learn.
          </h1>
          <p className={s.lead}>
            {spell(dump.candidates.length)} {dump.candidates.length === 1 ? "word" : "words"} came out of this.
            {known > 0 ? ` ${spell(known)} you already have.` : null}
          </p>
        </header>

        <Source dump={dump} />

        <div className={s.listHead}>
          <span className={s.label}>{fresh.length} new</span>
          <button
            type="button"
            className={s.linkButton}
            onClick={() => setPicked(selected.size > 0 ? new Set() : new Set(fresh.map((c) => c.wordId)))}
          >
            {selected.size > 0 ? "Deselect all" : "Select all"}
          </button>
        </div>

        <ul className={s.list}>
          {dump.candidates.map((c) => (
            <CandidateRow
              key={c.wordId}
              dumpId={dump.id}
              candidate={c}
              checked={selected.has(c.wordId)}
              onToggle={() => toggle(c.wordId)}
              onFixed={onFixed}
            />
          ))}
        </ul>
      </div>

      <footer className={s.footer}>
        {commit.error ? (
          <p className={s.error} role="alert">
            {commit.error.message}
          </p>
        ) : null}
        <div className={s.footerRow}>
          <span className={s.label}>{live.length} selected</span>
          <Button onClick={() => setConfirmDiscard(true)}>Discard</Button>
          <Button variant="primary" onClick={keep} disabled={live.length === 0 || commit.isPending}>
            {commit.isPending ? "Adding…" : "Add to pool"}
          </Button>
        </div>
      </footer>

      <Sheet open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard this?">
        <p className={s.lead}>None of these words go into your pool.</p>
        <div className={s.sheetActions}>
          <Button
            variant="primary"
            disabled={discard.isPending}
            onClick={() =>
              discard.mutate(dump.id, {
                onSuccess: () => {
                  toast("Discarded.");
                  navigate("/");
                },
                onError: (err) => toast(err.message),
              })
            }
          >
            Discard
          </Button>
          <Button onClick={() => setConfirmDiscard(false)}>Keep reviewing</Button>
        </div>
      </Sheet>
    </>
  );
}

/** The text the words came from, with each one highlighted where it was met. */
function Source({ dump }: { dump: DumpDetail }) {
  const [showImage, setShowImage] = useState(false);
  const time = new Date(dump.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const isImage = dump.kind === "image";
  return (
    <figure className={s.source}>
      <figcaption className={s.sourceHead}>
        <span className={s.label}>
          Source · {isImage ? "screenshot" : "text"} {time}
        </span>
        {isImage ? (
          <button type="button" className={s.linkButton} onClick={() => setShowImage((v) => !v)} aria-expanded={showImage}>
            {showImage ? "Hide screenshot" : "Show screenshot"}
          </button>
        ) : null}
      </figcaption>
      {/* Served through the API after an auth check; never a public URL. */}
      {isImage && showImage ? <img className={s.shot} src={`/api/dumps/${dump.id}/image`} alt="Your screenshot" /> : null}
      {dump.text ? (
        <blockquote className={s.sourceText} lang="fr">
          « {highlight(dump.text, dump.candidates.map((c) => c.form ?? ""))} »
        </blockquote>
      ) : null}
    </figure>
  );
}

const fold = (t: string) => stripAccents(t.toLowerCase());

/** Marks the first place each form appears. Overlaps keep the earlier mark. */
function highlight(text: string, forms: readonly string[]): ReactNode[] {
  const folded = fold(text);
  // Folding can change length for a few unusual characters; then search as typed.
  const hay = folded.length === text.length ? folded : text.toLowerCase();
  const ranges = forms
    .filter((f) => f.trim())
    .map((f) => {
      const needle = hay === folded ? fold(f.trim()) : f.trim().toLowerCase();
      const at = hay.indexOf(needle);
      return at === -1 ? null : { start: at, end: at + needle.length };
    })
    .filter((r): r is { start: number; end: number } => r !== null)
    .sort((a, b) => a.start - b.start);

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    out.push(text.slice(cursor, r.start));
    out.push(
      <mark key={r.start} className={s.mark}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  }
  out.push(text.slice(cursor));
  return out;
}

type RowProps = {
  dumpId: string;
  candidate: CandidateView;
  checked: boolean;
  onToggle: () => void;
  onFixed: (oldId: string, newId: string) => void;
};

function CandidateRow({ dumpId, candidate: c, checked, onToggle, onFixed }: RowProps) {
  const [fixing, setFixing] = useState(false);
  const [value, setValue] = useState(c.lemma);
  const correct = useCorrectCandidate(dumpId);
  const inputId = `fix-${c.wordId}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text || correct.isPending) return;
    if (text === c.lemma) return setFixing(false);
    correct.mutate(
      { wordId: c.wordId, text },
      {
        onSuccess: ({ wordId }) => {
          setFixing(false);
          onFixed(c.wordId, wordId);
        },
      },
    );
  };

  if (fixing) {
    return (
      <li className={`${s.item} ${s.itemFixing}`}>
        <form className={s.fix} onSubmit={submit}>
          <label htmlFor={inputId} className={s.label}>
            {c.form ? `Read as « ${c.form} ». The right word:` : "The right word:"}
          </label>
          <input
            id={inputId}
            className={s.fixInput}
            lang="fr"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={80}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={correct.error ? true : undefined}
            aria-describedby={correct.error ? `${inputId}-error` : undefined}
          />
          {correct.error ? (
            <p id={`${inputId}-error`} className={s.error} role="alert">
              {correct.error.message}
            </p>
          ) : null}
          <div className={s.fixActions}>
            <Button type="submit" variant="primary" disabled={!value.trim() || correct.isPending}>
              {correct.isPending ? "Looking up…" : "Look up"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setFixing(false);
                setValue(c.lemma);
                correct.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`${s.item} ${checked ? s.itemOn : ""}`}>
      <label className={s.pick}>
        <input type="checkbox" className={s.check} checked={checked} onChange={onToggle} />
        <span className={s.pickBody}>
          <span className={s.pickHead}>
            <span className={`${s.lemma} ${checked ? "" : s.dim}`} lang="fr">
              {c.lemma}
            </span>
            <span className={s.pos}>{posLabel(c.pos, c.gender)}</span>
          </span>
          <span className={s.translation}>{c.translation}</span>
          {c.known ? <span className={s.known}>Already in your pool</span> : null}
          {c.usageNote ? <span className={s.usage}>{c.usageNote}</span> : null}
        </span>
      </label>
      <button type="button" className={s.fixButton} onClick={() => setFixing(true)} aria-label={`Fix ${c.lemma}`}>
        Fix
      </button>
    </li>
  );
}
