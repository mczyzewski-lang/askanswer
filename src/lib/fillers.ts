/**
 * Subtle hesitations for the narrator ("Yyy…", "Mm…", "Ech…") so a question sounds spoken, not read.
 * Applied only to the text sent to ElevenLabs — the question on screen stays clean.
 *
 * Deterministic per seed (the question id): the same question always gets the same version, so
 * the TTS cache keeps working and re-recordings sound identical. Most questions get at most one
 * filler, many get none:
 *   ~30%  a filler before the question      "Yyy… Ile trwa sprawa rozwodowa?"
 *   ~20%  one in the middle, at a clause     "Czy mogę, mm… zmienić nazwisko po rozwodzie?"
 *   ~50%  unchanged
 */
const LEADING = ["Yyy… ", "Mm… ", "Ech… ", "Eee… ", "Hmm… "];
const MIDDLE = ["yy…", "mm…", "eee…"];
const CLAUSE = /^(czy|jak|kiedy|który|która|które|co|ile|gdzie|dlaczego|żeby|aby|jeśli|jeżeli|gdy|że)$/i;

/** small seeded PRNG (mulberry32) over a string hash */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withFillers(text: string, seed: string): string {
  const clean = text.trim();
  const words = clean.split(/\s+/);
  if (words.length < 3) return clean;
  const rnd = seeded(`fillers:${seed}`);
  const roll = rnd();
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
  if (roll < 0.3) {
    // keep the question's own capital letter after the filler
    return pick(LEADING) + clean;
  }
  if (roll < 0.5 && words.length >= 5) {
    // in the middle third: after a comma, or before a clause word; never next to the ends
    const lo = Math.max(2, Math.floor(words.length * 0.3));
    const hi = Math.min(words.length - 2, Math.ceil(words.length * 0.7));
    let at = -1;
    for (let i = lo; i <= hi; i++) {
      if (words[i - 1].endsWith(",") || CLAUSE.test(words[i].replace(/[^\p{L}]/gu, ""))) {
        at = i;
        break;
      }
    }
    if (at < 0) at = Math.round((lo + hi) / 2);
    const prev = words[at - 1];
    const filler = pick(MIDDLE);
    // "mogę, mm… zmienić" / "mogę… mm… zmienić" reads more naturally than a bare insertion
    words[at - 1] = prev.endsWith(",") ? `${prev} ${filler}` : `${prev}, ${filler}`;
    return words.join(" ");
  }
  return clean;
}

/** Stable "random" choice for a key (e.g. one narrator voice per question). */
export function stablePick<T>(list: T[], key: string): T | undefined {
  if (!list.length) return undefined;
  return list[Math.floor(seeded(`pick:${key}`)() * list.length)];
}
