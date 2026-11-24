import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "carnet",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    env: {
      DB: bindings.d1({ name: "carnet", id: "71d31d68-1292-43cd-9cf4-2452e44be56f" }),
      SESSIONS: bindings.kv(),
      // Private uploads (screenshots). Served only through the Worker, after an auth check.
      UPLOADS: bindings.r2({ name: "carnet-uploads" }),
      // scrypt N. 4096 (~7 ms CPU) fits the Workers free plan's 10 ms limit.
      // On Workers Paid, raise it to 16384: users are re-hashed on next login.
      PASSWORD_HASH_COST: bindings.text("4096"),

      // Models, through an OpenAI-compatible gateway. Secrets are set with
      // `cf secret put` (production) or .dev.vars (local); when they're
      // missing, lookups degrade with a clear message instead of crashing.
      AI_GATEWAY_URL: bindings.secret(),
      AI_API_KEY: bindings.secret(),
      AI_GATEWAY_ID: bindings.text("carnet"),
      MODEL_CHAT: bindings.text("@cf/mistralai/mistral-small-3.1-24b-instruct"),
    },
  },
});
