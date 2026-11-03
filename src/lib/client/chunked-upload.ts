/**
 * Large files from the browser: slices of 8 MB, three at a time, each retried with back-off (a dropped
 * connection costs one slice, not the whole file). A refusal the server means (disk full, too big, not
 * a video) stops at once with its message.
 */
export const CHUNK = 8 * 1024 * 1024;

export class UploadError extends Error {}

async function errorOf(res: Response): Promise<string> {
  const d = await res.json().catch(() => ({}) as { error?: string });
  return (d as { error?: string }).error ?? `Błąd HTTP ${res.status}`;
}

export async function sendChunks(file: File, chunkUrl: (i: number) => string, onProgress: (fraction: number) => void, opts: { parallel?: number; retries?: number } = {}): Promise<number> {
  const total = Math.max(1, Math.ceil(file.size / CHUNK));
  const retries = opts.retries ?? 6;
  let done = 0;
  let next = 0;
  let stop: Error | null = null;
  const send = async (i: number) => {
    for (let attempt = 0; ; attempt++) {
      if (stop) throw stop;
      const res = await fetch(chunkUrl(i), { method: "PUT", body: file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)) }).catch(() => null);
      if (res?.ok) break;
      // the server refused for a reason (not a hiccup): no point retrying
      if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw (stop = new UploadError(await errorOf(res)));
      if (res?.status === 507) throw (stop = new UploadError(await errorOf(res)));
      if (attempt >= retries) throw (stop = new UploadError("Nie udało się wysłać części pliku — sprawdź połączenie i spróbuj ponownie."));
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    }
    done++;
    onProgress(done / total);
  };
  await Promise.all(
    Array.from({ length: Math.min(opts.parallel ?? 3, total) }, async () => {
      while (next < total && !stop) await send(next++);
    }),
  );
  return total;
}

/** At most `limit` files at a time — 30 files at once would starve each other's slices. */
export function uploadQueue(limit = 2) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= limit) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
