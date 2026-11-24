import { describe, expect, it } from "vitest";
import { isUrl, readPaste } from "./clipboard.ts";

const clip = (text: string, files: string[] = []) => ({
  items: files.map((type) => ({ kind: "file", type, getAsFile: () => new File(["x"], "f", { type }) })) as unknown as DataTransferItemList,
  getData: (format: string) => (format === "text/plain" ? text : ""),
});

describe("readPaste", () => {
  it("prefers an image over the text that comes with it", () => {
    expect(readPaste(clip("capture.png", ["image/png"]))).toMatchObject({ kind: "image", file: { type: "image/png" } });
  });

  it("tells a lone link from text", () => {
    expect(readPaste(clip("  https://www.lemonde.fr/article  "))).toEqual({ kind: "url", url: "https://www.lemonde.fr/article" });
    expect(readPaste(clip("Lisez https://lemonde.fr ce matin."))).toEqual({ kind: "text", text: "Lisez https://lemonde.fr ce matin." });
    expect(readPaste(clip("la grève"))).toEqual({ kind: "text", text: "la grève" });
  });

  it("ignores empty pastes and non-image files", () => {
    expect(readPaste(clip("   "))).toBeNull();
    expect(readPaste(clip("", ["application/pdf"]))).toBeNull();
  });
});

describe("isUrl", () => {
  it("accepts only http and https links", () => {
    expect(isUrl("https://example.com")).toBe(true);
    expect(isUrl("javascript:alert(1)")).toBe(false);
    expect(isUrl("lemonde.fr")).toBe(false);
  });
});
