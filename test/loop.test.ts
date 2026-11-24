// M1's loop end to end: type a word → looked up → in today's session → answer → rescheduled.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/shared/cards.ts";
import type { AnswerResult, DumpView, SessionView, TodayView } from "../src/shared/types.ts";
import { addDays, todayIn } from "../src/server/lib/dates.ts";
import { fakeAi, GREVE, newLearner, RETROUVER } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

describe("capture", () => {
  it("looks a typed word up and puts it in the pool", async () => {
    const ai = fakeAi({ grève: GREVE });
    const me = await newLearner(ai);

    const created = await me.call("/dumps", { body: { text: "grève" } });
    expect(created.status).toBe(202);
    const { dump } = await json<{ dump: DumpView }>(created);
    expect(dump.status).toBe("extracting");

    const { dump: done } = await json<{ dump: DumpView }>(await me.call(`/dumps/${dump.id}`));
    expect(done.status).toBe("committed");
    expect(done.word).toEqual({
      lemma: "la grève",
      pos: "noun",
      translation: "the strike",
      rung: 1,
      usageNote: "It looks like grief, but it means a strike.",
    });
    expect(ai.calls).toEqual(["grève"]);
  });

  it("serves a word another learner already looked up from the shared cache", async () => {
    const ai = fakeAi({ retrouver: RETROUVER });
    const first = await newLearner(ai);
    await first.call("/dumps", { body: { text: "retrouver" } });
    const second = await newLearner(ai);
    const { dump } = await json<{ dump: DumpView }>(await second.call("/dumps", { body: { text: "retrouver" } }));
    const { dump: done } = await json<{ dump: DumpView }>(await second.call(`/dumps/${dump.id}`));
    expect(done.word?.lemma).toBe("retrouver");
    expect(ai.calls).toEqual(["retrouver"]); // one model call for two learners
  });

  it("says when a word is already in the pool", async () => {
    const ai = fakeAi({ grève: GREVE });
    const me = await newLearner(ai);
    await me.call("/dumps", { body: { text: "grève" } });
    const { dump } = await json<{ dump: DumpView }>(await me.call("/dumps", { body: { text: "la grève" } }));
    const { dump: again } = await json<{ dump: DumpView }>(await me.call(`/dumps/${dump.id}`));
    expect(again.status).toBe("committed");
    expect(again.alreadyInPool).toBe(true);
  });

  it("fails non-French, unclear and unconfigured lookups with a message the learner can act on", async () => {
    const ai = fakeAi({ hello: { kind: "not_french" } });
    const me = await newLearner(ai);
    const outcome = async (text: string, client = me) => {
      const { dump } = await json<{ dump: DumpView }>(await client.call("/dumps", { body: { text } }));
      return json<{ dump: DumpView }>(await client.call(`/dumps/${dump.id}`)).then((r) => r.dump);
    };
    expect(await outcome("xqzt")).toMatchObject({ status: "failed", error: "Couldn't make sense of that. Check the spelling?" });
    expect(await outcome("hello")).toMatchObject({ status: "failed", error: "That doesn't look like French." });

    const offline = await newLearner(null);
    expect(await outcome("chuchoter", offline)).toMatchObject({
      status: "failed",
      error: "Word lookup isn't set up on this server yet.",
    });
  });

  it("lists the inbox newest first", async () => {
    const me = await newLearner(fakeAi({ grève: GREVE, retrouver: RETROUVER }));
    await me.call("/dumps", { body: { text: "grève" } });
    await me.call("/dumps", { body: { text: "retrouver" } });
    const { dumps } = await json<{ dumps: DumpView[] }>(await me.call("/dumps"));
    expect(dumps.map((d) => d.word?.lemma).sort()).toEqual(["la grève", "retrouver"]);
    // Newest first. The runtime's clock only moves on I/O, so two quick dumps can tie.
    expect(dumps[0]?.createdAt).toBeGreaterThanOrEqual(dumps[1]?.createdAt ?? Infinity);
  });
});

describe("one session a day", () => {
  async function learnerWith(...words: { text: string; reply: Record<string, unknown> }[]) {
    const ai = fakeAi(Object.fromEntries(words.map((w) => [w.text, w.reply])));
    const me = await newLearner(ai);
    for (const w of words) await me.call("/dumps", { body: { text: w.text } });
    return me;
  }

  it("offers nothing when the pool is empty", async () => {
    const me = await newLearner(null);
    expect(await json<TodayView>(await me.call("/sessions/today"))).toMatchObject({ state: "nothing_due", total: 0 });
    const start = await me.call("/sessions/morning/start", { body: {} });
    expect(start.status).toBe(409);
  });

  it("runs a recognition card through to a new schedule", async () => {
    const me = await learnerWith({ text: "grève", reply: GREVE });
    expect(await json<TodayView>(await me.call("/sessions/today"))).toMatchObject({ state: "ready", total: 1 });

    const { session } = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
    expect(session.cards).toHaveLength(1);
    const card = session.cards[0] as Card;
    expect(card.type).toBe("recognition");
    if (card.type !== "recognition") return;
    expect(card.prompt).toBe("la grève");
    expect(card.usageNote).toBe("It looks like grief, but it means a strike.");
    expect([...card.choices].sort()).toEqual(["the grave", "the gravel", "the grief", "the strike"]);

    const answer = await me.call(`/sessions/${session.id}/answer`, {
      body: { wordId: card.wordId, choice: card.answerIndex, latencyMs: 2100 },
    });
    expect(answer.status).toBe(200);
    const today = todayIn("UTC");
    expect(await json<AnswerResult>(answer)).toEqual({
      correct: true,
      expected: "the strike",
      accentSlip: false,
      next: { rung: 2, intervalDays: 1, dueOn: addDays(today, 1) },
    });

    // The same card can't be answered twice, and the review was written once.
    const again = await me.call(`/sessions/${session.id}/answer`, { body: { wordId: card.wordId, choice: 0 } });
    expect(again.status).toBe(409);
    const rows = await env.DB.prepare("SELECT grade, rung, answer_text, latency_ms FROM reviews WHERE session_id = ?")
      .bind(session.id)
      .all();
    expect(rows.results).toEqual([{ grade: 3, rung: 1, answer_text: "the strike", latency_ms: 2100 }]);

    expect(await json<TodayView>(await me.call("/sessions/today"))).toMatchObject({ state: "completed", reviewedToday: 1 });
    const done = await me.call(`/sessions/${session.id}/complete`, { body: {} });
    expect(await done.json()).toEqual({ total: 1, answered: 1, correct: 1 });
  });

  it("reopens the same session instead of generating a second one", async () => {
    const me = await learnerWith({ text: "grève", reply: GREVE });
    const a = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
    const b = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
    expect(b.session.id).toBe(a.session.id);
    // Later slots open in order, once this one is done (test/sessions.test.ts).
    expect((await me.call("/sessions/evening/start", { body: {} })).status).toBe(409);
  });

  it("grades recall by text: articles and case don't matter, a missing accent passes with a note", async () => {
    const me = await learnerWith({ text: "grève", reply: GREVE }, { text: "retrouver", reply: RETROUVER });
    // Both words have passed recognition before, so today they come up as recall cards.
    await env.DB.prepare("UPDATE user_words SET rung = 2, reps = 1, interval_days = 1").run();

    const { session } = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
    const byPrompt = Object.fromEntries(session.cards.map((k) => [k.prompt, k]));
    const strike = byPrompt["the strike"] as Card;
    const findAgain = byPrompt["to find again · to meet up with"] as Card;
    expect(strike.type).toBe("recall");

    const slip = await json<AnswerResult>(
      await me.call(`/sessions/${session.id}/answer`, { body: { wordId: strike.wordId, text: "  Greve " } }),
    );
    // A pass climbs to rung 3, comprehension, which exists since M2.
    expect(slip).toMatchObject({ correct: true, accentSlip: true, expected: "la grève", next: { rung: 3, intervalDays: 6 } });

    const wrong = await json<AnswerResult>(
      await me.call(`/sessions/${session.id}/answer`, { body: { wordId: findAgain.wordId, text: "rencontrer" } }),
    );
    expect(wrong).toMatchObject({ correct: false, expected: "retrouver", next: { rung: 1, intervalDays: 1 } });
  });

  it("replays a retried answer instead of rejecting it", async () => {
    const me = await learnerWith({ text: "grève", reply: GREVE });
    const { session } = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
    const card = session.cards[0] as Card;
    const send = () =>
      me.call(`/sessions/${session.id}/answer`, {
        body: { wordId: card.wordId, dontKnow: true },
        headers: { "idempotency-key": "answer-1" },
      });
    const first = await send();
    const retry = await send();
    expect(retry.status).toBe(200);
    expect(retry.headers.get("idempotent-replay")).toBe("true");
    const replayed = await json<AnswerResult>(retry);
    expect(replayed).toEqual(await first.json());
    expect(replayed).toMatchObject({ correct: false });
  });
});
