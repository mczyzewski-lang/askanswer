/**
 * Teleprompter script following. The expert's speech (live Scribe v2 Realtime transcript) is matched
 * against the script to find how far they have read, so the prompter can scroll with them.
 *
 * Robust to what people actually do on camera:
 *  - ad-libs and fillers ("tak myślę, że…", "eee", "no więc") — unmatched spoken words are skipped;
 *  - paraphrases and recognition errors — fuzzy word matching (diacritics, inflection, typos);
 *  - skipped words or whole sentences — the search looks ahead, so the position jumps forward;
 *  - repeating a sentence — a strong match behind the position moves it back;
 *  - manual jumps (tap a word / scroll) — `jump()` sets the position directly.
 */

export interface ScriptWord {
  /** as written (with punctuation) */
  text: string;
  norm: string;
  /** 0 = hook, then one per paragraph of the script */
  para: number;
}

const FOLD: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };

export function normWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function tokenize(hook: string, script: string | null | undefined): ScriptWord[] {
  const out: ScriptWord[] = [];
  const push = (text: string, para: number) => {
    for (const t of text.split(/\s+/)) {
      const norm = normWord(t);
      if (t.trim()) out.push({ text: t, norm, para });
    }
  };
  push(hook, 0);
  (script ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((p, i) => push(p, i + 1));
  return out;
}

export function spokenWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normWord)
    .filter(Boolean);
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** 0..1 similarity of two normalised words (Polish inflection: shared stem counts). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = Math.min(a.length, b.length);
  if (short >= 4) {
    let p = 0;
    while (p < short && a[p] === b[p]) p++;
    if (p >= Math.max(4, Math.ceil(short * 0.7))) return 0.85; // umowa / umowy / umowie
  }
  if (short <= 2) return 0;
  const r = 1 - lev(a, b) / Math.max(a.length, b.length);
  return r >= 0.7 ? r : 0;
}

/** how much a matched word proves the position: short function words prove little */
function weight(w: string) {
  return w.length <= 2 ? 0.35 : w.length <= 4 ? 0.8 : 1.2;
}

export class ScriptFollower {
  pos = 0; // index of the next word to read
  constructor(
    public readonly words: ScriptWord[],
    private opts = { lookAhead: 40, lookBehind: 30, tail: 7 },
  ) {}

  jump(index: number) {
    this.pos = Math.max(0, Math.min(this.words.length, index));
  }

  /**
   * Feed the latest spoken words (committed + current partial, oldest first). Returns the new
   * position. Only the last few words matter, so callers can pass a growing list.
   */
  update(spoken: string[]): number {
    const tail = spoken.slice(-this.opts.tail).filter(Boolean);
    if (!tail.length || !this.words.length) return this.pos;
    let best: { end: number; score: number } | null = null;
    const from = Math.max(0, this.pos - this.opts.lookBehind);
    const to = Math.min(this.words.length - 1, this.pos + this.opts.lookAhead);
    for (let end = from; end <= to; end++) {
      const score = this.align(tail, end);
      if (score <= 0) continue;
      // prefer strong matches, then the one nearest to the expected position (slightly ahead)
      const dist = Math.abs(end + 1 - this.pos);
      const s = score - dist * 0.02;
      if (!best || s > best.score) best = { end, score: s };
    }
    if (!best) return this.pos;
    const target = best.end + 1;
    const raw = best.score + Math.abs(target - this.pos) * 0.02;
    if (target > this.pos) {
      // far jumps (skipped sentences) need more evidence than reading on
      const need = target - this.pos <= 4 ? 1 : target - this.pos <= 15 ? 1.9 : 2.8;
      if (raw >= need) this.pos = target;
    } else if (target < this.pos - 2 && raw >= 3) {
      this.pos = target; // re-reading a sentence
    }
    return this.pos;
  }

  /** Score how well the spoken tail ends at script word `end`, walking backwards and skipping ad-libs. */
  private align(tail: string[], end: number): number {
    // the most recent spoken word (or the one before, after a trailing filler) must match `end`
    let si = tail.length - 1;
    let matchedLast = false;
    for (let k = 0; k < 2 && si - k >= 0; k++) {
      if (similarity(tail[si - k], this.words[end].norm) > 0) {
        si -= k;
        matchedLast = true;
        break;
      }
    }
    if (!matchedLast) return 0;
    let score = 0;
    let wi = end;
    let misses = 0;
    while (si >= 0 && wi >= 0 && misses <= 3) {
      const sim = similarity(tail[si], this.words[wi].norm);
      if (sim > 0) {
        score += sim * weight(this.words[wi].norm);
        si--;
        wi--;
        misses = 0;
        continue;
      }
      // skipped script word (expert dropped it)?
      if (wi > 0 && similarity(tail[si], this.words[wi - 1].norm) > 0) {
        wi--;
        misses++;
        continue;
      }
      // ad-lib / filler in speech
      si--;
      misses++;
    }
    return score;
  }
}
