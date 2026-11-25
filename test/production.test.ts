// M3: rung 4 asks for a sentence of the learner's own, spoken or typed. The
// model describes it; the verdict follows the spec's rules.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AiError } from "../src/server/ai.ts";
import type { Card } from "../src/shared/cards.ts";
import type { AnswerResult, SessionView } from "../src/shared/types.ts";
import { fakeAi, newLearner, RETROUVER, voiceNote, type Client } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const observe = (over: Record<string, unknown>) => ({
  usesWord: true,
  meaningInSentence: "to find again",
  sense: "correct",
  mixedUpWith: null,
  mistake: null,
  explanation: null,
  corrected: null,
  example: { fr: "J'ai retrouvé mes clés sous le canapé.", en: "I found my keys under the sofa." },
  ...over,
});

/** Observations by the learner's sentence; anything else fails like a stalled model. */
function grader(byAnswer: Record<string, Record<string, unknown>>) {
  return (user: string) => {
    const { answer } = JSON.parse(user) as { answer: string };
    const o = byAnswer[answer];
    if (!o) throw new AiError("stalled", true);
    return observe(o);
  };
}

async function atRungFour(byAnswer: Record<string, Record<string, unknown>> = {}, speech: Record<string, string> = {}) {
  const ai = fakeAi({ retrouver: RETROUVER }, {}, speech, { grade: grader(byAnswer) });
  const me = await newLearner(ai);
  await me.call("/dumps", { body: { text: "retrouver" } });
  await env.DB.prepare("UPDATE user_words SET rung = 4, reps = 3, interval_days = 15").run();
  const { session } = await json<{ session: SessionView }>(await me.call("/sessions/morning/start", { body: {} }));
  return { me, ai, session, card: session.cards[0] as Card };
}

const say = (me: Client, sessionId: string, body: Record<string, unknown>) =>
  me.call(`/sessions/${sessionId}/answer`, { body }).then((r) => json<AnswerResult>(r));

const review = (sessionId: string) =>
  env.DB.prepare("SELECT grade, rung, error_kind, answer_text, answer_mode, edited, contested FROM reviews WHERE session_id = ?").bind(sessionId).first();

describe("rung 4: production", () => {
  it("asks for a sentence using the word, with its meaning as the only hint", async () => {
    const { card } = await atRungFour();
    expect(card).toMatchObject({ rung: 4, type: "production", lemma: "retrouver", translation: "to find again · to meet up with" });
  });

  it("passes a right sentence and records that it was spoken, and edited", async () => {
    const { me, session, card } = await atRungFour({ "J'ai retrouvé mes clés": {} });
    const result = await say(me, session.id, { wordId: card.wordId, text: "J'ai retrouvé mes clés", mode: "spoken", edited: true });
    expect(result).toMatchObject({ correct: true, judged: { close: false, errorKind: null, corrected: null }, next: { rung: 4 } });
    expect(result.judged?.example?.fr).toContain("retrouvé");
    expect(await review(session.id)).toMatchObject({ grade: 3, rung: 4, answer_mode: "spoken", edited: 1, error_kind: null });
  });

  it("passes a gender slip with the fix, and holds a broken verb as a grammar failure", async () => {
    const { me, session, card } = await atRungFour({
      "elle a retrouvée son chat": { mistake: "agreement", explanation: "No agreement after avoir here.", corrected: "elle a retrouvé son chat" },
    });
    expect(await say(me, session.id, { wordId: card.wordId, text: "elle a retrouvée son chat", mode: "typed" })).toMatchObject({
      correct: true,
      judged: { close: true, corrected: "elle a retrouvé son chat", explanation: "No agreement after avoir here." },
      next: { rung: 4 },
    });
    expect(await review(session.id)).toMatchObject({ grade: 2, answer_mode: "typed", edited: 0 });

    const other = await atRungFour({ "je retrouvons mes clés": { mistake: "conjugation" } });
    expect(await say(other.me, other.session.id, { wordId: other.card.wordId, text: "je retrouvons mes clés", mode: "spoken" })).toMatchObject({
      correct: false,
      judged: { errorKind: "wrong_form" },
      next: { rung: 4, intervalDays: 1 },
    });
  });

  it("sends a false friend back to comprehension, and names it", async () => {
    const { me, session, card } = await atRungFour({
      "j'ai retrouvé une nouvelle amie": { sense: "similar_french_word", mixedUpWith: "rencontrer", explanation: "That's rencontrer." },
    });
    expect(await say(me, session.id, { wordId: card.wordId, text: "j'ai retrouvé une nouvelle amie", mode: "spoken" })).toMatchObject({
      correct: false,
      judged: { errorKind: "confused_pair", explanation: "That's rencontrer." },
      next: { rung: 3, intervalDays: 1 },
    });
  });

  it("treats a skip as a lapse that keeps the rung, without asking the model", async () => {
    const { me, ai, session, card } = await atRungFour();
    expect(await say(me, session.id, { wordId: card.wordId, skipped: true })).toMatchObject({ correct: false, next: { rung: 4, intervalDays: 1 } });
    expect(await review(session.id)).toMatchObject({ grade: 1, answer_mode: "skipped", answer_text: null });
    expect(ai.routes).not.toContain("grade");
  });

  it("marks a review as contested when the learner says it was unfair, without changing the grade", async () => {
    const { me, session, card } = await atRungFour({ "x x x": { sense: "nonsense" } });
    expect((await me.call(`/sessions/${session.id}/contest`, { body: { wordId: card.wordId } })).status).toBe(404);
    await say(me, session.id, { wordId: card.wordId, text: "x x x", mode: "spoken" });
    expect((await me.call(`/sessions/${session.id}/contest`, { body: { wordId: card.wordId } })).status).toBe(200);
    expect(await review(session.id)).toMatchObject({ grade: 0, error_kind: "unusable", contested: 1 });
  });
});

describe("POST /transcribe", () => {
  it("returns French text from a clip and keeps nothing", async () => {
    const me = await newLearner(fakeAi({}, {}, { "answer-1": "J'ai retrouvé mes clés. Sous-titres réalisés par la communauté d'Amara.org" }));
    const res = await me.call("/transcribe", { form: voiceNote("answer-1") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "J'ai retrouvé mes clés." });
    expect((await env.UPLOADS.list()).objects.filter((o) => o.key.includes("answer"))).toEqual([]);
  });

  it("refuses what isn't a recording", async () => {
    const me = await newLearner(fakeAi({}));
    const f = new FormData();
    f.append("audio", new File(["x"], "a.png", { type: "image/png" }));
    expect((await me.call("/transcribe", { form: f })).status).toBe(400);
  });
});
