import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { DumpView } from "../../shared/types.ts";
import { Button } from "../components/Button.tsx";
import { CaptureIcon, SettingsIcon } from "../components/icons.tsx";
import { ApiError } from "../lib/api.ts";
import { frenchDayLabel } from "../lib/dates.ts";
import { useAddDump, useAddImage, useDiscardDump, useDumps } from "../lib/pool.ts";
import { useMe } from "../lib/session.ts";
import s from "./screens.module.css";

/** The default tab: one always-visible field for a word, a phrase or pasted French. */
export default function Capture() {
  const { data: me } = useMe();
  const dumps = useDumps();
  const add = useAddDump();
  const addImage = useAddImage();
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Grow with what's pasted, up to the CSS max-height.
  const fit = () => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || add.isPending) return;
    add.mutate(value, {
      onSuccess: () => {
        setText("");
        requestAnimationFrame(fit);
      },
    });
  };

  // Enter sends, as on a one-line field; Shift+Enter starts a new line.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const waiting = dumps.data?.filter((d) => d.status === "awaiting_review").length ?? 0;
  const failure = add.error ?? addImage.error;
  const error = failure instanceof ApiError ? failure.message : failure ? "Couldn't add that. Try again." : null;

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

      <form className={s.section} onSubmit={submit}>
        <label htmlFor="dump" className={s.label}>
          Add to the pool
        </label>
        <div className={s.captureBox}>
          <textarea
            id="dump"
            ref={field}
            rows={1}
            lang="fr"
            placeholder="A word, a phrase, or paste some French"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={2000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              fit();
            }}
            onKeyDown={onKeyDown}
            aria-describedby="dump-note"
            aria-invalid={error ? true : undefined}
          />
          <div className={s.captureActions}>
            {/* On a phone this opens the photo library, where screenshots are. */}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) addImage.mutate(file);
              }}
            />
            <Button onClick={() => picker.current?.click()} disabled={addImage.isPending}>
              <CaptureIcon />
              {addImage.isPending ? "Uploading…" : "Screenshot"}
            </Button>
            <Button type="submit" variant="primary" disabled={!text.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
        <p id="dump-note" className={error ? s.noteError : s.note} role={error ? "alert" : undefined}>
          {error ?? "Type a word the way you met it, paste a sentence, or add a screenshot. Carnet picks out the words worth learning."}
        </p>
      </form>

      <section className={s.section} aria-labelledby="inbox-label">
        <div className={s.inboxHead}>
          <h2 id="inbox-label" className={s.label}>
            Inbox
          </h2>
          {waiting > 0 ? <span className={s.labelAmber}>{waiting} to review</span> : null}
        </div>
        {dumps.data && dumps.data.length > 0 ? (
          <ul className={s.inbox}>
            {dumps.data.map((d) => (
              <InboxRow key={d.id} dump={d} />
            ))}
          </ul>
        ) : dumps.isPending ? null : (
          <div className={s.empty}>
            <p className={s.emptyTitle}>Nothing collected yet.</p>
            <p>Add a word you met today, or paste a sentence. It comes back in your next session.</p>
          </div>
        )}
      </section>
    </div>
  );
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const words = (n: number) => `${n} ${n === 1 ? "word" : "words"}`;

const KIND: Record<DumpView["kind"], string> = { text: "Text", image: "Screenshot", url: "Link", audio: "Voice note" };

function InboxRow({ dump }: { dump: DumpView }) {
  const discard = useDiscardDump();

  if (dump.status === "awaiting_review") {
    return (
      <li>
        <Link to={`/inbox/${dump.id}`} className={s.inboxCard}>
          <span className={s.inboxCardHead}>
            <span className={s.labelAmber}>
              {KIND[dump.kind]} · {time(dump.createdAt)}
            </span>
            <span className={s.labelAmber}>{dump.found ? `${words(dump.found.fresh)} new` : null}</span>
          </span>
          <span className={s.inboxQuote} lang="fr">
            « {dump.text} »
          </span>
          <span className={s.inboxAction}>Review and keep →</span>
        </Link>
      </li>
    );
  }

  if (dump.word) {
    return (
      <li className={s.inboxRow}>
        <div>
          <p className={s.inboxWord} lang="fr">
            {dump.word.lemma}
          </p>
          <p className={s.inboxMeta}>{dump.word.translation} · in the pool</p>
          {dump.word.usageNote ? <p className={s.inboxNote}>{dump.word.usageNote}</p> : null}
        </div>
        <span className={s.label}>Rung {dump.word.rung}</span>
      </li>
    );
  }

  if (dump.status === "committed" && dump.kept > 1) {
    return (
      <li className={s.inboxRow}>
        <div>
          <p className={`${s.inboxWord} ${s.inboxClamp}`} lang="fr">
            {dump.text ? `« ${dump.text} »` : KIND[dump.kind]}
          </p>
          <p className={s.inboxMeta}>{words(dump.kept)} kept · in the pool</p>
        </div>
      </li>
    );
  }

  const failed = dump.status === "failed";
  const status =
    dump.status === "extracting"
      ? { text: "Looking it up…", tone: s.inboxMeta }
      : failed
        ? { text: dump.error ?? "Something went wrong.", tone: s.inboxError }
        : dump.alreadyInPool
          ? { text: "Already in your pool", tone: s.inboxMeta }
          : { text: "Waiting", tone: s.inboxMeta };
  return (
    <li className={s.inboxRow} aria-busy={dump.status === "extracting" || undefined}>
      <div>
        <p className={`${s.inboxWord} ${s.inboxPending} ${s.inboxClamp}`} lang="fr">
          {dump.text || KIND[dump.kind]}
        </p>
        <p className={status.tone}>{status.text}</p>
      </div>
      {failed ? (
        <Button variant="quiet" onClick={() => discard.mutate(dump.id)} disabled={discard.isPending}>
          Dismiss
        </Button>
      ) : null}
    </li>
  );
}
