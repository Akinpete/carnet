// M2 part 8: rung 3 shows the word in the sentence the learner met it in and
// asks what it means there. The model judges the meaning; failures name why.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AiError } from "../src/server/ai.ts";
import type { Card } from "../src/shared/cards.ts";
import type { AnswerResult, DumpDetail, DumpView, SessionView } from "../src/shared/types.ts";
import { extracted, fakeAi, GREVE, newLearner, PATRON, RETROUVER, type Client } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const TEXT = "Le patron m'a retrouvé une table près de la fenêtre, ce soir.";
const FOUND = extracted({ form: "patron", lemma: "le patron", pos: "noun" }, { form: "retrouvé", lemma: "retrouver", pos: "verb" });

type Verdict = { verdict: "right" | "close" | "wrong"; errorKind?: string | null; meaning?: string; explanation?: string | null };

/** Grades by the learner's answer; anything not listed fails like a stalled model. */
function grader(byAnswer: Record<string, Verdict>) {
  return (user: string) => {
    const { answer } = JSON.parse(user) as { answer: string };
    const verdict = byAnswer[answer];
    if (!verdict) throw new AiError("The model didn't answer in time.", true);
    return { errorKind: null, meaning: null, explanation: null, ...verdict };
  };
}

/** A learner whose dumped words have reached rung 3. */
async function atRungThree(grades: Record<string, Verdict>, extra: Parameters<typeof fakeAi>[3] = {}) {
  const ai = fakeAi({ patron: PATRON, retrouver: RETROUVER, grève: GREVE }, { [TEXT]: FOUND }, {}, { grade: grader(grades), ...extra });
  const me = await newLearner(ai);
  const { dump } = await json<{ dump: DumpView }>(await me.call("/dumps", { body: { text: TEXT } }));
  const { dump: found } = await json<{ dump: DumpDetail }>(await me.call(`/dumps/${dump.id}`));
  await me.call(`/dumps/${dump.id}/commit`, { body: { wordIds: found.candidates.map((c) => c.wordId) } });
  await env.DB.prepare("UPDATE user_words SET rung = 3, reps = 2, interval_days = 6").run();
  const { session } = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
  const card = (lemma: string) => session.cards.find((c) => c.type === "comprehension" && c.lemma === lemma) as Card & { type: "comprehension" };
  return { me, ai, session, card };
}

const answer = (me: Client, sessionId: string, body: Record<string, unknown>) => me.call(`/sessions/${sessionId}/answer`, { body });

describe("rung 3: comprehension", () => {
  it("shows the sentence the word was met in, with the word to highlight, and no answer in the card", async () => {
    const { card } = await atRungThree({});
    expect(card("retrouver")).toMatchObject({ rung: 3, type: "comprehension", prompt: TEXT, form: "retrouvé", lemma: "retrouver", source: "dump" });
    expect(JSON.stringify(card("retrouver"))).not.toContain("find again");
  });

  it("passes a right answer, records it, and says what the word means there", async () => {
    const { me, ai, session, card } = await atRungThree({ found: { verdict: "right", meaning: "found (for me)" } });
    const res = await answer(me, session.id, { wordId: card("retrouver").wordId, text: "found" });
    expect(res.status).toBe(200);
    expect(await json<AnswerResult>(res)).toMatchObject({
      correct: true,
      expected: "found (for me)",
      judged: { close: false, errorKind: null, explanation: null },
      next: { rung: 4, intervalDays: 15 }, // climbs to production
    });
    expect(ai.routes).toContain("grade");
    const row = await env.DB.prepare("SELECT grade, rung, error_kind, answer_text FROM reviews WHERE session_id = ? AND word_id = ?")
      .bind(session.id, card("retrouver").wordId)
      .first();
    expect(row).toEqual({ grade: 3, rung: 3, error_kind: null, answer_text: "found" });
  });

  it("drops a wrong answer back to recall and names the trap", async () => {
    const explanation = "Patron looks like the English patron, a customer, but here it's the boss.";
    const { me, session, card } = await atRungThree({
      "the customer": { verdict: "wrong", errorKind: "false_cognate", meaning: "the owner", explanation },
    });
    const result = await json<AnswerResult>(await answer(me, session.id, { wordId: card("le patron").wordId, text: "the customer" }));
    expect(result).toMatchObject({ correct: false, expected: "the owner", judged: { errorKind: "false_cognate", explanation }, next: { rung: 2, intervalDays: 1 } });
    const row = await env.DB.prepare("SELECT grade, error_kind FROM reviews WHERE session_id = ?").bind(session.id).first();
    expect(row).toEqual({ grade: 0, error_kind: "false_cognate" });
  });

  it("passes a close answer without climbing", async () => {
    const { me, session, card } = await atRungThree({ met: { verdict: "close", meaning: "found", explanation: "Retrouver can mean to meet up, but here a table is found." } });
    const result = await json<AnswerResult>(await answer(me, session.id, { wordId: card("retrouver").wordId, text: "met" }));
    expect(result).toMatchObject({ correct: true, judged: { close: true }, next: { rung: 3 } });
  });

  it("records nothing when grading fails, so the card can be tried again", async () => {
    const { me, session, card } = await atRungThree({ found: { verdict: "right" } });
    const failed = await answer(me, session.id, { wordId: card("retrouver").wordId, text: "something the model chokes on" });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "grading_failed" } });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM reviews WHERE session_id = ?").bind(session.id).first()).toEqual({ n: 0 });
    expect((await answer(me, session.id, { wordId: card("retrouver").wordId, text: "found" })).status).toBe(200);
  });

  it("counts 'I don't know' as forgotten without asking the model", async () => {
    const { me, ai, session, card } = await atRungThree({});
    const result = await json<AnswerResult>(await answer(me, session.id, { wordId: card("le patron").wordId, dontKnow: true }));
    expect(result).toMatchObject({ correct: false, expected: "the boss · the owner", judged: { errorKind: "forgot" } });
    expect(ai.routes).not.toContain("grade");
  });
});

describe("rung 3 without a sentence of your own", () => {
  const example = (user: string) => ({
    examples: user.split("\n").map((line) => ({ lemma: line.split(" (")[0], fr: "Il y a une grève des trains ce matin.", form: "grève" })),
  });

  it("generates an example once, keeps it on the shared word, and uses it for the next learner", async () => {
    const ai = fakeAi({ grève: GREVE }, {}, {}, { generate: example });
    const first = await newLearner(ai);
    await first.call("/dumps", { body: { text: "grève" } }); // typed: no sentence
    await env.DB.prepare("UPDATE user_words SET rung = 3, reps = 2, interval_days = 6").run();
    const { session } = await json<{ session: SessionView }>(await first.call("/sessions/morning/start", { body: {} }));
    expect(session.cards[0]).toMatchObject({ type: "comprehension", prompt: "Il y a une grève des trains ce matin.", form: "grève", source: "example" });
    expect(ai.routes.filter((r) => r === "generate")).toHaveLength(1);

    const second = await newLearner(ai);
    await second.call("/dumps", { body: { text: "grève" } });
    await env.DB.prepare("UPDATE user_words SET rung = 3, reps = 2, interval_days = 6").run();
    const { session: theirs } = await json<{ session: SessionView }>(await second.call("/sessions/morning/start", { body: {} }));
    expect(theirs.cards[0]).toMatchObject({ type: "comprehension", source: "example" });
    expect(ai.routes.filter((r) => r === "generate")).toHaveLength(1);
  });

  it("falls back to a recall card when no example can be made", async () => {
    const me = await newLearner(
      fakeAi({ retrouver: RETROUVER }, {}, {}, {
        generate: () => {
          throw new AiError("down", true);
        },
      }),
    );
    await me.call("/dumps", { body: { text: "retrouver" } });
    await env.DB.prepare("UPDATE user_words SET rung = 3, reps = 2, interval_days = 6").run();
    const { session } = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
    expect(session.cards[0]).toMatchObject({ type: "recall", rung: 2 });
  });
});
