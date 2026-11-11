"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { REELS, REEL_FPS, REEL_H, REEL_STYLES, REEL_W, type Reel, type StyleKey } from "@/lib/explainers";
import { ensureFontsLoaded } from "@/lib/client/fonts";
import { useImage } from "./canvas";
import type { AwData, Toast } from "./types";

interface Renders {
  renders: Record<string, { url: string; createdAt: string; voiced: boolean; duration: number | null; overruns: Array<{ beat: string; voice: number; beat_s: number }> }>;
  jobs: Array<{ id: string; status: string; error: string | null; reelId: string | null; style?: string }>;
  voiceAvailable: boolean;
}
const tc = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/**
 * AI Video → Nowy Etap — Explainery: short motion explainers drawn entirely in code. The review
 * page of a reel: the preview (the same code as the export), a timeline to scrub, the beat table
 * (click = jump there and pause), the narration text per beat (editable) and the MP4 render.
 */
export function ExplainersTab({ data, toast }: { data: AwData; toast: Toast }) {
  const base = `/api/admin/adwords/${data.project.id}/explainers`;
  const [id, setId] = useState(REELS[0].id);
  const reel = REELS.find((r) => r.id === id) as Reel;
  const [style, setStyle] = useState<StyleKey>("editorial");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [state, setState] = useState<Renders | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const logo = useImage(data.logoDarkUrl ?? "/presets/nowy-etap-white.png");
  const [fonts, setFonts] = useState(false);
  // the narration text per beat, as edited here (kept in this browser; sent with the render)
  const [vo, setVo] = useState<Record<string, string>>({});
  const voKey = `explainer-vo:${data.project.id}:${id}`;
  useEffect(() => {
    try {
      setVo(JSON.parse(localStorage.getItem(voKey) ?? "{}"));
    } catch {
      setVo({});
    }
  }, [voKey]);
  const editVo = (beat: string, text: string) =>
    setVo((p) => {
      const n = { ...p, [beat]: text };
      try {
        localStorage.setItem(voKey, JSON.stringify(n));
      } catch {
        /* private mode: the edit lives until the page is closed */
      }
      return n;
    });
  useEffect(() => {
    void ensureFontsLoaded().then(() => setFonts(true));
  }, []);
  const load = useCallback(async () => setState(await api<Renders>(base)), [base]);
  useEffect(() => {
    void load().catch(() => null);
  }, [load]);
  const running = state?.jobs.some((j) => j.reelId === id && (j.style ?? "editorial") === style && (j.status === "QUEUED" || j.status === "RUNNING")) ?? false;
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => void load().catch(() => null), 4000);
    return () => clearInterval(h);
  }, [running, load]);

  // draw the current frame
  useEffect(() => {
    const c = ref.current;
    if (!c || !fonts || !reel.draw) return;
    if (c.width !== REEL_W) {
      c.width = REEL_W;
      c.height = REEL_H;
    }
    try {
      reel.draw(c.getContext("2d")!, t, { logo, style });
    } catch (e) {
      console.error("Explainer", e);
    }
  }, [t, reel, fonts, logo, style]);
  // play: real time, snapped to frames
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now() - t * 1000;
    const tick = (now: number) => {
      const nt = Math.round(((now - t0) / 1000) * REEL_FPS) / REEL_FPS;
      if (nt >= reel.duration) {
        setT(reel.duration - 1 / REEL_FPS);
        setPlaying(false);
        return;
      }
      setT(nt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reel]);
  const beat = useMemo(() => reel.beats.find((b) => t >= b.start && t < b.end) ?? reel.beats[reel.beats.length - 1], [reel, t]);
  const pick = (rid: string) => {
    setPlaying(false);
    setT(0);
    setId(rid);
  };
  const render = async (voice: boolean) => {
    setBusy(true);
    try {
      await api(base, { method: "POST", json: { reelId: id, voice, style, vo: Object.fromEntries(Object.entries(vo).filter(([, v]) => v.trim())) } });
      toast(voice ? "Renderuję MP4 z lektorem - zajmie to 1–2 minuty" : "Renderuję MP4 - zajmie to około minuty");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const done = state?.renders[`${id}:${style}`];
  const failed = state?.jobs.find((j) => j.reelId === id && (j.style ?? "editorial") === style && j.status === "FAILED");
  const fullVo = reel.beats.map((b) => vo[b.id]?.trim() || b.vo).join("\n\n");

  return (
    <div className="space-y-4" data-testid="explainers">
      <div>
        <h2 className="font-display text-xl font-semibold">Nowy Etap - Explainery</h2>
        <p className="text-sm text-muted">Krótkie Reelsy tłumaczące mechanizm („Rozwód zaczyna się od planu, nie od pozwu”), w całości narysowane kodem: bez wideo z AI i bez stocków. Podgląd poniżej to te same klatki, które trafią do MP4 (1080 × 1920, 30 kl./s).</p>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="explainer-list">
        {REELS.map((r) => (
          <button key={r.id} type="button" onClick={() => pick(r.id)} className={cn("rounded-xl border px-3 py-2 text-left text-sm transition", r.id === id ? "border-ink bg-white shadow-sm" : "border-line hover:border-black/20")} data-testid={`explainer-${r.n}`}>
            <span className="block font-medium">
              {String(r.n).padStart(2, "0")} · {r.title}
            </span>
            <span className="block text-xs text-muted">{r.status === "ready" ? `${r.duration.toFixed(0)} s · gotowy` : "scenariusz gotowy, scena w przygotowaniu"}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="explainer-styles">
        <span className="text-sm text-muted">Styl:</span>
        {REEL_STYLES.map((s) => (
          <button key={s.key} type="button" title={s.hint} onClick={() => setStyle(s.key)} className={cn("rounded-full border px-3 py-1 text-sm transition", s.key === style ? "border-ink bg-ink text-white" : "border-line hover:border-black/20")} data-testid={`explainer-style-${s.key}`}>
            {s.label}
          </button>
        ))}
        <span className="text-xs text-muted">{REEL_STYLES.find((s) => s.key === style)?.hint} · ta sama choreografia i lektor w każdym stylu</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-line bg-[#F6F1E8]" style={{ aspectRatio: "9 / 16" }}>
            {reel.draw ? <canvas ref={ref} className="h-full w-full" data-testid="explainer-canvas" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">Ten reels ma gotową tabelę beatów i tekst lektora. Scena zostanie narysowana z tych samych komponentów co reelsy 1–3.</div>}
          </div>
          {reel.draw ? (
            <>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => (t >= reel.duration - 0.1 ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? "Pauza" : "Odtwórz"} data-testid="explainer-play">
                  {playing ? <Pause /> : <Play />}
                </Button>
                <Button variant="ghost" onClick={() => (setPlaying(false), setT(0))} aria-label="Od początku">
                  <RotateCcw />
                </Button>
                <span className="ml-auto text-sm tabular-nums text-muted" data-testid="explainer-time">
                  {tc(t)} / {tc(reel.duration)}
                </span>
              </div>
              <input type="range" min={0} max={reel.duration - 1 / REEL_FPS} step={1 / REEL_FPS} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} className="w-full" aria-label="Oś czasu reelsa" data-testid="explainer-scrub" />
              {/* the beats on the timeline */}
              <div className="flex h-2 overflow-hidden rounded-full bg-black/5">
                {reel.beats.map((b, i) => (
                  <button key={b.id} type="button" title={b.screen} onClick={() => (setPlaying(false), setT(b.start))} className={cn("h-full border-r border-white/70", b.id === beat.id ? "bg-ink" : i % 2 ? "bg-black/25" : "bg-black/15")} style={{ width: `${((b.end - b.start) / reel.duration) * 100}%` }} aria-label={`Beat ${i + 1}`} />
                ))}
              </div>
              <p className="rounded-lg bg-black/[.04] px-3 py-2 text-sm" data-testid="explainer-vo-now">
                <span className="text-xs uppercase tracking-wide text-muted">Lektor teraz</span>
                <br />
                {vo[beat.id]?.trim() || beat.vo}
              </p>
            </>
          ) : null}

          <Card className="space-y-2 p-3">
            <p className="text-sm font-medium">Eksport</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!reel.draw || busy || running || !data.canEdit} onClick={() => void render(false)} data-testid="explainer-render">
                {running ? <Loader2 className="animate-spin" /> : <Film />} {running ? "Renderuję…" : "Renderuj MP4"}
              </Button>
              <Button variant="outline" disabled={!reel.draw || busy || running || !data.canEdit || !state?.voiceAvailable} title={state?.voiceAvailable ? "Lektor projektu (ElevenLabs): każdy beat zaczyna się dokładnie ze swoim zdaniem" : "Lektor wymaga klucza ElevenLabs w ustawieniach serwera"} onClick={() => void render(true)} data-testid="explainer-render-voice">
                MP4 z lektorem
              </Button>
              {reel.draw ? (
                <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-black/[.03]" href={`${base}/${id}?t=${t.toFixed(2)}&style=${style}&download=1`} data-testid="explainer-frame">
                  <Download className="h-4 w-4" /> Kadr PNG
                </a>
              ) : null}
            </div>
            {done ? (
              <p className="text-sm" data-testid="explainer-done">
                <a className="font-medium underline" href={done.url}>
                  Pobierz MP4
                </a>{" "}
                <span className="text-muted">
                  · {done.duration?.toFixed(1)} s · {done.voiced ? "z lektorem" : "bez dźwięku"} · {new Date(done.createdAt).toLocaleString("pl-PL")}
                </span>
              </p>
            ) : null}
            {done?.overruns.length ? <p className="text-xs text-amber-800">Lektor jest dłuższy niż beat: {done.overruns.map((o) => `${o.beat} (${o.voice} s w ${o.beat_s} s)`).join(", ")} - skróć zdanie tego beatu.</p> : null}
            {failed && !running && !done ? <p className="text-xs text-red-700">Render nie powiódł się: {failed.error ?? "nieznany błąd"}</p> : null}
            <p className="text-xs text-muted">MP4: H.264, 1080 × 1920, 30 kl./s. „Kadr PNG” zapisuje klatkę z miejsca, w którym stoi oś czasu (np. miniaturę).</p>
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <p className="text-sm text-muted">Idea</p>
            <p className="font-medium">{reel.idea}</p>
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm" data-testid="beat-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Beat</th>
                  <th className="px-3 py-2">Lektor (edytowalny)</th>
                  <th className="px-3 py-2">Na ekranie</th>
                  <th className="px-3 py-2">Obraz: co widać i dlaczego</th>
                </tr>
              </thead>
              <tbody>
                {reel.beats.map((b, i) => (
                  <tr key={b.id} className={cn("border-b border-line align-top", b.id === beat.id && reel.draw ? "bg-amber-50/60" : "")} data-testid="beat-row">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => (setPlaying(false), setT(Math.min(b.end - 0.05, b.start + (b.end - b.start) * 0.7)))} title="Skocz do tego beatu i zatrzymaj">
                        {i + 1}. {tc(b.start)}–{tc(b.end)}
                      </button>
                      <span className="block text-xs text-muted">{(b.end - b.start).toFixed(1)} s</span>
                    </td>
                    <td className="px-3 py-2">
                      <textarea value={vo[b.id] ?? b.vo} onChange={(e) => editVo(b.id, e.target.value)} rows={3} className="w-56 rounded-md border border-line bg-white px-2 py-1 text-sm" aria-label={`Lektor, beat ${i + 1}`} />
                    </td>
                    <td className="px-3 py-2 font-medium">{b.screen}</td>
                    <td className="px-3 py-2 text-muted">{b.visual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <details className="rounded-lg border border-line px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Cały tekst lektora</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm" data-testid="explainer-vo-full">{fullVo}</pre>
          </details>
          <p className="text-xs text-muted">To materiał edukacyjny, nie porada prawna. Sytuacje związane z przemocą, bezpieczeństwem albo pilną ochroną prawną mogą wymagać innej kolejności działań.</p>
        </div>
      </div>
    </div>
  );
}
