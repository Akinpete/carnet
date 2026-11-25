// Platform-agnostic. Routes are chained so `hc<Api>` infers the client types.
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env.ts";
import { notFound, onError } from "./middleware/onError.ts";
import { auth } from "./routes/auth.ts";
import { dumpRoutes } from "./routes/dumps.ts";
import { me } from "./routes/me.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { transcribeRoutes } from "./routes/transcribe.ts";

const api = new Hono<AppEnv>()
  .route("/auth", auth)
  .route("/me", me)
  .route("/dumps", dumpRoutes)
  .route("/sessions", sessionRoutes)
  .route("/transcribe", transcribeRoutes);

export const app = new Hono<AppEnv>()
  .use(requestId())
  .use(secureHeaders())
  .use(async (c, next) => {
    c.set("ctx", c.env.ctx);
    await next();
  })
  .route("/api", api);

app.onError(onError);
app.notFound(notFound);

export type Api = typeof api;
