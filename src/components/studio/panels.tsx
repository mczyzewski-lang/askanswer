"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDot, Combine, ImagePlus, Loader2, Music2, Plus, RefreshCw, Scissors, Sparkles, Split, Square, Trash2, Undo2, X } from "lucide-react";
import type { AudioClip, EditorDocument, Overlay, TextOverlay } from "@/lib/editor/types";
import {
  applyAcceptedPauses,
  applyPause,
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
import { useStudio } from "./store";
import { Row, Section, Seg, Select, SButton, Slider, TextField } from "./controls";
import type { PlaybackEngine } from "./playback";
import { VoicePicker } from "@/components/voice-picker";

export interface StudioMeta {
  compositionId: string;
  project: { id: string; name: string; themeId: string | null; voiceId: string };
  question: { id: string; text: string } | null;
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
          <SButton variant="primary" onClick={() => apply((d) => ({ ...d, overlays: [questionOverlay(d.meta.questionText, 0, null), ...d.overlays] }))}>
            <Plus /> Dodaj warstwę pytania
          </SButton>
        )}
        <p className="text-[11.5px] text-studio-muted">Pytanie to edytowalna warstwa tekstowa — nigdy nie jest wypalane w oryginalnym nagraniu.</p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recordings / takes
// ---------------------------------------------------------------------------
export function TakesPanel({ meta, onReplaceTake }: { meta: StudioMeta; onReplaceTake: (takeId: string) => void }) {
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const apply = useStudio((s) => s.apply);
  const main = doc.clips[0] ? assets[doc.clips[0].assetId] : null;
  return (
    <div>
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
        {meta.elevenLabs ? (
          <>
            <VoicePicker dark value={voice} onChange={setVoice} previewText={meta.question?.text} />
            <SButton
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onRegenerate(voice);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {doc.narration.length ? "Wygeneruj ponownie" : "Wygeneruj lektora"}
            </SButton>
          </>
        ) : null}
        <p className="text-[11.5px] text-studio-muted">Głos lektora to osobny plik audio — nigdy nie jest nagrywany przez mikrofon telefonu.</p>
      </Section>
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

export function GraphicsPanel({ onUploadImage, meta }: { onUploadImage: (f: File) => Promise<string | null>; meta: StudioMeta }) {
  const time = useStudio((s) => s.time);
  const doc = useStudio((s) => s.doc)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const add = (o: Overlay) => {
    useStudio.getState().apply((d) => ({ ...d, overlays: [...d.overlays, o] }));
    useStudio.getState().select({ kind: "overlay", ids: [o.id] });
  };
  const items: Array<[string, () => Overlay]> = [
    ["Prostokąt", () => ({ ...baseOverlay("Prostokąt", time), kind: "rect", x: 0.2, y: 0.4, w: 0.6, h: 0.12, fill: "$primary", stroke: null, strokeWidth: 0, radius: 24 })],
    ["Elipsa", () => ({ ...baseOverlay("Elipsa", time), kind: "ellipse", x: 0.35, y: 0.4, w: 0.3, h: 0.17, fill: null, stroke: "$accent", strokeWidth: 8, radius: 0 })],
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
        <SButton onClick={() => fileRef.current?.click()}>
          <ImagePlus /> Wgraj obraz
        </SButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const id = await onUploadImage(f);
            if (id) add({ ...baseOverlay(f.name, time), kind: "image", assetId: id, fit: "contain", x: 0.2, y: 0.35, w: 0.6, h: 0.2 });
          }}
        />
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
