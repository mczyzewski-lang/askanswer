"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Video, X } from "lucide-react";

interface Upload {
  takeId: string;
  projectId: string;
  projectName: string;
  questionText: string;
  expertName: string;
  takeNumber: number;
}

let audioCtx: AudioContext | null = null;
function ctx() {
  if (typeof window === "undefined") return null;
  audioCtx ??= new AudioContext();
  return audioCtx;
}

/** Short two-note chime generated with Web Audio (no sound file needed). */
function chime() {
  const ac = ctx();
  if (!ac) return;
  void ac.resume().catch(() => {});
  const t0 = ac.currentTime + 0.02;
  [
    [880, 0],
    [1318.5, 0.14],
  ].forEach(([freq, at]) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(0.18, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.55);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.6);
  });
}

/**
 * Polls the admin change feed: refreshes the current page when recordings or questions change
 * (no manual reload needed) and shows a mini-notification with a sound when an expert uploads a recording.
 */
export function ActivityNotifier() {
  const router = useRouter();
  const [items, setItems] = useState<Upload[]>([]);
  const seen = useRef(new Set<string>());

  // browsers only allow sound after a user interaction — unlock audio on the first click/key
  useEffect(() => {
    const unlock = () => void ctx()?.resume().catch(() => {});
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    let since: string | null = null;
    let version: string | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await fetch(`/api/admin/activity${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        if (r.ok) {
          const data = (await r.json()) as { now: string; version: string; uploads: Upload[] };
          const fresh = data.uploads.filter((u) => !seen.current.has(u.takeId));
          fresh.forEach((u) => seen.current.add(u.takeId));
          if (since && fresh.length) {
            chime();
            setItems((prev) => [...fresh, ...prev].slice(0, 4));
          }
          if (version !== null && data.version !== version) router.refresh();
          version = data.version;
          since = data.now;
        }
      } catch {
        // offline or redeploying — try again on the next tick
      }
      if (!stopped) timer = setTimeout(tick, document.visibilityState === "visible" ? 4000 : 15000);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  // each notification disappears on its own after a while
  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setItems((prev) => prev.slice(0, -1)), 9000);
    return () => clearTimeout(t);
  }, [items]);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((u) => (
        <div key={u.takeId} role="status" data-testid="upload-notification" className="pointer-events-auto flex notify-in items-start gap-3 rounded-xl border border-emerald-200 bg-white px-3.5 py-3 shadow-lg">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Video className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-ink">Nowe nagranie{u.takeNumber > 1 ? ` (podejście ${u.takeNumber})` : ""}</p>
            <p className="truncate text-muted">
              {u.expertName} · {u.questionText}
            </p>
            <Link href={`/admin/projects/${u.projectId}`} className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline" onClick={() => setItems((prev) => prev.filter((x) => x.takeId !== u.takeId))}>
              {u.projectName} → zobacz
            </Link>
          </div>
          <button type="button" aria-label="Zamknij" className="rounded p-0.5 text-muted hover:bg-black/5 hover:text-ink" onClick={() => setItems((prev) => prev.filter((x) => x.takeId !== u.takeId))}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
