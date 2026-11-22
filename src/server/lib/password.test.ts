import { describe, expect, it } from "vitest";
import { DEFAULT_COST, hashPassword, needsRehash, parseCost, verifyPassword } from "./password.ts";

describe("password hashing (scrypt, in the Workers runtime)", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterie", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });

  it("records the cost it used, and still verifies after the cost changes", async () => {
    const light = await hashPassword("pareil", 4096);
    expect(light).toMatch(/^scrypt\$4096\$/);
    expect(await verifyPassword("pareil", light)).toBe(true);
    expect(needsRehash(light, 16384)).toBe(true);
    expect(needsRehash(light, 4096)).toBe(false);
    expect(needsRehash(await hashPassword("pareil", 16384), 4096)).toBe(false);
  });
});

describe("parseCost", () => {
  it("accepts powers of two in range and falls back otherwise", () => {
    expect(parseCost("4096")).toBe(4096);
    expect(parseCost("131072")).toBe(131072);
    for (const bad of [undefined, "", "abc", "5000", "512", "262144", "-4096"]) {
      expect(parseCost(bad)).toBe(DEFAULT_COST);
    }
  });
});
