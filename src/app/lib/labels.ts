/** Part-of-speech labels are shown in French; the stored enum stays English. */
const POS_FR: Record<string, string> = {
  noun: "NOM",
  verb: "VERBE",
  adj: "ADJECTIF",
  adv: "ADVERBE",
  pron: "PRONOM",
  other: "EXPRESSION",
};

export function posLabel(pos: string, gender: string | null): string {
  const base = POS_FR[pos] ?? pos.toUpperCase();
  return gender ? `${base} · ${gender.toUpperCase()}` : base;
}
