// Cloudflare entry: builds Ctx from bindings. The only file that knows the
// platform. Static assets are served before this runs; only /api/* reaches it.
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.sqlite.ts";
import { app } from "../server/app.ts";
import type { Ctx, Kv } from "../server/ctx.ts";
import { parseCost } from "../server/lib/password.ts";

function kvFrom(ns: KVNamespace): Kv {
  return {
    get: (key) => ns.get(key),
    put: (key, value, options) =>
      ns.put(key, value, options?.ttlSeconds ? { expirationTtl: options.ttlSeconds } : undefined),
    delete: (key) => ns.delete(key),
  };
}

export function cloudflareCtx(env: Env, ec: ExecutionContext): Ctx {
  return {
    db: drizzle(env.DB, { schema }),
    kv: kvFrom(env.SESSIONS),
    defer: (task) => ec.waitUntil(task().catch((err) => console.error("deferred task failed", err))),
    clientIp: (req) => req.headers.get("cf-connecting-ip"),
    config: { passwordCost: parseCost(env.PASSWORD_HASH_COST) },
  };
}

export default {
  fetch: (req, env, ec) => app.fetch(req, { ctx: cloudflareCtx(env, ec) }, ec),
} satisfies ExportedHandler<Env>;
