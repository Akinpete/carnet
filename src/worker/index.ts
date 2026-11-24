// Cloudflare entry: builds Ctx from bindings. The only file that knows the
// platform. Static assets are served before this runs; only /api/* reaches it.
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.sqlite.ts";
import { createGatewayAi, type Ai } from "../server/ai.ts";
import { app } from "../server/app.ts";
import type { Ctx, Kv, Storage, Tx } from "../server/ctx.ts";
import { parseCost } from "../server/lib/password.ts";
import { readArticle } from "./article.ts";

function kvFrom(ns: KVNamespace): Kv {
  return {
    get: (key) => ns.get(key),
    put: (key, value, options) =>
      ns.put(key, value, options?.ttlSeconds ? { expirationTtl: options.ttlSeconds } : undefined),
    delete: (key) => ns.delete(key),
  };
}

function storageFrom(bucket: R2Bucket): Storage {
  return {
    put: async (key, body, { contentType }) => {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    get: async (key) => {
      const object = await bucket.get(key);
      return object ? { body: object.body, contentType: object.httpMetadata?.contentType ?? null } : null;
    },
    delete: (key) => bucket.delete(key),
  };
}

/** Model calls degrade instead of crashing when the gateway isn't configured. */
function aiFrom(env: Env): Ai | null {
  if (!env.AI_GATEWAY_URL || !env.AI_API_KEY) return null;
  return createGatewayAi({
    baseUrl: env.AI_GATEWAY_URL,
    apiKey: env.AI_API_KEY,
    model: env.MODEL_CHAT,
    headers: env.AI_GATEWAY_ID ? { "cf-aig-gateway-id": env.AI_GATEWAY_ID } : {},
    // Workers AI has no OpenAI-style transcription route: its own `/run/<model>` sits beside `/v1`.
    transcribe: env.MODEL_TRANSCRIBE
      ? { style: "workers-ai", url: `${env.AI_GATEWAY_URL.replace(/\/v1\/?$/, "")}/run/${env.MODEL_TRANSCRIBE}` }
      : undefined,
  });
}

export function cloudflareCtx(env: Env, ec: ExecutionContext): Ctx {
  const db = drizzle(env.DB, { schema });
  // D1 has no interactive transactions; a batch is atomic.
  const tx = ((queries) => db.batch(queries as never)) as Tx;
  return {
    db,
    tx,
    kv: kvFrom(env.SESSIONS),
    storage: storageFrom(env.UPLOADS),
    web: { readArticle: (url) => readArticle(url) },
    ai: aiFrom(env),
    defer: (task) => ec.waitUntil(task().catch((err) => console.error("deferred task failed", err))),
    clientIp: (req) => req.headers.get("cf-connecting-ip"),
    config: { passwordCost: parseCost(env.PASSWORD_HASH_COST) },
  };
}

export default {
  fetch: (req, env, ec) => app.fetch(req, { ctx: cloudflareCtx(env, ec) }, ec),
} satisfies ExportedHandler<Env>;
