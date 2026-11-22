// Opaque session tokens in KV with a 30-day sliding expiry. KV stores only a
// SHA-256 of the token, so a leaked KV dump can't be replayed as cookies.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Kv } from "../ctx.ts";

export const SESSION_COOKIE = "carnet_session";
const TTL_SECONDS = 30 * 24 * 60 * 60;
/** Re-extend the session at most once a day, to keep KV writes low. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

type SessionRecord = { userId: string; renewedAt: number };

async function keyFor(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `session:${hex}`;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function createSession(kv: Kv, userId: string): Promise<string> {
  const token = newToken();
  const record: SessionRecord = { userId, renewedAt: Date.now() };
  await kv.put(await keyFor(token), JSON.stringify(record), { ttlSeconds: TTL_SECONDS });
  return token;
}

/** Resolves a token to its user, extending the session when it's due. */
export async function readSession(
  kv: Kv,
  token: string,
): Promise<{ userId: string; renewed: boolean } | null> {
  const key = await keyFor(token);
  const raw = await kv.get(key);
  if (!raw) return null;
  const record = JSON.parse(raw) as SessionRecord;
  if (Date.now() - record.renewedAt < RENEW_AFTER_MS) return { userId: record.userId, renewed: false };
  const renewed: SessionRecord = { userId: record.userId, renewedAt: Date.now() };
  await kv.put(key, JSON.stringify(renewed), { ttlSeconds: TTL_SECONDS });
  return { userId: record.userId, renewed: true };
}

export async function destroySession(kv: Kv, token: string): Promise<void> {
  await kv.delete(await keyFor(token));
}

export function getSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}
