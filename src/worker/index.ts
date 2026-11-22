// Cloudflare entry: builds Ctx from bindings. The only file that knows the
// platform. Static assets are served before this runs; only /api/* reaches it.
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.sqlite.ts";
import { createGatewayAi, type Ai } from "../server/ai.ts";
import { app } from "../server/app.ts";
import type { Ctx, Kv, Tx } from "../server/ctx.ts";
import { parseCost } from "../server/lib/password.ts";

function kvFrom(ns: KVNamespace): Kv {
  return {
    get: (key) => ns.get(key),
    put: (key, value, options) =>
      ns.put(key, value, options?.ttlSeconds ? { expirationTtl: options.ttlSeconds } : undefined),
    delete: (key) => ns.delete(key),
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
    ai: aiFrom(env),
    defer: (task) => ec.waitUntil(task().catch((err) => console.error("deferred task failed", err))),
    clientIp: (req) => req.headers.get("cf-connecting-ip"),
    config: { passwordCost: parseCost(env.PASSWORD_HASH_COST) },
  };
}

export default {
  fetch: (req, env, ec) => app.fetch(req, { ctx: cloudflareCtx(env, ec) }, ec),
} satisfies ExportedHandler<Env>;
