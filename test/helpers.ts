// Calls the app directly (not through SELF) so a test can swap the model for
// a fake, while keeping the real local D1 and KV from cloudflare.config.ts.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Ai, ChatRequest } from "../src/server/ai.ts";
import { app } from "../src/server/app.ts";
import { cloudflareCtx } from "../src/worker/index.ts";

let ipCounter = 0;

type Init = { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string> };

export type Client = {
  cookie: string;
  call: (path: string, init?: Init) => Promise<Response>;
};

/** Sends one request and waits for its deferred work (enrichment) to finish. */
export async function request(path: string, init: Init = {}, ai: Ai | null = null): Promise<Response> {
  const ec = createExecutionContext();
  const ctx = { ...cloudflareCtx(env, ec), ai };
  const res = await app.fetch(
    new Request(`https://carnet.test/api${path}`, {
      method: init.method ?? (init.body === undefined && !init.form ? "GET" : "POST"),
      headers: {
        "cf-connecting-ip": `198.51.100.${(ipCounter++ % 250) + 1}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
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

const BATCH_LINE = /^(.+) \((noun|verb|adj|adv|pron|other)\)$/;

/**
 * A model that answers from fixed tables and records its calls. `words` is
 * keyed by what the learner typed (single lookups); batched lookups are
 * answered from the same entries, matched on lemma. `texts` holds extraction
 * replies, keyed by the dump's text, or by `image:<the image's bytes as text>`
 * for a screenshot.
 */
export function fakeAi(
  words: Record<string, FakeReply>,
  texts: Record<string, FakeReply> = {},
): Ai & { calls: string[]; routes: string[] } {
  const calls: string[] = [];
  const routes: string[] = [];
  const entries = Object.values(words).filter((w) => w.kind === "word");
  return {
    calls,
    routes,
    async chat<T>(req: ChatRequest<T>): Promise<T> {
      calls.push(req.user);
      routes.push(req.route);
      if (req.route === "extract") {
        const key = req.image ? `image:${atob(req.image.base64)}` : req.user;
        if (req.image) calls[calls.length - 1] = key;
        return req.schema.parse(texts[key] ?? { kind: "unclear", items: [] });
      }
      const lines = req.user.split("\n").map((l) => l.match(BATCH_LINE));
      if (lines.every((m) => m !== null) && lines.length > 0 && !(req.user in words)) {
        const found = lines.flatMap((m) => entries.filter((e) => e.lemma === m?.[1] && e.pos === m?.[2]));
        return req.schema.parse({ entries: found.map(({ kind: _, ...e }) => e) });
      }
      return req.schema.parse(words[req.user] ?? { kind: "unclear" });
    },
  };
}

/** A fake screenshot whose bytes are this text, for `fakeAi`'s `image:` keys. */
export const screenshot = (content: string, type = "image/png") => {
  const form = new FormData();
  form.append("image", new File([content], "capture.png", { type }));
  return form;
};

/** An extraction reply listing these entries (each `{ form, lemma, pos }`). */
export const extracted = (...items: { form: string; lemma: string; pos: string }[]) => ({ kind: "items", items });

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

export const FENETRE = {
  kind: "word",
  lemma: "la fenêtre",
  pos: "noun",
  gender: "f",
  translation: "the window",
  gloss: null,
  usageNote: null,
  distractors: ["the fence", "the feather", "the fan"],
};

export const OCCUPE = {
  kind: "word",
  lemma: "occupé",
  pos: "adj",
  gender: null,
  translation: "taken · busy",
  gloss: null,
  usageNote: null,
  distractors: ["empty", "free", "closed"],
};

export const PATRON = {
  kind: "word",
  lemma: "le patron",
  pos: "noun",
  gender: "m",
  translation: "the boss · the owner",
  gloss: null,
  usageNote: "Not a customer, as an English patron is.",
  distractors: ["the customer", "the pattern", "the guest"],
};
