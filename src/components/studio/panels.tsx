"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDot, Combine, ImagePlus, Loader2, Music2, Plus, RefreshCw, Scissors, Sparkles, Split, Square, Trash2, Undo2, X } from "lucide-react";
import type { AssetInfo, AudioClip, AVClip, EditorDocument, Overlay, TextOverlay } from "@/lib/editor/types";
import {
  applyAcceptedPauses,
  applyPause,
  clipEnd,
  docDuration,
  formatShort,
  mergeSegmentWithNext,
  restorePause,
  setSegmentText,
  sourceRangeToTimeline,
  sourceToTimeline,
  splitSegmentAtWord,
  timedSegments,
  deleteSegment,
} from "@/lib/editor/timeline";
import { detectPauses, SENSITIVITY, type Sensitivity } from "@/lib/editor/silence";
import { makeZoom, suggestZooms, ZOOM_PRESETS, type ZoomIntensity } from "@/lib/editor/zoom";
import { SUBTITLE_PRESETS } from "@/lib/editor/subtitles";
import { questionOverlay } from "@/lib/editor/factory";
import { uid } from "@/lib/editor/id";
import { cn } from "@/lib/utils";
import { MASK_VERSION } from "@/lib/render/mask-format";
import { useStudio } from "./store";
import { Row, Section, Seg, Select, SButton, Slider, TextField } from "./controls";
import type { PlaybackEngine } from "./playback";
import { NarrationVoiceChanger } from "./narration";

export interface StudioMeta {
  compositionId: string;
  project: { id: string; name: string; themeId: string | null; voiceId: string };
  question: { id: string; text: string; spokenText?: string | null; status?: string } | null;
  take: { id: string; takeNumber: number; hasTranscript: boolean; transcriptionError: string | null; markers: unknown } | null;
  takes: Array<{ id: string; takeNumber: number; durationSec: number | null }>;
  elevenLabs: boolean;
}

function seekTo(engine: PlaybackEngine | null, t: number) {
  useStudio.getState().setTime(t);
  engine?.seek(t);
}

// ---------------------------------------------------------------------------
// Question
// ---------------------------------------------------------------------------
export function QuestionPanel({ meta }: { meta: StudioMeta }) {
  const doc = useStudio((s) => s.doc)!;
  const apply = useStudio((s) => s.apply);
  const q = doc.overlays.find((o): o is TextOverlay => o.kind === "text" && o.role === "question");
  const dur = docDuration(doc);
  const answerStart = doc.meta.mode === "CONTINUOUS" ? (doc.meta.narrationEnd ?? 0) : (doc.clips[0]?.start ?? 0);
  const mode = !q ? "none" : q.end == null ? "full" : Math.abs(q.end - Math.max(1.5, answerStart)) < 0.05 ? "narration" : "first";
  const setEnd = (end: number | null) => q && apply((d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === q.id ? { ...o, end } : o)) }));
  return (
    <div>
      <Section title="Pytanie">
        <p className="text-[13px] leading-snug text-studio-text">{meta.question?.text ?? doc.meta.questionText}</p>
        {q ? (
          <>
            <SButton onClick={() => useStudio.getState().select({ kind: "overlay", ids: [q.id] })}>Edytuj warstwę pytania</SButton>
            <Row label="Widoczność">
              <Select
                value={mode}
                onChange={(v) => {
                  if (v === "full") setEnd(null);
                  else if (v === "narration") setEnd(Math.max(1.5, answerStart));
                  else setEnd(Math.min(dur, answerStart + 4));
                }}
              >
                <option value="full">Przez cały film</option>
                <option value="narration">Tylko podczas czytania pytania</option>
                <option value="first">Pierwsze sekundy odpowiedzi</option>
              </Select>
            </Row>
            {mode === "first" ? (
              <Row label="Sekundy">
                <Slider value={Math.max(1, (q.end ?? dur) - answerStart)} min={1} max={15} step={0.5} onChange={(v) => setEnd(Math.min(dur, answerStart + v))} />
              </Row>
            ) : null}
          </>
        ) : (
          <SButton variant="primary" onClick={() => apply((d) => ({ ...d, overlays: [questionOverlay(d.meta.questionText, 0, null, d.theme), ...d.overlays] }))}>
            <Plus /> Dodaj warstwę pytania
          </SButton>
        )}
        <p className="text-[11.5px] text-studio-muted">Pytanie to edytowalna warstwa tekstowa — nigdy nie jest wypalane w oryginalnym nagraniu.</p>
      </Section>
      {meta.elevenLabs ? (
        <Section title="Lektor pytania (ElevenLabs)">
          <NarrationVoiceChanger questionText={meta.question?.spokenText || meta.question?.text || doc.meta.questionText} initialVoiceId={doc.narration.length ? null : meta.project.voiceId} />
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recordings / takes
// ---------------------------------------------------------------------------
/** Blur the room behind the expert (person mask computed once per recording on the server). */
function BackgroundBlurSection({ meta }: { meta: StudioMeta }) {
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const apply = useStudio((s) => s.apply);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blur = doc.clips.find((c) => (c.background?.blur ?? 0) > 0)?.background?.blur ?? 0;
  const [strength, setStrength] = useState(blur || 45);
  const masksReady = doc.clips.every((c) => !!assets[c.assetId]?.maskUrl);
  // masks from before the edge refinement: recompute them once in the background (old one stays until then)
  const outdated = blur > 0 && doc.clips.some((c) => assets[c.assetId]?.maskUrl && (assets[c.assetId]?.maskVersion ?? 1) < MASK_VERSION);
  const upgrading = useRef(false);
  // whole recording: all clips; the strength slider keeps the clips switched off in the list below off
  const setBlur = (v: number, onlyBlurred = false) =>
    apply((d) => ({ ...d, clips: d.clips.map((c) => (onlyBlurred && !(c.background?.blur ?? 0) ? c : { ...c, background: v > 0 ? { blur: v } : undefined })) }));

  /** `keep`: only (re)compute the masks — the per-clip blur choices stay as they are */
  const enable = async (keep = false) => {
    setErr(null);
    setBusy(true);
    try {
      const call = async () => {
        const res = await fetch(`/api/admin/compositions/${meta.compositionId}/segment`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Błąd HTTP ${res.status}`);
        return data as { jobs: string[]; assets: AssetInfo[] };
      };
      let data = await call();
      const started = Date.now();
      while (data.jobs.length) {
        await new Promise((r) => setTimeout(r, 2000));
        const states = await Promise.all(data.jobs.map(async (j) => (await fetch(`/api/admin/jobs/${j}`, { cache: "no-store" })).json().catch(() => null)));
        const failed = states.find((x) => x?.status === "FAILED");
        if (failed) throw new Error(failed.error ?? "Nie udało się wykryć sylwetki");
        if (states.every((x) => x?.status === "SUCCEEDED")) data = await call();
        if (Date.now() - started > 15 * 60_000) throw new Error("Analiza trwa zbyt długo — spróbuj ponownie później.");
      }
      useStudio.getState().addAssets(data.assets);
      if (!keep) setBlur(strength);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!outdated || upgrading.current) return;
    upgrading.current = true;
    void enable(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outdated]);

  // background mode: off / blurred room / AI image instead of the room (or the green screen)
  const imageId = doc.clips.find((c) => c.background?.imageAssetId)?.background?.imageAssetId ?? null;
  const mode: "off" | "blur" | "image" = imageId ? "image" : blur > 0 ? "blur" : "off";
  const [imagePanel, setImagePanel] = useState(false);
  const greenscreen = doc.clips.some((c) => assets[c.assetId]?.greenscreen);
  const imageBlur = doc.clips.find((c) => c.background?.imageAssetId)?.background?.imageBlur ?? 0;
  const bgFor = (c: AVClip, assetId: string) => ({ blur: 0, imageAssetId: assetId, imageBlur: imageBlur || undefined, despill: !!assets[c.assetId]?.greenscreen || undefined });
  const setImageBlur = (v: number) =>
    apply((d) => ({ ...d, clips: d.clips.map((c) => (c.background?.imageAssetId ? { ...c, background: { ...c.background, imageBlur: v || undefined } } : c)) }), "bg-image-blur");
  const setImage = (assetId: string) =>
    apply((d) => ({ ...d, clips: d.clips.map((c) => (mode === "image" && !c.background ? c : { ...c, background: bgFor(c, assetId) })) }), "bg-image");
  const onClip = (c: AVClip, on: boolean) =>
    apply((d) => ({ ...d, clips: d.clips.map((x) => (x.id !== c.id ? x : { ...x, background: !on ? undefined : mode === "image" && imageId ? bgFor(x, imageId) : { blur: strength } })) }), `bg-clip:${c.id}`);

  return (
    <Section title="Tło za ekspertem">
      <Seg<"off" | "blur" | "image">
        value={imagePanel && mode !== "blur" ? "image" : mode}
        onChange={(v) => {
          setImagePanel(v === "image");
          if (v === "off") setBlur(0);
          else if (v === "blur") void enable();
          else if (!masksReady || outdated) void enable(true);
        }}
        options={[
          ["off", "Bez zmian"],
          ["blur", "Rozmyte"],
          ["image", "Tło AI"],
        ]}
      />
      {busy ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-sky-300" data-testid="blur-busy">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {outdated ? "Poprawiam krawędzie maski (nowa, dokładniejsza wersja)…" : "Wykrywam sylwetkę eksperta…"} zwykle 1–2 minuty na minutę nagrania.
        </p>
      ) : null}
      {greenscreen && mode !== "off" ? (
        <p className="rounded-md bg-emerald-500/10 px-2 py-1 text-[11.5px] text-emerald-300" data-testid="greenscreen-detected">
          Wykryto greenscreen — tło jest wycinane po kolorze (czyste włosy i krawędzie), zielona poświata usuwana.
        </p>
      ) : null}
      {imagePanel || mode === "image" ? <AiBackgroundPanel meta={meta} current={imageId} disabled={busy || !masksReady} onPick={setImage} /> : null}
      {mode === "image" ? (
        <Row label={`Rozmycie tła AI: ${imageBlur}`}>
          <Slider value={imageBlur} min={0} max={100} step={5} onChange={setImageBlur} aria-label="Rozmycie tła AI" />
        </Row>
      ) : null}
      {blur > 0 ? (
        <Row label={`Siła rozmycia: ${strength}`}>
          <Slider
            value={strength}
            min={5}
            max={100}
            step={5}
            onChange={(v) => {
              setStrength(v);
              setBlur(v, true);
            }}
          />
        </Row>
      ) : null}
      {mode !== "off" ? (
        <>
          {!masksReady ? <p className="text-[11.5px] text-amber-300">Maska jeszcze się wczytuje…</p> : null}
          {doc.clips.length > 1 ? (
            <div className="space-y-1" data-testid="blur-clips">
              <p className="text-[11.5px] text-studio-muted">{mode === "image" ? "Tło AI" : "Rozmycie"} w klipach (nagranie jest pocięte):</p>
              {[...doc.clips]
                .sort((a, b) => a.start - b.start)
                .map((c, i) => (
                  <label key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-studio-line px-2 py-1 text-[12px]">
                    <span>
                      Klip {i + 1} <span className="text-studio-muted">· {formatShort(c.start)}–{formatShort(clipEnd(c))}</span>
                    </span>
                    <input type="checkbox" aria-label={`Rozmycie w klipie ${i + 1}`} checked={!!c.background && ((c.background.blur ?? 0) > 0 || !!c.background.imageAssetId)} onChange={(e) => onClip(c, e.target.checked)} />
                  </label>
                ))}
            </div>
          ) : null}
          <p className="text-[11.5px] text-studio-muted" data-testid="blur-on">
            {mode === "image" ? "Ekspert na tle AI" : "Ekspert zostaje ostry, tło jest rozmyte"} — w podglądzie i w eksporcie.
          </p>
        </>
      ) : !imagePanel ? (
        <p className="text-[11.5px] text-studio-muted">Rozmywa pokój za ekspertem albo podmienia tło na obraz AI (także greenscreen). Sylwetka jest wykrywana automatycznie (raz na nagranie).</p>
      ) : null}
      {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
    </Section>
  );
}

const NO_VARIANTS: string[] = [];

/** "Tło AI": OpenAI background plates in the theme colours, variants to pick from. */
function AiBackgroundPanel({ meta, current, disabled, onPick }: { meta: StudioMeta; current: string | null; disabled: boolean; onPick: (assetId: string) => void }) {
  const variants = useStudio((s) => s.doc?.meta.bgVariants ?? NO_VARIANTS);
  const assets = useStudio((s) => s.assets);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the project's library: backgrounds generated earlier for any video of this project
  const [library, setLibrary] = useState<string[]>([]);
  const loadLibrary = useCallback(async () => {
    const data = await fetch(`/api/admin/compositions/${meta.compositionId}/background`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!data) return;
    useStudio.getState().addAssets(data.assets ?? []);
    setLibrary((data.assets ?? []).map((a: { id: string }) => a.id));
  }, [meta.compositionId]);
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);
  const earlier = library.filter((id) => !variants.includes(id));
  const thumb = (id: string, label: string, testid: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={current === id}
      aria-label={label}
      data-testid={testid}
      className={cn("overflow-hidden rounded-md border-2 bg-studio-3", current === id ? "border-emerald-400" : "border-transparent hover:border-white/30")}
    >
      {assets[id] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assets[id].url} alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" />
      ) : (
        <div className="aspect-[9/16] w-full" />
      )}
    </button>
  );
  const generate = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/compositions/${meta.compositionId}/background`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea: idea.trim() || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Błąd HTTP ${res.status}`);
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const job = await (await fetch(`/api/admin/jobs/${data.jobId}`, { cache: "no-store" })).json().catch(() => null);
        if (job?.status === "FAILED") throw new Error(job.error ?? "Nie udało się wygenerować tła");
        if (job?.status === "SUCCEEDED") {
          const st = useStudio.getState();
          st.addAssets(job.assets ?? []);
          const ids: string[] = job.result?.variantIds ?? [job.result?.assetId].filter(Boolean);
          st.apply((d) => ({ ...d, meta: { ...d.meta, bgVariants: [...ids, ...(d.meta.bgVariants ?? [])].slice(0, 24) } }), "bg-variants");
          if (ids[0] && !current) onPick(ids[0]);
          void loadLibrary();
          break;
        }
        if (Date.now() - started > 6 * 60_000) throw new Error("Generowanie trwa zbyt długo — spróbuj ponownie.");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-studio-line p-2.5" data-testid="ai-background">
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={2}
        placeholder="Pomysł na tło (opcjonalnie), np. jasna kancelaria z regałem książek"
        aria-label="Pomysł na tło"
        className="w-full resize-y rounded-lg border border-studio-line bg-studio-3 px-2 py-1.5 text-[12px] text-studio-text outline-none focus:border-white/30"
      />
      <SButton className="w-full" onClick={generate} disabled={busy || disabled} data-testid="ai-background-generate">
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "OpenAI maluje tło…" : variants.length ? "Wygeneruj kolejne tła" : "Wygeneruj tło (warianty)"}
      </SButton>
      <p className="text-[11px] leading-snug text-studio-muted">W kolorach motywu i stylu kategorii, bez ludzi i tekstu, dopasowane do pytania. Bez pomysłu AI dobierze scenę do tematu.</p>
      {variants.length ? <div className="grid grid-cols-3 gap-1.5">{variants.map((id, i) => thumb(id, `Tło ${i + 1}`, "ai-background-variant"))}</div> : null}
      {earlier.length ? (
        <div className="space-y-1.5 pt-1" data-testid="ai-background-library">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-studio-muted">Wcześniejsze tła w projekcie</p>
          <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto">{earlier.map((id, i) => thumb(id, `Wcześniejsze tło ${i + 1}`, "ai-background-earlier"))}</div>
        </div>
      ) : null}
      {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
    </div>
  );
}

/** "Magic" picture correction like iMovie's Enhance: brightness / contrast / colour measured from the recording. */
function PictureLookSection({ meta }: { meta: StudioMeta }) {
  const doc = useStudio((s) => s.doc)!;
  const apply = useStudio((s) => s.apply);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = doc.clips.some((c) => !!c.look);
  const toggle = async (enable: boolean) => {
    setErr(null);
    if (!enable) return apply((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, look: undefined })) }), "look");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/compositions/${meta.compositionId}/look`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Błąd HTTP ${res.status}`);
      const looks = data.looks as Record<string, AVClip["look"]>;
      apply((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, look: looks[c.assetId] ?? c.look })) }), "look");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const look = doc.clips.find((c) => c.look)?.look;
  return (
    <Section title="Poprawa obrazu">
      <Seg<"off" | "on">
        value={on ? "on" : "off"}
        onChange={(v) => void toggle(v === "on")}
        options={[
          ["off", "Oryginał"],
          ["on", "Magiczna poprawa"],
        ]}
      />
      {busy ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-sky-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analizuję jasność i kolory nagrania…
        </p>
      ) : null}
      {on && look ? (
        <p className="text-[11.5px] text-studio-muted" data-testid="look-on">
          Jasność {Math.round(look.brightness * 100)}% · kontrast {Math.round(look.contrast * 100)}% · nasycenie {Math.round(look.saturate * 100)}% — dobrane automatycznie, jak „Popraw” w iMovie. Plik nagrania się nie zmienia.
        </p>
      ) : (
        <p className="text-[11.5px] text-studio-muted">Automatycznie rozjaśnia ciemne nagrania, dodaje kontrastu i ożywia wyblakłe kolory. Działa w podglądzie i w eksporcie.</p>
      )}
      {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
    </Section>
  );
}

export function TakesPanel({ meta, onReplaceTake }: { meta: StudioMeta; onReplaceTake: (takeId: string) => void }) {
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const apply = useStudio((s) => s.apply);
  const main = doc.clips[0] ? assets[doc.clips[0].assetId] : null;
  return (
    <div>
      <BackgroundBlurSection meta={meta} />
      <PictureLookSection meta={meta} />
      <Section title="Nagrania">
        {meta.takes.length === 0 ? <p className="text-[12.5px] text-studio-muted">Brak innych ujęć.</p> : null}
        {meta.takes.map((t) => {
          const current = meta.take?.id === t.id;
          return (
            <div key={t.id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]", current ? "border-white/40 bg-studio-3" : "border-studio-line")}>
              <span className="flex-1">
                Ujęcie {t.takeNumber}
                <span className="block text-[11px] text-studio-muted">{t.durationSec ? `${t.durationSec.toFixed(1)} s` : ""}</span>
              </span>
              {current ? (
                <span className="text-[11px] text-studio-muted">w użyciu</span>
              ) : (
                <SButton onClick={() => onReplaceTake(t.id)} title="Zamień ujęcie zachowując projekt graficzny">
                  Zamień ujęcie
                </SButton>
              )}
            </div>
          );
        })}
      </Section>
      <Section title="Klipy na osi czasu">
        {doc.clips.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2 text-[12.5px]">
            <span className="tabular w-5 text-studio-muted">{i + 1}.</span>
            <button className="flex-1 truncate text-left text-studio-text hover:underline" onClick={() => useStudio.getState().select({ kind: "clip", id: c.id })}>
              {c.label ?? "Klip"} · {(c.sourceOut - c.sourceIn).toFixed(1)} s
            </button>
            {c.muted ? <span className="text-[11px] text-studio-muted">wyciszony</span> : null}
          </div>
        ))}
        {main?.durationSec ? (
          <SButton
            variant="ghost"
            onClick={() => {
              if (!confirm("Przywrócić pełne nagranie (usuwa cięcia i pauzy z osi czasu)?")) return;
              apply((d) => {
                const first = d.clips[0];
                if (!first) return d;
                return { ...d, clips: [{ ...first, sourceIn: 0, sourceOut: main.durationSec!, start: d.meta.mode === "ANSWER_ONLY" ? first.start : 0, muted: false }], pauses: d.pauses.map((p) => ({ ...p, status: p.status === "applied" ? "pending" : p.status })) };
              });
            }}
          >
            <Undo2 /> Przywróć pełne nagranie
          </SButton>
        ) : null}
        <p className="text-[11.5px] text-studio-muted">Oryginalne nagranie nigdy nie jest modyfikowane — montaż to zapisane instrukcje cięć.</p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subtitles editor (transcript-driven)
// ---------------------------------------------------------------------------
export function SubtitlesPanel({ engine, meta, onRetranscribe }: { engine: PlaybackEngine | null; meta: StudioMeta; onRetranscribe: () => void }) {
  const doc = useStudio((s) => s.doc)!;
  const time = useStudio((s) => s.time);
  const apply = useStudio((s) => s.apply);
  const sel = useStudio((s) => s.selection);
  const segs = useMemo(() => timedSegments(doc), [doc]);
  const activeRef = useRef<HTMLDivElement>(null);
  const active = segs.find((s) => time >= s.t0 && time < s.t1)?.seg.id;
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div>
      <Section
        title="Napisy"
        right={
          <SButton variant="ghost" onClick={() => useStudio.getState().select({ kind: "subtitles" })}>
            Styl napisów
          </SButton>
        }
      >
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-studio-muted">{segs.length} segmentów</span>
          <button className={cn("rounded-md px-2 py-1 text-[11.5px]", doc.subtitles.enabled ? "bg-white text-black" : "bg-studio-3 text-studio-muted")} onClick={() => apply((d) => ({ ...d, subtitles: { ...d.subtitles, enabled: !d.subtitles.enabled } }))}>
            {doc.subtitles.enabled ? "Włączone" : "Wyłączone"}
          </button>
        </div>
        {!doc.subtitles.segments.length ? (
          <div className="rounded-lg border border-studio-line p-3 text-[12.5px] text-studio-muted">
            {meta.take?.transcriptionError ?? (meta.elevenLabs ? "Brak transkrypcji — trwa przetwarzanie lub nie wykryto mowy." : "Transkrypcja wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY).")}
            {meta.elevenLabs && meta.take ? (
              <SButton className="mt-2" onClick={onRetranscribe}>
                <RefreshCw /> Transkrybuj (ElevenLabs Scribe)
              </SButton>
            ) : null}
          </div>
        ) : null}
      </Section>
      <div className="space-y-1.5 px-3 py-3">
        {segs.map((s) => {
          const isActive = s.seg.id === active;
          const selected = sel?.kind === "subtitles" && sel.segId === s.seg.id;
          return (
            <div key={s.seg.id} ref={isActive ? activeRef : undefined} className={cn("group rounded-lg border p-2 transition", selected ? "border-white/50 bg-studio-3" : isActive ? "border-amber-400/50 bg-amber-400/[.06]" : "border-transparent hover:border-studio-line")}>
              <div className="mb-1 flex items-center gap-1.5">
                <button className="tabular text-[11px] text-studio-muted hover:text-studio-text" onClick={() => seekTo(engine, s.t0)}>
                  {formatShort(s.t0)}
                </button>
                <span className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <IconBtn title="Połącz z następnym" onClick={() => apply((d) => mergeSegmentWithNext(d, s.seg.id))}>
                    <Combine />
                  </IconBtn>
                  <IconBtn title="Usuń segment (tylko napis, dźwięk zostaje)" onClick={() => apply((d) => deleteSegment(d, s.seg.id))}>
                    <Trash2 />
                  </IconBtn>
                </span>
              </div>
              <SegmentWords seg={s} onSplit={(i) => apply((d) => splitSegmentAtWord(d, s.seg.id, i))} onSeek={(t) => seekTo(engine, t)} time={time} />
              <SegmentText
                text={s.seg.words.map((w) => w.text).join(" ")}
                onCommit={(text) => apply((d) => setSegmentText(d, s.seg.id, text), `segtext:${s.seg.id}`)}
                onFocus={() => {
                  useStudio.getState().select({ kind: "subtitles", segId: s.seg.id });
                  seekTo(engine, s.t0 + 0.01);
                }}
              />
            </div>
          );
        })}
      </div>
      {segs.length ? <p className="px-4 pb-4 text-[11.5px] text-studio-muted">Edycja napisów nie zmienia nagrania ani oryginalnej transkrypcji. Kliknij słowo, aby przejść do niego; ✂ dzieli segment.</p> : null}
    </div>
  );
}

function SegmentWords({ seg, onSplit, onSeek, time }: { seg: ReturnType<typeof timedSegments>[number]; onSplit: (i: number) => void; onSeek: (t: number) => void; time: number }) {
  return (
    <div className="mb-1 flex flex-wrap gap-x-1 gap-y-0.5 text-[11.5px]">
      {seg.words.map((w, i) => (
        <span key={w.id} className="inline-flex items-center">
          {i > 0 ? (
            <button className="mx-0.5 hidden text-studio-muted hover:text-white group-hover:inline" title="Podziel tutaj" onClick={() => onSplit(i)}>
              <Scissors className="h-2.5 w-2.5" />
            </button>
          ) : null}
          <button className={cn("rounded px-0.5", time >= w.t0 && time < w.t1 ? "bg-amber-400 text-black" : "text-studio-muted hover:text-studio-text")} onClick={() => onSeek(w.t0)}>
            {w.text}
          </button>
        </span>
      ))}
    </div>
  );
}

function SegmentText({ text, onCommit, onFocus }: { text: string; onCommit: (t: string) => void; onFocus: () => void }) {
  const [v, setV] = useState(text);
  const [prev, setPrev] = useState(text);
  if (prev !== text) {
    setPrev(text);
    setV(text);
  }
  return (
    <textarea
      rows={1}
      aria-label="Tekst napisu"
      className="w-full resize-none rounded-md border border-studio-line bg-studio-2 px-2 py-1 text-[12.5px] text-studio-text outline-none focus:border-white/30"
      value={v}
      onFocus={onFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== text && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="rounded p-1 text-studio-muted hover:bg-studio-line hover:text-studio-text [&_svg]:size-3">
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pauses — "Wykryj pauzy"
// ---------------------------------------------------------------------------
export function PausesPanel({ engine }: { engine: PlaybackEngine | null }) {
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const apply = useStudio((s) => s.apply);
  const sel = useStudio((s) => s.selection);
  const [analyzing, setAnalyzing] = useState(false);
  const assetId = doc.clips[0]?.assetId;
  const wf = assetId ? assets[assetId]?.waveform : null;

  const detect = (sensitivity: Sensitivity, padding: number) => {
    if (!assetId || !wf) return;
    setAnalyzing(true);
    // word timestamps from the (edited) subtitles refine edges; audio energy decides what is silent
    const words = doc.subtitles.segments.filter((s) => s.assetId === assetId).flatMap((s) => s.words);
    const exclude: Array<[number, number]> = doc.meta.mode === "CONTINUOUS" && doc.meta.narrationEnd ? [[0, doc.meta.narrationEnd]] : [];
    const found = detectPauses({ waveform: wf, words, sensitivity, padding, exclude });
    apply((d) => ({
      ...d,
      meta: { ...d.meta, pauseSensitivity: sensitivity, pausePadding: padding },
      pauses: [
        ...d.pauses.filter((p) => p.status === "applied"),
        ...found
          .filter((f) => !d.pauses.some((p) => p.status === "applied" && p.assetId === assetId && Math.abs(p.start - f.start) < 0.05))
          .map((f) => ({ id: uid("pause"), assetId, start: f.start, end: f.end, confidence: f.confidence, status: "pending" as const })),
      ],
    }));
    setTimeout(() => setAnalyzing(false), 150);
  };

  const visible = doc.pauses
    .filter((p) => p.status !== "rejected")
    .map((p) => ({ p, t: sourceToTimeline(doc, p.assetId, p.start), ranges: sourceRangeToTimeline(doc, p.assetId, p.start, p.end) }))
    .sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9));
  const pending = visible.filter((v) => v.p.status !== "applied");
  const total = pending.reduce((n, v) => n + (v.p.end - v.p.start), 0);
  const accepted = doc.pauses.filter((p) => p.status === "accepted");
  const selected = sel?.kind === "pause" ? doc.pauses.find((p) => p.id === sel.id) : null;
  const setStatus = (id: string, status: "pending" | "accepted" | "rejected") => apply((d) => ({ ...d, pauses: d.pauses.map((p) => (p.id === id ? { ...p, status } : p)) }));

  const preview = (a: number, b: number) => {
    seekTo(engine, Math.max(0, a - 1));
    engine?.play();
    useStudio.getState().setPlaying(true);
    setTimeout(() => {
      engine?.pause();
      useStudio.getState().setPlaying(false);
    }, (b - a + 2) * 1000);
  };

  return (
    <div>
      <Section title="Wykryj pauzy">
        <Row label="Czułość">
          <Select value={doc.meta.pauseSensitivity} onChange={(v) => detect(v as Sensitivity, doc.meta.pausePadding)}>
            {Object.entries(SENSITIVITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label} (≥ {v.minPause.toFixed(1)} s)
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Oddech">
          <Slider value={doc.meta.pausePadding} min={0.05} max={0.5} step={0.01} onChange={(v) => apply((d) => ({ ...d, meta: { ...d.meta, pausePadding: v } }), "padding")} format={(v) => `${Math.round(v * 1000)} ms`} />
        </Row>
        <SButton variant="primary" className="w-full" onClick={() => detect(doc.meta.pauseSensitivity, doc.meta.pausePadding)} disabled={!wf || analyzing}>
          {analyzing ? <Loader2 className="animate-spin" /> : <Sparkles />} Wykryj pauzy
        </SButton>
        {!wf ? <p className="text-[11.5px] text-studio-muted">Analiza dźwięku jeszcze trwa.</p> : null}
        <p className="text-[12.5px] text-studio-text" data-testid="pause-summary">
          {pending.length ? `Znaleziono ${pending.length} potencjalnych pauz — łącznie ${total.toFixed(1).replace(".", ",")} s.` : "Brak pauz do przejrzenia."}
        </p>
        <div className="flex flex-col gap-2">
          <SButton
            disabled={!selected || selected.status === "applied"}
            onClick={() => {
              if (!selected) return;
              apply((d) => applyPause(d, selected.id));
            }}
          >
            <Scissors /> Usuń zaznaczoną pauzę
          </SButton>
          <SButton variant="danger" disabled={!accepted.length} onClick={() => apply((d) => applyAcceptedPauses(d))}>
            Usuń wszystkie zaakceptowane ({accepted.length})
          </SButton>
        </div>
        <SButton variant="ghost" disabled={!pending.length} onClick={() => apply((d) => ({ ...d, pauses: d.pauses.map((p) => (p.status === "pending" ? { ...p, status: "accepted" as const } : p)) }))}>
          <Check /> Zaakceptuj wszystkie
        </SButton>
      </Section>
      <div className="space-y-1.5 p-3">
        {visible.map(({ p, t, ranges }, i) => {
          const a = ranges[0]?.[0] ?? t ?? 0;
          const b = ranges[ranges.length - 1]?.[1] ?? a;
          const isSel = sel?.kind === "pause" && sel.id === p.id;
          return (
            <div
              key={p.id}
              className={cn("rounded-lg border p-2.5 text-[12.5px]", isSel ? "border-white/50 bg-studio-3" : "border-studio-line", p.status === "applied" && "opacity-60")}
              onClick={() => {
                useStudio.getState().select({ kind: "pause", id: p.id });
                if (p.status !== "applied") seekTo(engine, Math.max(0, a - 0.3));
              }}
              data-testid="pause-item"
            >
              <div className="flex items-center gap-2">
                <CircleDot className={cn("h-3.5 w-3.5", p.status === "accepted" ? "text-red-400" : p.status === "applied" ? "text-studio-muted" : "text-orange-300")} />
                <span className="font-medium">Pauza {i + 1}</span>
                <span className="tabular text-studio-muted">{p.status === "applied" ? `${(p.end - p.start).toFixed(1)} s · usunięta` : `${formatShort(a)}–${formatShort(b)}`}</span>
                <span className="tabular ml-auto text-studio-muted">{(p.end - p.start).toFixed(1)} s</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                {p.status === "applied" ? (
                  <SButton variant="ghost" onClick={() => apply((d) => restorePause(d, p.id))}>
                    <Undo2 /> Przywróć
                  </SButton>
                ) : (
                  <>
                    <SButton variant="ghost" onClick={() => preview(a, b)}>
                      Podgląd
                    </SButton>
                    <SButton variant={p.status === "accepted" ? "primary" : "default"} onClick={() => setStatus(p.id, p.status === "accepted" ? "pending" : "accepted")}>
                      <Check /> {p.status === "accepted" ? "Do usunięcia" : "Akceptuj"}
                    </SButton>
                    <SButton onClick={() => apply((d) => applyPause(d, p.id))}>
                      <Trash2 /> Usuń
                    </SButton>
                    <SButton variant="ghost" onClick={() => setStatus(p.id, "rejected")}>
                      <X /> Zostaw
                    </SButton>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-4 text-[11.5px] text-studio-muted">Pauzy wykrywane są na podstawie energii dźwięku i znaczników czasu słów. Cięcia zostawiają naturalny oddech i są w pełni odwracalne.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zooms — "Dynamiczne zbliżenia"
// ---------------------------------------------------------------------------
export function ZoomPanel({ engine }: { engine: PlaybackEngine | null }) {
  const doc = useStudio((s) => s.doc)!;
  const time = useStudio((s) => s.time);
  const apply = useStudio((s) => s.apply);
  const [intensity, setIntensity] = useState<ZoomIntensity>("standard");
  const suggested = doc.zooms.filter((z) => z.suggested);
  const add = (type: keyof typeof ZOOM_PRESETS) => {
    const z = makeZoom(type, time);
    z.end = Math.min(docDuration(doc), z.end);
    if (z.end - z.start < 0.3) return;
    apply((d) => ({ ...d, zooms: [...d.zooms, z] }));
    useStudio.getState().select({ kind: "zoom", id: z.id });
  };
  return (
    <div>
      <Section title="Dynamiczne zbliżenia">
        <p className="text-[12px] text-studio-muted">Dodaj efekt w miejscu głowicy odtwarzania:</p>
        <div className="grid grid-cols-1 gap-1.5">
          {Object.entries(ZOOM_PRESETS).map(([k, v]) => (
            <SButton key={k} onClick={() => add(k as keyof typeof ZOOM_PRESETS)}>
              {v.label}
            </SButton>
          ))}
        </div>
      </Section>
      <Section title="Automatyczne propozycje">
        <p className="text-[12px] text-studio-muted">Intensywność</p>
        <Seg value={intensity} onChange={setIntensity} options={[["minimal", "Minimal"], ["standard", "Standard"], ["dynamic", "Dynamic"]]} />
        <SButton
          variant="primary"
          className="w-full"
          onClick={() => {
            const base = doc.clips[0]?.framing;
            const props = suggestZooms({ ...doc, zooms: doc.zooms.filter((z) => !z.suggested) }, intensity, base ? { cx: base.cx, cy: base.cy } : undefined);
            apply((d) => ({ ...d, zooms: [...d.zooms.filter((z) => !z.suggested), ...props] }));
          }}
        >
          <Sparkles /> Zaproponuj dynamiczne zbliżenia
        </SButton>
        {suggested.length ? (
          <div className="space-y-1.5">
            <p className="text-[12.5px]">{suggested.length} propozycji (przerywane na osi czasu):</p>
            {suggested.map((z) => (
              <div key={z.id} className="flex items-center gap-2 rounded-lg border border-studio-line px-2 py-1.5 text-[12px]">
                <button className="tabular flex-1 text-left" onClick={() => seekTo(engine, z.start)}>
                  {formatShort(z.start)}–{formatShort(z.end)} · {ZOOM_PRESETS[z.type].label} {Math.round(z.toScale * 100)}%
                </button>
                <IconBtn title="Akceptuj" onClick={() => apply((d) => ({ ...d, zooms: d.zooms.map((x) => (x.id === z.id ? { ...x, suggested: false } : x)) }))}>
                  <Check />
                </IconBtn>
                <IconBtn title="Edytuj" onClick={() => useStudio.getState().select({ kind: "zoom", id: z.id })}>
                  <Square />
                </IconBtn>
                <IconBtn title="Usuń" onClick={() => apply((d) => ({ ...d, zooms: d.zooms.filter((x) => x.id !== z.id) }))}>
                  <X />
                </IconBtn>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <SButton onClick={() => apply((d) => ({ ...d, zooms: d.zooms.map((z) => ({ ...z, suggested: false })) }))}>
                <Check /> Akceptuj wszystkie
              </SButton>
              <SButton variant="ghost" onClick={() => apply((d) => ({ ...d, zooms: d.zooms.filter((z) => !z.suggested) }))}>
                Odrzuć wszystkie
              </SButton>
            </div>
          </div>
        ) : null}
        <p className="text-[11.5px] text-studio-muted">Propozycje opierają się na granicach zdań (znaczniki czasu słów), istniejących cięciach i minimalnym odstępie między efektami. Środek kadru ustawiasz ręcznie — aplikacja nie śledzi twarzy.</p>
      </Section>
      <Section title={`Efekty (${doc.zooms.filter((z) => !z.suggested).length})`}>
        {doc.zooms
          .filter((z) => !z.suggested)
          .sort((a, b) => a.start - b.start)
          .map((z) => (
            <button key={z.id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-studio-3" onClick={() => useStudio.getState().select({ kind: "zoom", id: z.id })}>
              <span className="tabular text-studio-muted">{formatShort(z.start)}</span>
              <span className="flex-1">{ZOOM_PRESETS[z.type].label}</span>
              <span className="tabular text-studio-muted">
                {Math.round(z.fromScale * 100)}→{Math.round(z.toScale * 100)}%
              </span>
            </button>
          ))}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio: narration voice + background music
// ---------------------------------------------------------------------------
export function AudioPanel({ meta, onUpload, onRegenerate }: { meta: StudioMeta; onUpload: (f: File) => Promise<void>; onRegenerate: (voiceId: string) => Promise<void> }) {
  const doc = useStudio((s) => s.doc)!;
  const apply = useStudio((s) => s.apply);
  const assets = useStudio((s) => s.assets);
  const [voice, setVoice] = useState(meta.project.voiceId);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const musicAssets = Object.values(assets).filter((a) => a.kind === "MUSIC");
  const addMusic = (assetId: string) => {
    const a = assets[assetId];
    const dur = docDuration(doc);
    const clip: AudioClip = { id: uid("aud"), assetId, kind: "music", start: 0, sourceIn: 0, sourceOut: Math.min(a?.durationSec ?? dur, dur), volume: 0.18, muted: false, fadeIn: 1, fadeOut: 2, label: a?.label ?? "Muzyka" };
    apply((d) => ({ ...d, music: [...d.music, clip] }));
    useStudio.getState().select({ kind: "music", id: clip.id });
  };
  return (
    <div>
      <Section title="Lektor ElevenLabs">
        {doc.narration.length ? (
          doc.narration.map((n) => (
            <div key={n.id} className="flex items-center gap-2 text-[12.5px]">
              <button className="flex-1 text-left hover:underline" onClick={() => useStudio.getState().select({ kind: "narration", id: n.id })}>
                {n.label ?? "Lektor"} · {(n.sourceOut - n.sourceIn).toFixed(1)} s
              </button>
              <SButton variant="ghost" onClick={() => apply((d) => ({ ...d, narration: d.narration.map((x) => (x.id === n.id ? { ...x, muted: !x.muted } : x)) }))}>
                {n.muted ? "Włącz" : "Wycisz"}
              </SButton>
            </div>
          ))
        ) : (
          <p className="text-[12.5px] text-studio-muted">Brak ścieżki lektora{meta.elevenLabs ? "" : " — wymaga konfiguracji ElevenLabs"}.</p>
        )}
        {meta.elevenLabs ? <NarrationVoiceChanger questionText={meta.question?.spokenText || meta.question?.text} initialVoiceId={doc.narration.length ? null : meta.project.voiceId} /> : null}
        <p className="text-[11.5px] text-studio-muted">Głos lektora to osobny plik audio — nigdy nie jest nagrywany przez mikrofon telefonu.</p>
      </Section>
      <VoiceEnhanceSection meta={meta} />
      <Section title="Muzyka w tle">
        {doc.music.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-2 text-left text-[12.5px] hover:underline" onClick={() => useStudio.getState().select({ kind: "music", id: m.id })}>
            <Music2 className="h-3.5 w-3.5" /> {m.label ?? "Muzyka"} · {Math.round(m.volume * 100)}%
          </button>
        ))}
        {musicAssets
          .filter((a) => !doc.music.some((m) => m.assetId === a.id))
          .map((a) => (
            <SButton key={a.id} variant="ghost" onClick={() => addMusic(a.id)}>
              <Plus /> {a.label ?? "Plik audio"}
            </SButton>
          ))}
        <SButton
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Wgraj muzykę
        </SButton>
        <input
          ref={fileRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            try {
              await onUpload(f);
            } finally {
              setBusy(false);
            }
          }}
        />
        <p className="text-[11.5px] text-studio-muted">Używaj wyłącznie muzyki, do której masz licencję.</p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text, graphics and templates
// ---------------------------------------------------------------------------
function baseOverlay(name: string, t: number): Pick<Overlay, "id" | "name" | "start" | "end" | "opacity" | "animation"> {
  return { id: uid("ovl"), name, start: Math.max(0, t), end: t + 4, opacity: 1, animation: "fade" };
}

function textOverlay(name: string, t: number, text: string, style: Partial<TextOverlay["style"]>, pos: { x: number; y: number; w: number }): TextOverlay {
  return {
    ...baseOverlay(name, t),
    kind: "text",
    role: "custom",
    text,
    ...pos,
    h: 0.06,
    style: {
      fontFamily: "$label",
      fontSize: 52,
      fontWeight: 700,
      color: "$text",
      align: "center",
      lineHeight: 1.2,
      letterSpacing: 0,
      background: null,
      backgroundOpacity: 0.9,
      padding: 18,
      radius: 16,
      shadow: 12,
      uppercase: false,
      ...style,
    },
  };
}

export function TextPanel() {
  const time = useStudio((s) => s.time);
  const add = (o: Overlay) => {
    useStudio.getState().apply((d) => ({ ...d, overlays: [...d.overlays, o] }));
    useStudio.getState().select({ kind: "overlay", ids: [o.id] });
  };
  return (
    <Section title="Tekst">
      <button className="w-full rounded-lg border border-studio-line p-3 text-left hover:bg-studio-3" onClick={() => add(textOverlay("Nagłówek", time, "Nagłówek", { fontFamily: "$question", fontSize: 76, fontWeight: 800, uppercase: true }, { x: 0.08, y: 0.4, w: 0.84 }))}>
        <span className="font-display text-lg font-extrabold">NAGŁÓWEK</span>
      </button>
      <button className="w-full rounded-lg border border-studio-line p-3 text-left hover:bg-studio-3" onClick={() => add(textOverlay("Tekst", time, "Dodaj tekst", {}, { x: 0.1, y: 0.45, w: 0.8 }))}>
        <span className="text-sm font-semibold">Zwykły tekst</span>
      </button>
      <button
        className="w-full rounded-lg border border-studio-line p-3 text-left hover:bg-studio-3"
        onClick={() => add(textOverlay("Etykieta", time, "WAŻNE", { fontSize: 40, fontWeight: 800, background: "$accent", color: "#111111", uppercase: true, letterSpacing: 2, padding: 14 }, { x: 0.35, y: 0.3, w: 0.3 }))}
      >
        <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-extrabold text-black">ETYKIETA</span>
      </button>
      <button
        className="w-full rounded-lg border border-studio-line p-3 text-left hover:bg-studio-3"
        onClick={() => add(textOverlay("Liczba", time, "2 500 zł", { fontFamily: "$question", fontSize: 120, fontWeight: 800, color: "$highlight" }, { x: 0.1, y: 0.38, w: 0.8 }))}
      >
        <span className="font-display text-xl font-extrabold text-amber-300">2 500 zł</span>
        <span className="block text-[11px] text-studio-muted">Duża liczba / kwota</span>
      </button>
    </Section>
  );
}

export function GraphicsPanel({ onUpload, meta }: { onUpload: (f: File) => Promise<AssetInfo | null>; meta: StudioMeta }) {
  const time = useStudio((s) => s.time);
  const doc = useStudio((s) => s.doc)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [anim, setAnim] = useState<Overlay["animation"]>("pop");
  const add = (o: Overlay) => {
    useStudio.getState().apply((d) => ({ ...d, overlays: [...d.overlays, o] }));
    useStudio.getState().select({ kind: "overlay", ids: [o.id] });
  };
  const items: Array<[string, () => Overlay]> = [
    ["Prostokąt", () => ({ ...baseOverlay("Prostokąt", time), kind: "rect", x: 0.2, y: 0.4, w: 0.6, h: 0.12, fill: "$primary", stroke: null, strokeWidth: 0, radius: 24 })],
    ["Elipsa", () => ({ ...baseOverlay("Elipsa", time), kind: "ellipse", x: 0.35, y: 0.4, w: 0.3, h: 0.17, fill: null, stroke: "$accent", strokeWidth: 8, radius: 0 })],
    ["Blur behind", () => ({ ...baseOverlay("Blur behind", time), kind: "blur", end: time + 3, animation: "fade", x: 0.3, y: 0.38, w: 0.4, h: 0.2, shape: "rect", strength: 60, radius: 24 })],
    ["Wyróżnienie", () => ({ ...baseOverlay("Wyróżnienie", time), kind: "highlight", x: 0.15, y: 0.42, w: 0.7, h: 0.1, fill: "$accent", stroke: "$accent", strokeWidth: 5, radius: 18 })],
    ["Dymek / callout", () => ({ ...baseOverlay("Callout", time), kind: "callout", x: 0.08, y: 0.32, w: 0.84, h: 0.11, title: "Pamiętaj!", subtitle: "Ochrona trwa 10 lat i można ją przedłużać.", fill: "$primary", accent: "$accent", textColor: "$text", fontFamily: "$label", animation: "pop" })],
    ["Belka (lower third)", () => ({ ...baseOverlay("Belka", time), kind: "lowerThird", end: time + 5, x: 0.06, y: 0.6, w: 0.66, h: 0.08, title: "Imię Nazwisko", subtitle: meta.project.name, fill: "$primary", accent: "$accent", textColor: "$text", fontFamily: "$label", animation: "slide" })],
  ];
  return (
    <div>
      <Section title="Kształty i elementy">
        <div className="grid grid-cols-2 gap-1.5">
          {items.map(([label, make]) => (
            <SButton key={label} onClick={() => add(make())}>
              {label}
            </SButton>
          ))}
        </div>
      </Section>
      <Section title="Logo i obrazy">
        <SButton disabled={!doc.theme.logoAssetId} onClick={() => add({ ...baseOverlay("Logo", 0), end: null, kind: "logo", assetId: null, fit: "contain", x: 0.39, y: 0.9, w: 0.22, h: 0.05 })}>
          <Plus /> Logo z motywu
        </SButton>
        {!doc.theme.logoAssetId ? <p className="text-[11.5px] text-studio-muted">Wgraj logo w ustawieniach motywu.</p> : null}
      </Section>
      <Section title="Własna grafika lub wideo">
        <p className="text-[12px] text-studio-muted">Obraz (PNG, JPG, WEBP), animowany GIF albo wideo (MP4, MOV, WEBM) jako osobna warstwa nad nagraniem — od miejsca głowicy odtwarzania.</p>
        <Row label="Animacja wejścia">
          <Select value={anim} onChange={(v) => setAnim(v as Overlay["animation"])}>
            <option value="pop">Pop (odbicie)</option>
            <option value="fade">Pojawienie</option>
            <option value="slide">Wjazd z dołu</option>
            <option value="slideDown">Wjazd z góry</option>
            <option value="slideLeft">Wjazd z boku</option>
            <option value="zoom">Najazd (zoom)</option>
            <option value="none">Brak</option>
          </Select>
        </Row>
        <SButton variant="primary" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} {uploading ? "Wysyłanie i konwersja…" : "Wgraj grafikę lub wideo"}
        </SButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setUploading(true);
            try {
              const a = await onUpload(f);
              if (!a) return;
              // keep the file's aspect ratio: 60% of the frame width, centred
              const w = 0.6;
              const ar = a.width && a.height ? a.width / a.height : 16 / 9;
              const h = Math.min(0.6, (w * doc.width) / ar / doc.height);
              const pos = { x: (1 - w) / 2, y: 0.36 - h / 2 + 0.05, w, h };
              const total = docDuration(doc);
              if (a.kind === "OVERLAY_VIDEO") {
                const end = Math.min(total, time + Math.max(1, a.durationSec ?? 5));
                add({ ...baseOverlay(f.name, time), end, animation: anim, kind: "video", assetId: a.id, fit: "contain", sourceIn: 0, loop: false, volume: 0, radius: 24, ...pos });
              } else {
                add({ ...baseOverlay(f.name, time), animation: anim, kind: "image", assetId: a.id, fit: "contain", ...pos });
              }
            } finally {
              setUploading(false);
            }
          }}
        />
        <p className="text-[11.5px] text-studio-muted">Wideo jest domyślnie wyciszone — dźwięk włączysz we właściwościach warstwy. Maks. 300 MB / 5 min.</p>
      </Section>
    </div>
  );
}

export function TemplatesPanel() {
  const apply = useStudio((s) => s.apply);
  const doc = useStudio((s) => s.doc)!;
  const setPreset = (k: keyof typeof SUBTITLE_PRESETS) => apply((d) => ({ ...d, subtitles: { ...d.subtitles, preset: k, style: { ...SUBTITLE_PRESETS[k].style } } }));
  const layout = (fn: (d: EditorDocument) => EditorDocument) => apply(fn);
  return (
    <div>
      <Section title="Style napisów">
        <div className="grid grid-cols-1 gap-1.5">
          {Object.entries(SUBTITLE_PRESETS).map(([k, v]) => (
            <button key={k} onClick={() => setPreset(k as keyof typeof SUBTITLE_PRESETS)} className={cn("rounded-lg border px-3 py-2.5 text-left transition hover:bg-studio-3", doc.subtitles.preset === k ? "border-white/50" : "border-studio-line")}>
              <PresetSample k={k as keyof typeof SUBTITLE_PRESETS} highlight={doc.theme.highlight} />
              <span className="mt-1 block text-[11px] text-studio-muted">{v.label}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Układy">
        <SButton
          className="w-full"
          onClick={() =>
            layout((d) => ({
              ...d,
              overlays: d.overlays.map((o) => (o.kind === "text" && o.role === "question" ? { ...o, x: 0.07, y: 0.085, w: 0.86 } : o)),
              subtitles: { ...d.subtitles, style: { ...d.subtitles.style, y: 0.73 } },
            }))
          }
        >
          Klasyczny: pytanie u góry, napisy na dole
        </SButton>
        <SButton
          className="w-full"
          onClick={() =>
            layout((d) => ({
              ...d,
              overlays: d.overlays.map((o) => (o.kind === "text" && o.role === "question" ? { ...o, x: 0.07, y: 0.12, w: 0.86, style: { ...o.style, background: null, shadow: 30 } } : o)),
              subtitles: { ...d.subtitles, style: { ...d.subtitles.style, y: 0.66 } },
            }))
          }
        >
          Lekki: pytanie bez tła
        </SButton>
        <SButton
          className="w-full"
          onClick={() =>
            layout((d) => ({
              ...d,
              overlays: d.overlays.map((o) => (o.kind === "text" && o.role === "question" ? { ...o, style: { ...o.style, background: "$accent", color: "#111111" } } : o)),
            }))
          }
        >
          Akcent: pytanie na kolorze akcentu
        </SButton>
      </Section>
    </div>
  );
}

function PresetSample({ k, highlight }: { k: keyof typeof SUBTITLE_PRESETS; highlight: string }) {
  const st = SUBTITLE_PRESETS[k].style;
  const words = ["Chroń", "swoją", "markę"];
  return (
    <span className="flex flex-wrap gap-1" style={{ fontFamily: st.fontFamily.startsWith("$") ? undefined : st.fontFamily, fontWeight: st.fontWeight, textTransform: st.case === "upper" ? "uppercase" : undefined }}>
      {words.map((w, i) => (
        <span
          key={w}
          className="rounded px-1 text-[13px]"
          style={{
            color: st.background === "#FFFFFF" ? "#111" : i === 1 && st.highlightMode === "color" ? highlight : "#fff",
            background: i === 1 && st.highlightMode === "box" ? highlight : st.background ? `${st.background}cc` : undefined,
            WebkitTextStroke: st.stroke ? "0.6px #000" : undefined,
          }}
        >
          {w}
        </span>
      ))}
    </span>
  );
}

export { Split };

// ---------------------------------------------------------------------------
// "Ulepsz głos" — podcast-style enhancement that keeps the expert's own voice
// ---------------------------------------------------------------------------
type EnhanceMode = "original" | "podcast" | "isolator";
type Strength = "natural" | "podcast" | "radio";

function VoiceEnhanceSection({ meta }: { meta: StudioMeta }) {
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const [busy, setBusy] = useState<EnhanceMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const firstAudio = doc.clips.find((c) => c.audioAssetId)?.audioAssetId;
  const currentMode: EnhanceMode = firstAudio ? (assets[firstAudio]?.variant === "isolator" ? "isolator" : "podcast") : "original";
  const [mode, setMode] = useState<EnhanceMode>(currentMode);
  const currentStrength = (firstAudio ? assets[firstAudio]?.strength : null) as Strength | null;
  const [strength, setStrength] = useState<Strength>(currentStrength ?? "podcast");

  const applyMode = async (m: EnhanceMode, level: Strength = strength) => {
    setErr(null);
    setMode(m);
    if (m === "original") {
      useStudio.getState().apply((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, audioAssetId: null })) }));
      return;
    }
    setBusy(m);
    try {
      const readJson = async (r: Response) => {
        const txt = await r.text();
        try {
          return JSON.parse(txt);
        } catch {
          throw new Error(r.status >= 500 ? `Serwer nie odpowiedział poprawnie (HTTP ${r.status}) — mógł się właśnie aktualizować. Spróbuj ponownie za chwilę.` : `Błąd HTTP ${r.status}`);
        }
      };
      const res = await fetch(`/api/admin/compositions/${meta.compositionId}/enhance-audio`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: m, strength: level }) });
      let data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? `Nie udało się ulepszyć dźwięku (HTTP ${res.status})`);
      if (data.jobId) {
        // processed in the background (ElevenLabs + FFmpeg); poll until done
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000));
          const jr = await fetch(`/api/admin/jobs/${data.jobId}`, { cache: "no-store" });
          const job = await readJson(jr).catch(() => null);
          if (!job) continue;
          if (job.status === "SUCCEEDED") {
            data = { map: job.result?.map ?? {}, assets: job.assets };
            break;
          }
          if (job.status === "FAILED") throw new Error(job.error ?? "Nie udało się ulepszyć dźwięku");
          if (job.status === "QUEUED" && job.error) setErr(`Ponawiam… (${String(job.error).slice(0, 160)})`);
          if (Date.now() - started > 15 * 60_000) throw new Error("Przetwarzanie trwa zbyt długo — spróbuj ponownie później.");
        }
        setErr(null);
      }
      const st = useStudio.getState();
      st.addAssets(data.assets);
      st.apply((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, audioAssetId: data.map[c.assetId] ?? c.audioAssetId ?? null })) }));
    } catch (e) {
      setErr((e as Error).message);
      setMode(currentMode);
    } finally {
      setBusy(null);
    }
  };

  const options: Array<[EnhanceMode, string, string]> = [
    ["original", "Oryginał", "Dźwięk dokładnie taki, jak nagrał telefon."],
    ["podcast", "Podcast", "Redukcja szumu, ciepło i czytelność głosu (EQ), de-esser, kompresja, głośność −16 LUFS i wyciszenie tła w przerwach. Bez kosztów."],
    ["isolator", "Podcast + ElevenLabs", "ElevenLabs Voice Isolator usuwa szumy, pogłos pomieszczenia i tło, zostawiając Twój głos, a potem mastering. Zużywa kredyty ElevenLabs."],
  ];
  return (
    <Section title="Ulepsz głos eksperta">
      <div>
        <p className="mb-1.5 text-[11.5px] text-studio-muted">Siła efektu</p>
        <Seg<Strength>
          value={strength}
          onChange={(v) => {
            setStrength(v);
            if (mode !== "original") void applyMode(mode, v);
          }}
          options={[["natural", "Naturalna"], ["podcast", "Podcast"], ["radio", "Radio"]]}
        />
      </div>
      <div className="space-y-1.5">
        {options.map(([m, label, desc]) => (
          <button
            key={m}
            type="button"
            disabled={!!busy || (m === "isolator" && !meta.elevenLabs)}
            onClick={() => applyMode(m)}
            className={cn("w-full rounded-lg border px-3 py-2 text-left transition disabled:opacity-50", mode === m ? "border-white/60 bg-studio-3" : "border-studio-line hover:bg-studio-3")}
            data-testid={`enhance-${m}`}
          >
            <span className="flex items-center gap-2 text-[12.5px] font-medium">
              {busy === m ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className={cn("h-3 w-3 rounded-full border", mode === m ? "border-white bg-white" : "border-studio-muted")} />}
              {label}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-studio-muted">{desc}</span>
          </button>
        ))}
      </div>
      {busy ? <p className="text-[11.5px] text-studio-muted">Przetwarzanie dźwięku… dłuższe nagrania mogą potrwać do minuty.</p> : null}
      {!busy && mode !== "original" && firstAudio ? (
        <p className="text-[11.5px] text-emerald-300">Aktywny ulepszony dźwięk — porównaj, przełączając na „Oryginał” podczas odtwarzania.</p>
      ) : null}
      {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
      <p className="text-[11.5px] text-studio-muted">Ulepszony dźwięk ma identyczny czas trwania — cięcia, pauzy i napisy zostają bez zmian. Oryginał jest zawsze zachowany; możesz wrócić jednym kliknięciem. Zmiana obejmuje podgląd i eksport.</p>
    </Section>
  );
}
