/**
 * Finding the script's texts in the transcripts of the raw footage.
 *
 * Local alignment (Smith–Waterman) of the script words against the transcript words, with fuzzy word
 * equality (inflection, transcription slips). Words the expert ADDED inside a part are alignment gaps,
 * so they stay inside the cut; at the end the cut runs on while the speech flows without a pause.
 * Retakes: the last take that is (nearly) as good as the best one wins — the expert usually repeats
 * until it is right.
 */

export interface FootageWords {
  id: string;
  words: Array<{ text: string; start: number; end: number }>;
}

export interface PartMatch {
  footageId: string;
  /** word indices in the footage transcript (inclusive) */
  i0: number;
  i1: number;
  start: number;
  end: number;
  /** 0–1: how much of the script part was found */
  score: number;
  /** words said in the cut that are not in the script (additions) */
  extra: string[];
}

export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]/g, "");
}

export function tokens(text: string): string[] {
  return text.split(/\s+/).map(normWord).filter(Boolean);
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Same word, allowing Polish inflection and small transcription differences. */
export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // numbers (also inside words) must be the same: "500" ≠ "5000"
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if ((da || db) && da !== db) return false;
  const k = Math.min(a.length, b.length);
  if (k >= 4 && a.slice(0, Math.max(4, k - 2)) === b.slice(0, Math.max(4, k - 2))) return true;
  return lev(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1);
}

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

/** A transcript as ids into its own vocabulary — word similarity is then computed once per distinct word. */
interface Prepared {
  ids: Int32Array;
  vocab: string[];
  /** script token → for each vocabulary word: similar? */
  sim: Map<string, Uint8Array>;
}
const prepared = new WeakMap<object, Prepared>();
function prepare(words: FootageWords["words"]): Prepared {
  let p = prepared.get(words);
  if (p) return p;
  const index = new Map<string, number>();
  const vocab: string[] = [];
  const ids = new Int32Array(words.length);
  words.forEach((w, j) => {
    const t = normWord(w.text);
    let id = index.get(t);
    if (id === undefined) {
      id = vocab.length;
      index.set(t, id);
      vocab.push(t);
    }
    ids[j] = id;
  });
  p = { ids, vocab, sim: new Map() };
  prepared.set(words, p);
  return p;
}
function simRow(p: Prepared, token: string): Uint8Array {
  let row = p.sim.get(token);
  if (!row) {
    row = new Uint8Array(p.vocab.length);
    for (let v = 0; v < p.vocab.length; v++) row[v] = similar(token, p.vocab[v]) ? 1 : 0;
    p.sim.set(token, row);
  }
  return row;
}

/** Best (latest good) local alignment of `script` in one transcript. */
function alignIn(script: string[], words: FootageWords["words"]): { score: number; i0: number; i1: number; matched: Set<number> } | null {
  const n = script.length;
  const prep = prepare(words);
  const T = prep.ids;
  const m = T.length;
  if (!n || !m) return null;
  const rows = script.map((tk) => simRow(prep, tk));
  const same = (i: number, j: number) => rows[i][T[j]] === 1;
  const H = new Float32Array((n + 1) * (m + 1));
  const P = new Uint8Array((n + 1) * (m + 1)); // 0 stop, 1 diag, 2 up (script gap), 3 left (transcript word extra)
  const at = (i: number, j: number) => i * (m + 1) + j;
  let best = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = H[at(i - 1, j - 1)] + (same(i - 1, j - 1) ? MATCH : MISMATCH);
      const u = H[at(i - 1, j)] + GAP;
      const l = H[at(i, j - 1)] + GAP;
      let v = 0;
      let p = 0;
      if (d > v) (v = d), (p = 1);
      if (u > v) (v = u), (p = 2);
      if (l > v) (v = l), (p = 3);
      H[at(i, j)] = v;
      P[at(i, j)] = p;
      if (v > best) best = v;
    }
  }
  if (best <= 0) return null;
  // the latest end cell that is nearly as good as the best (retakes: the last good one)
  let ei = 0;
  let ej = 0;
  for (let j = m; j >= 1 && !ej; j--)
    for (let i = n; i >= 1; i--)
      if (H[at(i, j)] >= best * 0.92) {
        ei = i;
        ej = j;
        break;
      }
  let i = ei;
  let j = ej;
  const matched = new Set<number>();
  let j0 = ej;
  while (i > 0 && j > 0 && H[at(i, j)] > 0) {
    const p = P[at(i, j)];
    if (p === 1) {
      if (same(i - 1, j - 1)) matched.add(j - 1);
      j0 = j;
      i--;
      j--;
    } else if (p === 2) i--;
    else if (p === 3) {
      j0 = j;
      j--;
    } else break;
  }
  // the cut starts and ends on words of the script (not on a mismatched neighbour)
  let i0 = j0 - 1;
  let i1 = ej - 1;
  while (i1 > i0 && !matched.has(i1)) i1--;
  while (i0 < i1 && !matched.has(i0)) i0++;
  return { score: H[at(ei, ej)], i0, i1, matched };
}

/** Where a script part was said, across all footage files. */
export function matchPart(
  text: string,
  footage: FootageWords[],
  /** stops: word indices (per footage) where another script part begins — a tail never runs into it */
  opts: { flowGap?: number; maxTail?: number; stops?: Map<string, Set<number>> } = {},
): PartMatch | null {
  const script = tokens(text);
  if (!script.length) return null;
  let best: (PartMatch & { raw: number }) | null = null;
  for (const f of footage) {
    const r = alignIn(script, f.words);
    if (!r || r.i0 < 0) continue;
    const score = Math.max(0, Math.min(1, r.score / (MATCH * script.length)));
    // an equally good take in a later file wins too (files are in upload order)
    if (best && score < best.score - 0.05) continue;
    let i0 = r.i0;
    let i1 = r.i1;
    // the expert carried on without a pause: keep the extra words (a sentence added at the end)
    const gap = opts.flowGap ?? 0.45;
    const maxTail = opts.maxTail ?? 12;
    let tail = 0;
    const stop = opts.stops?.get(f.id);
    while (i1 + 1 < f.words.length && tail < maxTail && f.words[i1 + 1].start - f.words[i1].end < gap && !stop?.has(i1 + 1)) {
      i1++;
      tail++;
    }
    while (i0 > 0 && f.words[i0].start - f.words[i0 - 1].end < 0.12 && r.i0 - i0 < 2) i0--;
    const extra: string[] = [];
    for (let k = i0; k <= i1; k++) if (!r.matched.has(k)) extra.push(f.words[k].text);
    best = { footageId: f.id, i0, i1, start: f.words[i0].start, end: f.words[i1].end, score, extra, raw: r.score };
  }
  if (!best) return null;
  const { raw: _raw, ...out } = best;
  void _raw;
  return out;
}
