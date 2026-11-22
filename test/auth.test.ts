// End to end through the real Worker, with a local D1 and KV.
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/server/lib/password.ts";

let ipCounter = 0;
/** Each test gets its own IP, so the per-IP auth limit doesn't leak between tests. */
const freshIp = () => `203.0.113.${++ipCounter}`;

function post(path: string, body: unknown, init: { ip: string; cookie?: string }) {
  return SELF.fetch(`https://carnet.test/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": init.ip,
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function me(cookie?: string) {
  return SELF.fetch("https://carnet.test/api/me", { headers: cookie ? { cookie } : {} });
}

/** `carnet_session=…` from a Set-Cookie header. */
function sessionCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const pair = header.split(";")[0] ?? "";
  expect(pair).toMatch(/^carnet_session=.+/);
  return pair;
}

describe("auth", () => {
  it("signs up, reads /me, logs out, and is then rejected", async () => {
    const ip = freshIp();
    const signup = await post(
      "/auth/signup",
      { email: "  Learner@Example.com ", password: "un mot de passe", timezone: "Europe/Paris" },
      { ip },
    );
    expect(signup.status).toBe(201);
    const setCookie = signup.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = sessionCookie(signup);

    const meRes = await me(cookie);
    expect(meRes.status).toBe(200);
    const { user } = (await meRes.json()) as { user: { email: string; timezone: string; id: string } };
    expect(user.email).toBe("learner@example.com");
    expect(user.timezone).toBe("Europe/Paris");
    expect(user.id).toMatch(/^usr_[0-9a-f]{32}$/);

    const logout = await post("/auth/logout", {}, { ip, cookie });
    expect(logout.status).toBe(204);
    expect((await me(cookie)).status).toBe(401);
  });

  it("logs in with the right password and not the wrong one", async () => {
    const ip = freshIp();
    await post("/auth/signup", { email: "login@example.com", password: "bonjour tout le monde" }, { ip });

    const wrong = await post("/auth/login", { email: "login@example.com", password: "au revoir" }, { ip });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      error: { code: "invalid_credentials", message: "That email and password don't match." },
    });

    const unknown = await post("/auth/login", { email: "nobody@example.com", password: "x" }, { ip });
    expect(unknown.status).toBe(401);

    const right = await post("/auth/login", { email: "LOGIN@example.com", password: "bonjour tout le monde" }, { ip });
    expect(right.status).toBe(200);
    expect((await me(sessionCookie(right))).status).toBe(200);
  });

  it("hashes at the configured cost, and upgrades weaker hashes on login", async () => {
    const ip = freshIp();
    await post("/auth/signup", { email: "cost@example.com", password: "le coût du hachage" }, { ip });
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email = ?")
      .bind("cost@example.com")
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^scrypt\$4096\$/); // PASSWORD_HASH_COST in cloudflare.config.ts

    // Simulate an account made before the cost was raised: store a weaker hash.
    const weak = await hashPassword("le coût du hachage", 1024);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?").bind(weak, "cost@example.com").run();

    const login = await post("/auth/login", { email: "cost@example.com", password: "le coût du hachage" }, { ip });
    expect(login.status).toBe(200);
    const after = await env.DB.prepare("SELECT password_hash FROM users WHERE email = ?")
      .bind("cost@example.com")
      .first<{ password_hash: string }>();
    expect(after?.password_hash).toMatch(/^scrypt\$4096\$/);
  });

  it("refuses a second account with the same email", async () => {
    const ip = freshIp();
    await post("/auth/signup", { email: "twice@example.com", password: "premier essai" }, { ip });
    const again = await post("/auth/signup", { email: "twice@example.com", password: "deuxième essai" }, { ip });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "email_taken", field: "email" } });
  });

  it("returns invalid_input with the field for bad bodies", async () => {
    const ip = freshIp();
    const short = await post("/auth/signup", { email: "short@example.com", password: "court" }, { ip });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: { code: "invalid_input", field: "password" } });

    const badEmail = await post("/auth/signup", { email: "pas-un-email", password: "assez long" }, { ip });
    expect(await badEmail.json()).toMatchObject({ error: { code: "invalid_input", field: "email" } });

    const badZone = await post(
      "/auth/signup",
      { email: "zone@example.com", password: "assez long", timezone: "Mars/Olympus" },
      { ip },
    );
    expect(await badZone.json()).toMatchObject({ error: { code: "invalid_input", field: "timezone" } });
  });

  it("rate-limits auth to 10 attempts an hour per IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await post("/auth/login", { email: "limit@example.com", password: "x" }, { ip });
      expect(res.status).toBe(401);
    }
    const blocked = await post("/auth/login", { email: "limit@example.com", password: "x" }, { ip });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: { code: "rate_limited" } });

    const otherIp = await post("/auth/login", { email: "limit@example.com", password: "x" }, { ip: freshIp() });
    expect(otherIp.status).toBe(401);
  });

  it("rejects /me without a session, and unknown endpoints with not_found", async () => {
    const res = await me();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });

    const missing = await SELF.fetch("https://carnet.test/api/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
