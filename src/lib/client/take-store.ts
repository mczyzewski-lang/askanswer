/**
 * Local persistence + resumable upload of recorded takes.
 * Chunks are written to IndexedDB while recording (so a crash or closed tab does
 * not lose footage); the finished take stays in IndexedDB until the server
 * confirms it. Uploads are sliced, resumable and retried with backoff.
 */
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";

export interface PendingTake {
  clientId: string;
  token: string;
  questionId: string;
  mimeType: string;
  mode: "CONTINUOUS" | "ANSWER_ONLY";
  narrationAssetId: string | null;
  markers: { narrationStart: number | null; narrationEnd: number | null; answerStart?: number | null; mirrored?: boolean; camera?: { w: number; h: number } };
  durationSec: number;
  blob: Blob;
  createdAt: number;
}

let store: UseStore | null = null;
function db(): UseStore {
  if (!store) store = createStore("askby-recorder", "takes");
  return store;
}

export async function saveChunk(clientId: string, index: number, blob: Blob) {
  try {
    await set(`chunk:${clientId}:${String(index).padStart(6, "0")}`, blob, db());
  } catch {
    /* storage may be unavailable (private mode) — recording continues in memory */
  }
}

export async function saveTake(t: PendingTake) {
  await set(`take:${t.clientId}`, t, db());
  for (const k of await keys(db())) if (String(k).startsWith(`chunk:${t.clientId}:`)) await del(k, db());
}

export async function saveTakeMeta(clientId: string, meta: Omit<PendingTake, "blob">) {
  try {
    await set(`meta:${clientId}`, meta, db());
  } catch {
    /* ignore */
  }
}

export async function removeTake(clientId: string) {
  await del(`take:${clientId}`, db());
  await del(`meta:${clientId}`, db());
}

export async function pendingTakes(token: string): Promise<PendingTake[]> {
  const out: PendingTake[] = [];
  try {
    const all = await keys(db());
    for (const k of all) {
      if (!String(k).startsWith("take:")) continue;
      const t = await get<PendingTake>(k, db());
      if (t && t.token === token) out.push(t);
    }
    // recover takes interrupted mid-recording: chunks + meta but no finished take
    const metas = all.filter((k) => String(k).startsWith("meta:"));
    for (const mk of metas) {
      const clientId = String(mk).slice(5);
      if (all.includes(`take:${clientId}`)) continue;
      const meta = await get<Omit<PendingTake, "blob">>(mk, db());
      if (!meta || meta.token !== token) continue;
      const chunkKeys = all.filter((k) => String(k).startsWith(`chunk:${clientId}:`)).sort();
      if (!chunkKeys.length) continue;
      const blobs: Blob[] = [];
      for (const ck of chunkKeys) {
        const b = await get<Blob>(ck, db());
        if (b) blobs.push(b);
      }
      const t: PendingTake = { ...meta, blob: new Blob(blobs, { type: meta.mimeType }) };
      await saveTake(t);
      out.push(t);
    }
  } catch {
    /* IndexedDB unavailable */
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

const SLICE = 2 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url: string, init: RequestInit, onRetry?: (attempt: number) => void): Promise<Response> {
  let attempt = 0;
  for (;;) {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
      const res = await fetch(url, init);
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch {
      attempt++;
      onRetry?.(attempt);
      // wait for connectivity, then back off (max 30 s)
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await new Promise<void>((r) => window.addEventListener("online", () => r(), { once: true }));
      }
      await sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    }
  }
}

export async function uploadTake(t: PendingTake, onProgress: (p: number, note?: string) => void): Promise<{ takeId: string }> {
  const base = `/api/record/${t.token}`;
  const createRes = await fetchRetry(`${base}/takes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      questionId: t.questionId,
      clientId: t.clientId,
      mimeType: t.mimeType.split(";")[0],
      mode: t.mode,
      narrationAssetId: t.narrationAssetId,
      markers: t.markers,
      durationSec: t.durationSec,
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error(created.error ?? "Nie udało się rozpocząć wysyłania");
  if (created.status && created.status !== "UPLOADING") {
    onProgress(1);
    return { takeId: created.takeId };
  }
  const total = Math.max(1, Math.ceil(t.blob.size / SLICE));
  const have = new Set<number>(created.receivedChunks ?? []);
  let done = have.size;
  onProgress(done / (total + 1));
  for (let i = 0; i < total; i++) {
    if (have.has(i)) continue;
    const part = t.blob.slice(i * SLICE, Math.min(t.blob.size, (i + 1) * SLICE));
    const res = await fetchRetry(`${base}/takes/${created.takeId}/chunks/${i}`, { method: "PUT", body: part, headers: { "content-type": "application/octet-stream" } }, (a) =>
      onProgress(done / (total + 1), `Ponawiam wysyłanie (próba ${a + 1})…`),
    );
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Błąd wysyłania");
    done++;
    onProgress(done / (total + 1));
  }
  const fin = await fetchRetry(`${base}/takes/${created.takeId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ totalChunks: total, durationSec: t.durationSec, markers: t.markers }),
  });
  const finData = await fin.json();
  if (!fin.ok) throw new Error(finData.error ?? "Nie udało się zapisać nagrania");
  onProgress(1);
  return { takeId: created.takeId };
}

export function newClientId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
