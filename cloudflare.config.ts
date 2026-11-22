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
      // scrypt N. 4096 (~7 ms CPU) fits the Workers free plan's 10 ms limit.
      // On Workers Paid, raise it to 16384: users are re-hashed on next login.
      PASSWORD_HASH_COST: bindings.text("4096"),
    },
  },
});
