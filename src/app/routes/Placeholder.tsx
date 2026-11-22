import s from "./screens.module.css";

/** Tabs whose screens later milestones build. Says so plainly. */
export function Placeholder({ title, line }: { title: string; line: string }) {
  return (
    <div className={s.screen}>
      <header className={s.header}>
        <h1 className={s.wordmark}>{title}</h1>
      </header>
      <div className={s.empty}>
        <p className={s.emptyTitle}>Not here yet.</p>
        <p>{line}</p>
      </div>
    </div>
  );
}

export const Review = () => (
  <Placeholder title="Review" line="Once you've collected some words, your sessions will appear here." />
);
export const Journal = () => <Placeholder title="Journal" line="The ruled journal is still being built." />;
export const Grammar = () => <Placeholder title="Grammar" line="The grammar stages are still being built." />;
