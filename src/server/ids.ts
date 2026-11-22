/** Prefixed random IDs, e.g. `usr_3f9c…`. The prefix makes logs readable. */
export function newId(prefix: "usr"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
