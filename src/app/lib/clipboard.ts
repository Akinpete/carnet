// What a paste holds. Pure, so it's testable without a browser.

/** A single link, nothing else. */
export function isUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type Pasted = { kind: "image"; file: File } | { kind: "url"; url: string } | { kind: "text"; text: string } | null;

/** What a paste holds, in the order it's handled: an image wins over text. */
export function readPaste(data: Pick<DataTransfer, "items" | "getData">): Pasted {
  const item = [...data.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (file) return { kind: "image", file };
  const text = data.getData("text/plain").trim();
  if (!text) return null;
  return isUrl(text) ? { kind: "url", url: text } : { kind: "text", text };
}
