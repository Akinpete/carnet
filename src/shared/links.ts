// Shared by the app (what a paste holds) and the server (what a dump is).

/** A single http(s) link, nothing else. */
export function isUrl(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  try {
    const url = new URL(t);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
