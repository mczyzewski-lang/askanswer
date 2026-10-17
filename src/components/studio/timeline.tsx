"use client";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Captions, Film, Flag, ImagePlus, Loader2, Mic2, Music, Type, X, ZoomIn } from "lucide-react";
import type { AVClip, AudioClip, EditorDocument, Overlay, Waveform, ZoomEffect } from "@/lib/editor/types";
import { clipEnd, docDuration, endCardStart, formatTimecode, moveClip, overlayEnd, retimeSegment, shiftSegment, snapToFrame, sourceRangeToTimeline, trimClip, timedSegments } from "@/lib/editor/timeline";
import { cn } from "@/lib/utils";
import { useStudio } from "./store";
import type { PlaybackEngine } from "./playback";
import { createIllustrationAt, spokenContext } from "./ai-panel";

const LABEL_W = 128;
const RULER_H = 26;

type Part = "body" | "left" | "right";
type DragTarget =
  | { kind: "clip" | "narration" | "music" | "zoom" | "overlay"; id: string; part: Part }
  | { kind: "segment"; id: string; part: Part }
  | { kind: "range" }
  | { kind: "scrub" };

interface DragState {
  target: DragTarget;
  startX: number;
  startT: number;
  moved: boolean;
  orig: { start: number; end: number };
}

function lanes<T extends { start: number; end: number }>(items: T[]): Array<T & { lane: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const ends: number[] = [];
  return sorted.map((it) => {
    let lane = ends.findIndex((e) => e <= it.start + 1e-3);
    if (lane < 0) {
      lane = ends.length;
      ends.push(it.end);
    } else ends[lane] = it.end;
    return { ...it, lane };
  });
}

export function Timeline({ engine }: { engine: PlaybackEngine | null }) {
  const doc = useStudio((s) => s.doc)!;
  const time = useStudio((s) => s.time);
  const pps = useStudio((s) => s.pxPerSec);
  const selection = useStudio((s) => s.selection);
  const range = useStudio((s) => s.range);
  const assets = useStudio((s) => s.assets);
  const playing = useStudio((s) => s.playing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  // click on an empty spot of the graphics layer → own illustration at that moment
  const [newAt, setNewAt] = useState<{ t: number; x: number; y: number } | null>(null);
  const drawing = useMemo(() => (doc.meta.aiBroll ?? []).filter((i) => i.status === "generating" && (i.kind === "illustration" || i.kind === "infographic")), [doc.meta.aiBroll]);

  const duration = docDuration(doc);
  const contentW = Math.max((duration + 4) * pps, 400);
  const x = (t: number) => t * pps;

  const overlayItems = useMemo(() => lanes(doc.overlays.map((o) => ({ ...o, end: overlayEnd(o, duration) }))), [doc.overlays, duration]);
  const overlayLanes = Math.max(1, ...overlayItems.map((o) => o.lane + 1));
  const segs = useMemo(() => timedSegments(doc), [doc]);
  const zoomItems = useMemo(() => lanes(doc.zooms), [doc.zooms]);
  const zoomLanes = Math.max(1, ...zoomItems.map((z) => z.lane + 1));

  const ctaAt = endCardStart(doc);
  const rows = [
    ...(ctaAt != null ? [{ key: "cta", label: "Plansza CTA", icon: <Flag className="h-3.5 w-3.5" />, h: 28 }] : []),
    { key: "overlays", label: "Tekst i grafika", icon: <Type className="h-3.5 w-3.5" />, h: 10 + overlayLanes * 24 },
    { key: "subs", label: "Napisy", icon: <Captions className="h-3.5 w-3.5" />, h: 30 },
    { key: "zoom", label: "Zbliżenia", icon: <ZoomIn className="h-3.5 w-3.5" />, h: 8 + zoomLanes * 22 },
    { key: "video", label: "Wideo", icon: <Film className="h-3.5 w-3.5" />, h: 42 },
    { key: "audio", label: "Głos eksperta", icon: <AudioLines className="h-3.5 w-3.5" />, h: 64 },
    { key: "narr", label: "Lektor", icon: <Mic2 className="h-3.5 w-3.5" />, h: 32 },
    { key: "music", label: "Muzyka", icon: <Music className="h-3.5 w-3.5" />, h: 32 },
  ];
  const rowTop: Record<string, number> = {};
  let acc = RULER_H;
  for (const r of rows) {
    rowTop[r.key] = acc;
    acc += r.h;
  }
  const totalH = acc;

  // keep playhead in view while playing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const px = x(time);
    if (px > el.scrollLeft + el.clientWidth - 60 || px < el.scrollLeft) el.scrollLeft = Math.max(0, px - 80);
  });

  // ctrl/cmd + wheel zooms the timeline around the cursor
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const st = useStudio.getState();
      const rect = el.getBoundingClientRect();
      const tAtCursor = (e.clientX - rect.left + el.scrollLeft) / st.pxPerSec;
      const next = Math.min(600, Math.max(8, st.pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      st.setPxPerSec(next);
      requestAnimationFrame(() => (el.scrollLeft = tAtCursor * next - (e.clientX - rect.left)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const timeFromEvent = (e: { clientX: number }) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left + el.scrollLeft) / pps);
  };

  const seek = (t: number) => {
    const st = useStudio.getState();
    const tt = Math.min(snapToFrame(t, doc.fps), duration);
    st.setTime(tt);
    engine?.seek(tt);
  };

  const snap = (t: number, exclude?: string): number => {
    const pts = [0, time, duration];
    for (const c of doc.clips) if (c.id !== exclude) pts.push(c.start, clipEnd(c));
    for (const c of doc.narration) if (c.id !== exclude) pts.push(c.start, clipEnd(c));
    for (const z of doc.zooms) if (z.id !== exclude) pts.push(z.start, z.end);
    for (const s of segs) pts.push(s.t0);
    const th = 7 / pps;
    let best = t;
    let bd = th;
    for (const p of pts) {
      const d = Math.abs(p - t);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  const srcDuration = (assetId: string) => assets[assetId]?.durationSec ?? Number.POSITIVE_INFINITY;

  const begin = (e: React.PointerEvent, target: DragTarget, orig: { start: number; end: number }) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const st = useStudio.getState();
    const t = timeFromEvent(e);
    drag.current = { target, startX: e.clientX, startT: t, moved: false, orig };
    if (target.kind === "clip") st.select({ kind: "clip", id: target.id });
    else if (target.kind === "narration") st.select({ kind: "narration", id: target.id });
    else if (target.kind === "music") st.select({ kind: "music", id: target.id });
    else if (target.kind === "zoom") st.select({ kind: "zoom", id: target.id });
    else if (target.kind === "overlay") st.select({ kind: "overlay", ids: [target.id] });
    else if (target.kind === "segment") st.select({ kind: "subtitles", segId: target.id });
    if (target.kind !== "range" && target.kind !== "scrub") st.beginGesture();
    if (target.kind === "scrub") seek(t);
    scrollRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = timeFromEvent(e);
    if (Math.abs(e.clientX - d.startX) > 3) d.moved = true;
    if (!d.moved) return;
    const st = useStudio.getState();
    const dt = t - d.startT;
    const tg = d.target;
    if (tg.kind === "scrub") return seek(t);
    if (tg.kind === "range") {
      const a = Math.min(d.startT, t);
      const b = Math.max(d.startT, t);
      st.setRange({ a: snapToFrame(a, doc.fps), b: snapToFrame(Math.min(b, duration), doc.fps) });
      return;
    }
    if (tg.kind === "segment") {
      st.updateGesture((base) => {
        if (tg.part === "body") return shiftSegment(base, tg.id, dt);
        const seg = base.subtitles.segments.find((s) => s.id === tg.id);
        if (!seg || !seg.words.length) return base;
        const s0 = seg.words[0].start;
        const s1 = seg.words[seg.words.length - 1].end;
        return tg.part === "left" ? retimeSegment(base, tg.id, Math.min(s1 - 0.1, s0 + dt), s1) : retimeSegment(base, tg.id, s0, Math.max(s0 + 0.1, s1 + dt));
      });
    } else if (tg.part === "body") {
      const ns = snap(d.orig.start + dt, tg.id);
      st.updateGesture((base) => moveClip(base, tg.id, ns));
    } else if (tg.kind === "clip" || tg.kind === "narration" || tg.kind === "music") {
      const edgeT = snap((tg.part === "left" ? d.orig.start : d.orig.end) + dt, tg.id);
      st.updateGesture((base) => trimClip(base, tg.id, tg.part === "left" ? "start" : "end", edgeT, srcDuration));
    } else if (tg.kind === "zoom") {
      const edgeT = snap((tg.part === "left" ? d.orig.start : d.orig.end) + dt, tg.id);
      st.updateGesture((base) => ({
        ...base,
        zooms: base.zooms.map((z) => (z.id !== tg.id ? z : tg.part === "left" ? { ...z, start: Math.min(z.end - 0.2, Math.max(0, edgeT)) } : { ...z, end: Math.max(z.start + 0.2, edgeT) })),
      }));
    } else if (tg.kind === "overlay") {
      const edgeT = snap((tg.part === "left" ? d.orig.start : d.orig.end) + dt, tg.id);
      st.updateGesture((base) => ({
        ...base,
        overlays: base.overlays.map((o) =>
          o.id !== tg.id ? o : tg.part === "left" ? { ...o, start: Math.max(0, Math.min(edgeT, overlayEnd(o, duration) - 0.1)) } : { ...o, end: edgeT >= duration - 0.02 ? null : Math.max(o.start + 0.1, edgeT) },
        ),
      }));
    }
    engine?.invalidate();
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = useStudio.getState();
    if (d.target.kind === "range" && !d.moved) {
      st.setRange(null);
      seek(timeFromEvent(e));
      return;
    }
    if (d.target.kind !== "range" && d.target.kind !== "scrub") {
      st.endGesture();
      if (!d.moved && d.target.kind !== "clip") seek(timeFromEvent(e));
      if (!d.moved && d.target.kind === "clip") seek(timeFromEvent(e));
    }
  };

  const isSel = (kind: string, id: string) =>
    !!selection && ((selection.kind === "overlay" && kind === "overlay" && selection.ids.includes(id)) || ("id" in selection && selection.kind === kind && selection.id === id) || (selection.kind === "subtitles" && kind === "segment" && selection.segId === id));

  // ruler ticks
  const step = pps > 200 ? 0.5 : pps > 80 ? 1 : pps > 35 ? 2 : pps > 15 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 4; t += step) ticks.push(t);

  return (
    <div className="scroll-thin flex min-h-0 flex-1 select-none overflow-y-auto overflow-x-hidden" data-testid="timeline">
      {newAt ? <NewIllustration at={newAt} onClose={() => setNewAt(null)} /> : null}
      <div className="sticky left-0 shrink-0 border-r border-studio-line bg-studio-2" style={{ width: LABEL_W, height: totalH + 12 }}>
        <div style={{ height: RULER_H }} className="border-b border-studio-line" />
        {rows.map((r) => (
          <div key={r.key} style={{ height: r.h }} className="flex items-center gap-2 border-b border-studio-line/60 px-3 text-[11.5px] text-studio-muted">
            {r.icon}
            {r.label}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="scroll-thin relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden" style={{ height: totalH + 12 }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="relative" style={{ width: contentW, height: totalH }}>
          {/* ruler */}
          <div className="absolute left-0 top-0 cursor-ew-resize border-b border-studio-line bg-studio-2" style={{ width: contentW, height: RULER_H }} onPointerDown={(e) => begin(e, { kind: "scrub" }, { start: 0, end: 0 })} data-testid="ruler">
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-studio-line" style={{ left: x(t) }}>
                <span className="tabular absolute left-1 top-1 text-[10px] text-studio-muted">{`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}${step < 1 && t % 1 ? ".5" : ""}`}</span>
              </div>
            ))}
          </div>
          {/* row backgrounds */}
          {rows.map((r) =>
            r.key === "overlays" ? (
              <div
                key={r.key}
                className="group absolute left-0 cursor-copy border-b border-studio-line/60 hover:bg-teal-500/5"
                style={{ top: rowTop[r.key], height: r.h, width: contentW }}
                title="Kliknij, aby dodać tu własną ilustrację AI"
                data-testid="overlay-lane"
                onClick={(e) => {
                  if (drag.current?.moved) return;
                  const t = Math.min(timeFromEvent(e), Math.max(0, duration - 1));
                  setNewAt({ t, x: e.clientX, y: e.clientY });
                }}
              />
            ) : (
              <div key={r.key} className="absolute left-0 border-b border-studio-line/60" style={{ top: rowTop[r.key], height: r.h, width: contentW }} />
            ),
          )}
          {/* range selection */}
          {range ? <div className="pointer-events-none absolute z-[5] bg-sky-400/15 ring-1 ring-sky-400/60" style={{ left: x(range.a), width: Math.max(1, x(range.b - range.a)), top: RULER_H, height: totalH - RULER_H }} /> : null}

          {/* overlays */}
          {overlayItems.map((o) => (
            <Block
              key={o.id}
              left={x(o.start)}
              width={x(o.end - o.start)}
              top={rowTop.overlays + 5 + o.lane * 24}
              height={20}
              selected={isSel("overlay", o.id)}
              color={o.kind === "text" ? (o.role === "question" ? "bg-violet-500/80" : "bg-indigo-500/70") : o.kind === "video" ? "bg-rose-500/70" : "bg-teal-500/70"}
              label={overlayLabel(o)}
              onDown={(e, part) => begin(e, { kind: "overlay", id: o.id, part }, { start: o.start, end: o.end })}
            />
          ))}
          {/* illustrations being drawn */}
          {drawing.map((i) => (
            <div
              key={i.id}
              className="pointer-events-none absolute z-[2] flex items-center gap-1 overflow-hidden rounded-md border border-dashed border-teal-400/80 bg-teal-500/15 px-1.5 text-[10.5px] text-teal-100"
              style={{ left: x(i.start), width: Math.max(24, x(i.end - i.start)), top: rowTop.overlays + 5 + overlayLanes * 24 - 24, height: 20 }}
              data-testid="illustration-drawing"
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> <span className="truncate">Rysuję: {i.title}</span>
            </div>
          ))}
          {/* CTA end card: its own layer — after the video or over its last seconds */}
          {ctaAt != null && doc.endCard ? (
            <button
              className={cn(
                "absolute z-[2] flex items-center gap-1 overflow-hidden rounded-[5px] px-2 text-[10.5px] font-medium text-white/95 shadow-sm",
                doc.endCard.placement === "overlay" ? "bg-orange-500/60 ring-1 ring-inset ring-orange-300/70" : "bg-orange-500/85",
                selection?.kind === "endcard" && "ring-2 ring-white",
              )}
              style={{ left: x(ctaAt), width: Math.max(8, x(doc.endCard.seconds)), top: rowTop.cta + 4, height: 20 }}
              onPointerDown={(e) => {
                e.stopPropagation();
                useStudio.getState().select({ kind: "endcard" });
                seek(ctaAt + 0.5);
              }}
              title="Plansza CTA — kliknij, aby zmienić"
              data-testid="cta-layer"
            >
              <span className="truncate">CTA · {doc.endCard.url || doc.endCard.text} · {doc.endCard.placement === "overlay" ? "na wideo" : "po filmie"}</span>
            </button>
          ) : null}
          {/* subtitles */}
          {segs.map((s) => (
            <Block
              key={s.seg.id}
              left={x(s.t0)}
              width={x(Math.max(0.05, s.words[s.words.length - 1].t1 - s.t0))}
              top={rowTop.subs + 4}
              height={22}
              selected={isSel("segment", s.seg.id)}
              color={doc.subtitles.enabled ? "bg-amber-500/75" : "bg-amber-500/25"}
              label={s.words.map((w) => w.text).join(" ")}
              onDown={(e, part) => begin(e, { kind: "segment", id: s.seg.id, part }, { start: s.t0, end: s.t1 })}
            />
          ))}
          {/* zooms */}
          {zoomItems.map((z) => (
            <Block
              key={z.id}
              left={x(z.start)}
              width={x(z.end - z.start)}
              top={rowTop.zoom + 4 + z.lane * 22}
              height={18}
              selected={isSel("zoom", z.id)}
              color={z.suggested ? "bg-sky-500/25 ring-1 ring-dashed ring-sky-400" : "bg-sky-500/75"}
              label={`${zoomLabel(z)}${z.suggested ? " · propozycja" : ""}`}
              onDown={(e, part) => begin(e, { kind: "zoom", id: z.id, part }, { start: z.start, end: z.end })}
            />
          ))}
          {/* video */}
          {doc.clips.map((c) => (
            <Block
              key={c.id}
              left={x(c.start)}
              width={x(c.sourceOut - c.sourceIn)}
              top={rowTop.video + 4}
              height={34}
              selected={isSel("clip", c.id)}
              color="bg-[#3b4a6b]"
              label={`${c.label ?? "Klip"} · ${(c.sourceOut - c.sourceIn).toFixed(1)} s`}
              onDown={(e, part) => begin(e, { kind: "clip", id: c.id, part }, { start: c.start, end: clipEnd(c) })}
            />
          ))}
          {/* expert audio: real waveform per clip, linked to the video clips */}
          <div
            className="absolute left-0 cursor-crosshair"
            style={{ top: rowTop.audio, height: 64, width: contentW }}
            onPointerDown={(e) => begin(e, { kind: "range" }, { start: 0, end: 0 })}
            data-testid="audio-track"
          />
          {doc.clips.map((c) => (
            <WaveClip
              key={c.id}
              clip={c}
              left={x(c.start)}
              width={x(c.sourceOut - c.sourceIn)}
              top={rowTop.audio + 3}
              height={58}
              waveform={assets[c.assetId]?.waveform ?? null}
              selected={isSel("clip", c.id)}
            />
          ))}
          {/* pause suggestions */}
          {doc.pauses
            .filter((p) => p.status !== "applied" && p.status !== "rejected")
            .flatMap((p) => sourceRangeToTimeline(doc, p.assetId, p.start, p.end).map(([a, b], i) => ({ p, a, b, i })))
            .map(({ p, a, b, i }) => (
              <button
                key={`${p.id}-${i}`}
                title={`Pauza ${(p.end - p.start).toFixed(1)} s`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  useStudio.getState().select({ kind: "pause", id: p.id });
                  seek(Math.max(0, a - 0.5));
                }}
                className={cn(
                  "absolute z-[4] rounded-[3px] border",
                  p.status === "accepted" ? "border-red-400 bg-[repeating-linear-gradient(135deg,rgba(248,113,113,.45)_0_4px,rgba(248,113,113,.15)_4px_8px)]" : "border-orange-300/80 bg-orange-400/25",
                  isSel("pause", p.id) && "ring-2 ring-white",
                )}
                style={{ left: x(a), width: Math.max(3, x(b - a)), top: rowTop.audio + 2, height: 60 }}
                data-testid="pause-marker"
              />
            ))}
          {/* narration */}
          {doc.narration.map((c) => (
            <Block
              key={c.id}
              left={x(c.start)}
              width={x(c.sourceOut - c.sourceIn)}
              top={rowTop.narr + 4}
              height={24}
              selected={isSel("narration", c.id)}
              color={c.muted ? "bg-fuchsia-500/25" : "bg-fuchsia-500/70"}
              label={`${c.label ?? "Lektor"}${c.muted ? " (wyciszony)" : ""}`}
              onDown={(e, part) => begin(e, { kind: "narration", id: c.id, part }, { start: c.start, end: clipEnd(c) })}
            />
          ))}
          {/* music */}
          {doc.music.map((c) => (
            <Block
              key={c.id}
              left={x(c.start)}
              width={x(c.sourceOut - c.sourceIn)}
              top={rowTop.music + 4}
              height={24}
              selected={isSel("music", c.id)}
              color={c.muted ? "bg-emerald-500/25" : "bg-emerald-600/70"}
              label={c.label ?? "Muzyka"}
              onDown={(e, part) => begin(e, { kind: "music", id: c.id, part }, { start: c.start, end: clipEnd(c) })}
            />
          ))}
          {/* playhead */}
          <div className="pointer-events-none absolute top-0 z-10" style={{ left: x(time) - 0.5, height: totalH }}>
            <div className="h-full w-px bg-white" />
            <div className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b-[3px] bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

function overlayLabel(o: Overlay): string {
  if (o.kind === "text") return o.role === "question" ? `Pytanie: ${o.text}` : o.text || o.name;
  if (o.kind === "callout" || o.kind === "lowerThird") return `${o.name}: ${o.title}`;
  return o.name;
}

function zoomLabel(z: ZoomEffect): string {
  const p = (n: number) => `${Math.round(n * 100)}%`;
  return z.fromScale === z.toScale ? p(z.toScale) : `${p(z.fromScale)} → ${p(z.toScale)}`;
}

const Block = memo(function Block(props: {
  left: number;
  width: number;
  top: number;
  height: number;
  selected: boolean;
  color: string;
  label: string;
  onDown: (e: React.PointerEvent, part: Part) => void;
}) {
  const { left, width, top, height, selected, color, label, onDown } = props;
  return (
    <div
      className={cn("group absolute overflow-hidden rounded-[5px] text-[10.5px] font-medium text-white/95 shadow-sm", color, selected && "z-[3] ring-2 ring-white")}
      style={{ left, width: Math.max(4, width), top, height }}
      onPointerDown={(e) => onDown(e, "body")}
      title={label}
    >
      <span className="pointer-events-none absolute inset-y-0 left-2 right-2 flex items-center truncate whitespace-nowrap">{label}</span>
      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/40" onPointerDown={(e) => onDown(e, "left")} />
      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/40" onPointerDown={(e) => onDown(e, "right")} />
    </div>
  );
});

/** Draws the actual audio peaks of the clip's source range (computed server-side from the recording). */
const WaveClip = memo(function WaveClip({ clip, left, width, top, height, waveform, selected }: { clip: AVClip | AudioClip; left: number; width: number; top: number; height: number; waveform: Waveform | null; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const muted = clip.muted;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(8000, Math.round(width * dpr)));
    const h = Math.round(height * dpr);
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    if (!waveform || !waveform.peaks.length) {
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.font = `${11 * dpr}px Inter`;
      ctx.fillText(waveform ? "brak dźwięku" : "ładowanie fali…", 6 * dpr, h / 2);
      return;
    }
    const { rate, peaks } = waveform;
    const len = clip.sourceOut - clip.sourceIn;
    ctx.fillStyle = muted ? "rgba(255,255,255,.22)" : "rgba(110,231,183,.9)";
    const mid = h / 2;
    for (let px = 0; px < w; px++) {
      const s0 = clip.sourceIn + (px / w) * len;
      const s1 = clip.sourceIn + ((px + 1) / w) * len;
      const i0 = Math.floor(s0 * rate);
      const i1 = Math.max(i0 + 1, Math.ceil(s1 * rate));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const amp = Math.max(0.5, Math.sqrt(m) * (h / 2 - 2) * clip.volume);
      ctx.fillRect(px, mid - amp, 1, amp * 2);
    }
  }, [clip, width, height, waveform, muted]);
  return (
    <div className={cn("pointer-events-none absolute z-[2] overflow-hidden rounded-[5px] bg-emerald-900/35", selected && "ring-2 ring-white")} style={{ left, width: Math.max(2, width), top, height }}>
      <canvas ref={ref} style={{ width: Math.max(2, width), height }} />
      {muted ? <span className="absolute left-1.5 top-1 text-[10px] text-white/60">wyciszony (lektor)</span> : null}
    </div>
  );
});

export { formatTimecode };
export type { EditorDocument };

/**
 * Own illustration at a clicked moment: the user writes the idea; the passage said ±8 s around it is
 * shown and sent along, the theme colours / category style / text rules are added on the server.
 */
function NewIllustration({ at, onClose }: { at: { t: number; x: number; y: number }; onClose: () => void }) {
  const doc = useStudio((s) => s.doc)!;
  const ctx = useMemo(() => spokenContext(doc, at.t), [doc, at.t]);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const W = 340;
  const left = Math.max(8, Math.min(at.x - W / 2, (typeof window !== "undefined" ? window.innerWidth : 1200) - W - 8));
  const top = Math.max(8, at.y - 330);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    const e = await createIllustrationAt(at.t, idea.trim());
    setBusy(false);
    if (e) setErr(e);
    else onClose();
  };
  const mm = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className="fixed z-50 space-y-2 rounded-xl border border-studio-line bg-studio-2 p-3 text-studio-text shadow-2xl" style={{ left, top, width: W }} data-testid="new-illustration" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <ImagePlus className="h-4 w-4 text-teal-300" />
        <p className="flex-1 text-[12.5px] font-medium">Własna ilustracja w {mm(at.t)}</p>
        <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded p-0.5 text-studio-muted hover:text-studio-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rounded-lg bg-studio-3/60 px-2 py-1.5">
        <p className="mb-0.5 text-[10.5px] uppercase tracking-wide text-studio-muted">
          Ekspert mówi ({mm(ctx.from)}–{mm(ctx.to)})
        </p>
        <p className="max-h-28 overflow-y-auto text-[11.5px] leading-snug text-studio-muted" data-testid="new-illustration-context">
          {ctx.passage ? `„${ctx.passage}”` : "Brak napisów w tym miejscu — wygeneruj transkrypcję, żeby AI znało kontekst."}
        </p>
      </div>
      <textarea
        autoFocus
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={3}
        placeholder="Twój pomysł, np. labirynt z jednym podświetlonym wyjściem, strzałka „wąskie gardło”"
        aria-label="Pomysł na ilustrację"
        className="w-full resize-y rounded-lg border border-studio-line bg-studio-3 px-2 py-1.5 text-[12px] text-studio-text outline-none focus:border-white/30"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && idea.trim().length >= 5) void submit();
          if (e.key === "Escape") onClose();
        }}
      />
      <p className="text-[10.5px] leading-snug text-studio-muted">Kolory motywu, styl kategorii i zasady tekstu (krótki nagłówek, strzałki z podpisami) dodam sam. Powstaną warianty do wyboru w zakładce AI.</p>
      {err ? <p className="text-[11.5px] text-red-300">{err}</p> : null}
      <button
        type="button"
        disabled={busy || idea.trim().length < 5}
        onClick={() => void submit()}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-[12.5px] font-medium text-black hover:bg-teal-400 disabled:opacity-50"
        data-testid="new-illustration-submit"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Narysuj ilustrację
      </button>
    </div>
  );
}
