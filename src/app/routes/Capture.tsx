import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { DumpView } from "../../shared/types.ts";
import { Button } from "../components/Button.tsx";
import { SettingsIcon } from "../components/icons.tsx";
import { ApiError } from "../lib/api.ts";
import { frenchDayLabel } from "../lib/dates.ts";
import { useAddDump, useDumps } from "../lib/pool.ts";
import { useMe } from "../lib/session.ts";
import s from "./screens.module.css";

/** The default tab. In M1: one always-visible field for a word or phrase. */
export default function Capture() {
  const { data: me } = useMe();
  const dumps = useDumps();
  const add = useAddDump();
  const [text, setText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || add.isPending) return;
    add.mutate(value, { onSuccess: () => setText("") });
  };

  const error = add.error instanceof ApiError ? add.error.message : add.error ? "Couldn't add that. Try again." : null;

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
          <input
            id="dump"
            type="text"
            lang="fr"
            placeholder="A word or phrase you met"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={120}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="dump-note"
            aria-invalid={error ? true : undefined}
          />
          <div className={s.captureActions}>
            <Button type="submit" variant="primary" disabled={!text.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
        <p id="dump-note" className={error ? s.noteError : s.note} role={error ? "alert" : undefined}>
          {error ?? "Type it the way you met it. Carnet finds the dictionary form."}
        </p>
      </form>

      <section className={s.section} aria-labelledby="inbox-label">
        <h2 id="inbox-label" className={s.label}>
          Inbox
        </h2>
        {dumps.data && dumps.data.length > 0 ? (
          <ul className={s.inbox}>
            {dumps.data.map((d) => (
              <InboxRow key={d.id} dump={d} />
            ))}
          </ul>
        ) : dumps.isPending ? null : (
          <div className={s.empty}>
            <p className={s.emptyTitle}>Nothing collected yet.</p>
            <p>Add a word you met today. It comes back in your next session.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function InboxRow({ dump }: { dump: DumpView }) {
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
  const status =
    dump.status === "extracting"
      ? { text: "Looking it up…", tone: s.inboxMeta }
      : dump.status === "failed"
        ? { text: dump.error ?? "Something went wrong.", tone: s.inboxError }
        : dump.alreadyInPool
          ? { text: "Already in your pool", tone: s.inboxMeta }
          : { text: "Waiting", tone: s.inboxMeta };
  return (
    <li className={s.inboxRow} aria-busy={dump.status === "extracting" || undefined}>
      <div>
        <p className={`${s.inboxWord} ${s.inboxPending}`} lang="fr">
          {dump.text}
        </p>
        <p className={status.tone}>{status.text}</p>
      </div>
    </li>
  );
}
