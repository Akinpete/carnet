// Calls the app directly (not through SELF) so a test can swap the model for
// a fake, while keeping the real local D1 and KV from cloudflare.config.ts.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Ai, ChatRequest } from "../src/server/ai.ts";
import { app } from "../src/server/app.ts";
import { cloudflareCtx } from "../src/worker/index.ts";

let ipCounter = 0;

export type Client = {
  cookie: string;
  call: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
};

/** Sends one request and waits for its deferred work (enrichment) to finish. */
export async function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ai: Ai | null = null,
): Promise<Response> {
  const ec = createExecutionContext();
  const ctx = { ...cloudflareCtx(env, ec), ai };
  const res = await app.fetch(
    new Request(`https://carnet.test/api${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "cf-connecting-ip": `198.51.100.${(ipCounter++ % 250) + 1}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { ctx },
    ec,
  );
  await waitOnExecutionContext(ec);
  return res;
}

/** A fresh signed-up learner whose requests carry their session cookie. */
export async function newLearner(ai: Ai | null, timezone = "UTC"): Promise<Client> {
  const email = `learner-${crypto.randomUUID()}@example.com`;
  const res = await request("/auth/signup", { body: { email, password: "un mot de passe", timezone } });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return {
    cookie,
    call: (path, init = {}) => request(path, { ...init, headers: { cookie, ...init.headers } }, ai),
  };
}

type FakeReply = Record<string, unknown>;

/** A model that answers from a fixed table and counts its calls. */
export function fakeAi(replies: Record<string, FakeReply>): Ai & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async chat<T>(req: ChatRequest<T>): Promise<T> {
      calls.push(req.user);
      const reply = replies[req.user] ?? { kind: "unclear" };
      return req.schema.parse(reply);
    },
  };
}

export const GREVE = {
  kind: "word",
  lemma: "la grève",
  pos: "noun",
  gender: "f",
  translation: "the strike",
  gloss: "rarely, a shore",
  usageNote: "It looks like grief, but it means a strike.",
  distractors: ["the grief", "the grave", "the gravel"],
};

export const RETROUVER = {
  kind: "word",
  lemma: "retrouver",
  pos: "verb",
  gender: null,
  translation: "to find again · to meet up with",
  gloss: null,
  usageNote: "Not rencontrer, which is meeting for the first time.",
  distractors: ["to look for", "to meet for the first time", "to lose"],
};
