// Up to three sessions a day, each only with words that are really due, and
// practice, which grades like a session but never moves the schedule.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/shared/cards.ts";
import type { AnswerResult, SessionView, TodayView } from "../src/shared/types.ts";
import { fakeAi, FENETRE, GREVE, newLearner, OCCUPE, RETROUVER, type Client } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const ai = () => fakeAi({ grève: GREVE, retrouver: RETROUVER, fenêtre: FENETRE, occupé: OCCUPE });
const today = async (me: Client) => json<TodayView>(await me.call("/sessions/today"));
const start = (me: Client, slot: string) => me.call(`/sessions/${slot}/start`, { body: {} });

/** Answers every card in a session correctly (as the device would). */
async function finish(me: Client, session: SessionView) {
  for (const card of session.cards as Card[]) {
    const body =
      card.type === "recognition" ? { wordId: card.wordId, choice: card.answerIndex } : { wordId: card.wordId, text: card.type === "recall" ? card.answer : "x" };
    await me.call(`/sessions/${session.id}/answer`, { body });
  }
  await me.call(`/sessions/${session.id}/complete`, { body: {} });
}

describe("another session", () => {
  it("opens the next slot only once new words are due, and only with those", async () => {
    const me = await newLearner(ai());
    await me.call("/dumps", { body: { text: "grève" } });
    const { session: morning } = await json<{ session: SessionView }>(await start(me, "morning"));
    expect(morning).toMatchObject({ slot: "morning" });
    await finish(me, morning);
    expect(await today(me)).toMatchObject({ state: "completed", slot: "midday", done: 1, reviewedToday: 1, total: 0 });
    expect((await start(me, "midday")).status).toBe(409); // nothing due: no empty session

    await me.call("/dumps", { body: { text: "retrouver" } });
    expect(await today(me)).toMatchObject({ state: "ready", slot: "midday", total: 1, done: 1 });
    const { session: midday } = await json<{ session: SessionView }>(await start(me, "midday"));
    expect(midday.cards.map((c) => c.type === "recognition" && c.prompt)).toEqual(["retrouver"]);
    expect(await today(me)).toMatchObject({ state: "in_progress", slot: "midday", total: 1, answered: 0 });
  });

  it("keeps sessions in order: no skipping a slot, no second one while one is open", async () => {
    const me = await newLearner(ai());
    await me.call("/dumps", { body: { text: "grève" } });
    expect((await start(me, "midday")).status).toBe(409);
    await start(me, "morning");
    await me.call("/dumps", { body: { text: "retrouver" } });
    expect(await json(await start(me, "midday"))).toMatchObject({ error: { code: "session_out_of_order" } });
    expect((await start(me, "lunch")).status).toBe(400);
  });

  it("stops after three", async () => {
    const me = await newLearner(ai());
    for (const [slot, word] of [["morning", "grève"], ["midday", "retrouver"], ["evening", "fenêtre"]] as const) {
      await me.call("/dumps", { body: { text: word } });
      await finish(me, (await json<{ session: SessionView }>(await start(me, slot))).session);
    }
    await me.call("/dumps", { body: { text: "occupé" } });
    expect(await today(me)).toMatchObject({ state: "completed", slot: null, done: 3, reviewedToday: 3 });
  });
});

describe("practice", () => {
  it("uses words that aren't due, grades them, and leaves their schedule alone", async () => {
    const me = await newLearner(ai());
    await me.call("/dumps", { body: { text: "grève" } });
    await me.call("/dumps", { body: { text: "retrouver" } });
    await finish(me, (await json<{ session: SessionView }>(await start(me, "morning"))).session);
    const before = await env.DB.prepare("SELECT word_id, rung, interval_days, due_on, reps FROM user_words ORDER BY word_id").all();
    expect(await today(me)).toMatchObject({ practice: 2 });

    const { session } = await json<{ session: SessionView }>(await start(me, "practice"));
    expect(session).toMatchObject({ slot: "practice" });
    expect(session.cards).toHaveLength(2);
    const card = session.cards[0] as Card;
    const body = card.type === "recall" ? { wordId: card.wordId, text: "wrong on purpose" } : { wordId: card.wordId, dontKnow: true };
    const result = await json<AnswerResult>(await me.call(`/sessions/${session.id}/answer`, { body }));
    expect(result).toMatchObject({ correct: false, practice: true });

    const after = await env.DB.prepare("SELECT word_id, rung, interval_days, due_on, reps FROM user_words ORDER BY word_id").all();
    expect(after.results).toEqual(before.results);
    const logged = await env.DB.prepare("SELECT grade FROM reviews WHERE session_id = ?").bind(session.id).all();
    expect(logged.results).toEqual([{ grade: 0 }]);
    // Practice doesn't count as a session.
    expect(await today(me)).toMatchObject({ done: 1, reviewedToday: 2 });
  });

  it("starts a fresh round each time, and never takes a word that's due", async () => {
    const me = await newLearner(ai());
    await me.call("/dumps", { body: { text: "grève" } });
    expect(await json(await start(me, "practice"))).toMatchObject({ error: { code: "nothing_to_practise" } });

    await finish(me, (await json<{ session: SessionView }>(await start(me, "morning"))).session);
    await me.call("/dumps", { body: { text: "retrouver" } }); // due today: belongs to a real session
    const a = await json<{ session: SessionView }>(await start(me, "practice"));
    const b = await json<{ session: SessionView }>(await start(me, "practice"));
    expect(b.session.id).not.toBe(a.session.id);
    expect(b.session.cards.map((c) => c.type === "recognition" ? c.prompt : c.type === "recall" ? c.answer : c.lemma)).toEqual(["la grève"]);
  });
});
