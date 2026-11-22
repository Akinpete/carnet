// scrypt via node:crypto, which Workers provide under `nodejs_compat` and
// Node provides natively, so this file is portable. The cost (N) is stored
// in the hash string, so it can be raised later: old hashes still verify,
// and `needsRehash` tells login to upgrade them.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Strong default for Node, self-hosters and paid plans (~30 ms CPU). */
export const DEFAULT_COST = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

/** Accepts powers of two from 1024 to 131072; anything else falls back to the default. */
export function parseCost(value: string | undefined): number {
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1024 && n <= 131072 && (n & (n - 1)) === 0;
  return valid ? n : DEFAULT_COST;
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Returns `scrypt$N$r$p$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string, cost: number = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost, R, P);
  return ["scrypt", cost, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when a stored hash was made with a lower cost than the current one. */
export function needsRehash(stored: string, cost: number): boolean {
  return Number(stored.split("$")[1]) < cost;
}
