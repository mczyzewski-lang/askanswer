"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorDocument, ImageOverlay, Overlay } from "@/lib/editor/types";
import { overlayEnd, docDuration } from "@/lib/editor/timeline";
import { cachedSegments, layoutSubtitle, overlayRect, type Rect } from "@/lib/render/compositor";
import { segmentAt } from "@/lib/editor/timeline";
import { useStudio } from "./store";
import type { PlaybackEngine } from "./playback";

/** Approximate platform UI zones (normalized), shown only in the editor — never exported. */
export const SAFE_ZONES: Record<string, { label: string; zones: Array<[number, number, number, number]> }> = {
  tiktok: { label: "TikTok", zones: [[0, 0, 1, 0.075], [0, 0.8, 1, 0.2], [0.865, 0.36, 0.135, 0.44]] },
  reels: { label: "Instagram Reels", zones: [[0, 0, 1, 0.1], [0, 0.78, 1, 0.22], [0.87, 0.46, 0.13, 0.32]] },
  shorts: { label: "YouTube Shorts", zones: [[0, 0, 1, 0.085], [0, 0.79, 1, 0.21], [0.86, 0.47, 0.14, 0.32]] },
};

type Drag =
  | { mode: "move"; ids: string[]; startX: number; startY: number; orig: Map<string, { x: number; y: number }> }
  | { mode: "resize"; id: string; handle: "nw" | "ne" | "sw" | "se" | "e" | "w"; startX: number; startY: number; orig: Overlay; rect: Rect }
  | { mode: "subs"; startY: number; origY: number }
  | { mode: "bubble"; id: string; startX: number; startY: number; orig: { x: number; y: number } }
  | { mode: "bubbleSize"; id: string };

/** Image layers showing the expert's face bubble at this moment (topmost first). */
function bubblesAt(doc: EditorDocument, t: number) {
  return visibleAt(doc, t)
    .filter((o): o is ImageOverlay => o.kind === "image" && !!o.bubble)
    .reverse();
}

function visibleAt(doc: EditorDocument, t: number) {
  const dur = docDuration(doc);
  return doc.overlays.filter((o) => !o.hidden && t >= o.start && t < overlayEnd(o, dur));
}

export function Preview({ engine }: { engine: PlaybackEngine | null }) {
  const doc = useStudio((s) => s.doc)!;
  const time = useStudio((s) => s.time);
  const selection = useStudio((s) => s.selection);
  const clean = useStudio((s) => s.cleanPreview);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const drag = useRef<Drag | null>(null);

  // fit the canvas into the available area keeping the composition aspect ratio
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const ar = doc.width / doc.height;
      let h = r.height - 8;
      let w = h * ar;
      if (w > r.width - 8) {
        w = r.width - 8;
        h = w / ar;
      }
      setBox({ w: Math.max(100, w), h: Math.max(100, h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height]);

  useEffect(() => {
    if (!engine) return;
    engine.canvas = canvasRef.current;
    engine.invalidate();
  }, [engine]);

  const scale = box.w / doc.width;
  const ctx = () => canvasRef.current?.getContext("2d") ?? null;
  const toDoc = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const selIds = selection?.kind === "overlay" ? selection.ids : [];
  const c = ctx();
  const selRects: Array<{ o: Overlay; r: Rect }> = c ? doc.overlays.filter((o) => selIds.includes(o.id)).map((o) => ({ o, r: overlayRect(c, doc, o) })) : [];
  let subRect: Rect | null = null;
  if (c && doc.subtitles.enabled) {
    const seg = segmentAt(cachedSegments(doc), time);
    if (seg) {
      const L = layoutSubtitle(c, doc, seg);
      subRect = { x: L.blockRect.x - 20, y: L.blockRect.y - 12, w: L.blockRect.w + 40, h: L.blockRect.h + 24 };
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const cx = ctx();
    if (!cx || e.button !== 0) return;
    const p = toDoc(e);
    const st = useStudio.getState();
    // the face bubble sits on top of its image: grab it first
    const bub = bubblesAt(doc, time).find((o) => Math.hypot(p.x - o.bubble!.x * doc.width, p.y - o.bubble!.y * doc.height) <= (o.bubble!.size * doc.width) / 2);
    if (bub) {
      st.select({ kind: "overlay", ids: [bub.id] });
      st.beginGesture();
      drag.current = { mode: "bubble", id: bub.id, startX: p.x, startY: p.y, orig: { x: bub.bubble!.x, y: bub.bubble!.y } };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const vis = visibleAt(doc, time).reverse();
    const hit = vis.find((o) => {
      const r = overlayRect(cx, doc, o);
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + Math.max(r.h, 20);
    });
    if (hit) {
      let ids = selIds.includes(hit.id) ? selIds : [hit.id];
      if (e.shiftKey) ids = selIds.includes(hit.id) ? selIds.filter((x) => x !== hit.id) : [...selIds, hit.id];
      st.select({ kind: "overlay", ids });
      st.beginGesture();
      drag.current = { mode: "move", ids, startX: p.x, startY: p.y, orig: new Map(doc.overlays.filter((o) => ids.includes(o.id)).map((o) => [o.id, { x: o.x, y: o.y }])) };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (subRect && p.x >= subRect.x && p.x <= subRect.x + subRect.w && p.y >= subRect.y && p.y <= subRect.y + subRect.h) {
      st.select({ kind: "subtitles" });
      st.beginGesture();
      drag.current = { mode: "subs", startY: p.y, origY: doc.subtitles.style.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    st.select(null);
  };

  const startResize = (e: React.PointerEvent, o: Overlay, r: Rect, handle: "nw" | "ne" | "sw" | "se" | "e" | "w") => {
    e.stopPropagation();
    const p = toDoc(e);
    useStudio.getState().beginGesture();
    drag.current = { mode: "resize", id: o.id, handle, startX: p.x, startY: p.y, orig: o, rect: r };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toDoc(e);
    const W = doc.width;
    const H = doc.height;
    const st = useStudio.getState();
    if (d.mode === "bubble" || d.mode === "bubbleSize") {
      st.updateGesture((base) => ({
        ...base,
        overlays: base.overlays.map((o) => {
          if (o.id !== d.id || o.kind !== "image" || !o.bubble) return o;
          const b = o.bubble;
          if (d.mode === "bubble") {
            const half = b.size / 2;
            const x = Math.min(1 - half, Math.max(half, d.orig.x + (p.x - d.startX) / W));
            const y = Math.min(1 - (half * W) / H, Math.max((half * W) / H, d.orig.y + (p.y - d.startY) / H));
            return { ...o, bubble: { ...b, x, y } };
          }
          // diameter from the distance between the centre and the pointer
          const size = Math.min(0.9, Math.max(0.1, (2 * Math.hypot(p.x - b.x * W, p.y - b.y * H)) / Math.SQRT2 / W));
          return { ...o, bubble: { ...b, size } };
        }),
      }));
    } else if (d.mode === "move") {
      let dx = (p.x - d.startX) / W;
      let dy = (p.y - d.startY) / H;
      const v: number[] = [];
      const h: number[] = [];
      const cx = ctx();
      if (d.ids.length === 1 && cx && !e.altKey) {
        // snapping: canvas centre and side margins
        const o = doc.overlays.find((x) => x.id === d.ids[0])!;
        const orig = d.orig.get(o.id)!;
        const r = overlayRect(cx, doc, o);
        const nx = (orig.x + dx) * W;
        const ny = (orig.y + dy) * H;
        const th = 14;
        const snapsX: Array<[number, number]> = [
          [nx + r.w / 2, W / 2],
          [nx, W * 0.05],
          [nx + r.w, W * 0.95],
        ];
        for (const [cur, target] of snapsX) {
          if (Math.abs(cur - target) < th) {
            dx += (target - cur) / W;
            v.push(target);
            break;
          }
        }
        const snapsY: Array<[number, number]> = [
          [ny + r.h / 2, H / 2],
          [ny, H * 0.085],
          [ny + r.h, H * 0.79],
        ];
        for (const [cur, target] of snapsY) {
          if (Math.abs(cur - target) < th) {
            dy += (target - cur) / H;
            h.push(target);
            break;
          }
        }
      }
      setGuides({ v, h });
      st.updateGesture((base) => ({
        ...base,
        overlays: base.overlays.map((o) => {
          const orig = d.orig.get(o.id);
          return orig ? { ...o, x: orig.x + dx, y: orig.y + dy } : o;
        }),
      }));
    } else if (d.mode === "subs") {
      let y = Math.min(0.95, Math.max(0.05, d.origY + (p.y - d.startY) / H));
      const v: number[] = [];
      const hh: number[] = [];
      if (Math.abs(y - 0.5) < 0.008) {
        y = 0.5;
        hh.push(H / 2);
      }
      setGuides({ v, h: hh });
      st.updateGesture((base) => ({ ...base, subtitles: { ...base.subtitles, style: { ...base.subtitles.style, y } } }));
    } else if (d.mode === "resize") {
      const o = d.orig;
      const dxp = p.x - d.startX;
      const dyp = p.y - d.startY;
      const left = d.handle === "nw" || d.handle === "sw" || d.handle === "w";
      const top = d.handle === "nw" || d.handle === "ne";
      const newW = Math.max(40, d.rect.w + (left ? -dxp : dxp));
      const k = newW / d.rect.w;
      st.updateGesture((base) => ({
        ...base,
        overlays: base.overlays.map((x) => {
          if (x.id !== o.id) return x;
          const nx = left ? (d.rect.x + d.rect.w - newW) / W : x.x;
          if (x.kind === "text" && o.kind === "text") {
            if (d.handle === "e" || d.handle === "w") return { ...x, x: nx, w: newW / W };
            // corner handles scale the text block uniformly
            const ny = top ? (d.rect.y + d.rect.h - d.rect.h * k) / H : x.y;
            return { ...x, x: nx, y: ny, w: newW / W, style: { ...o.style, fontSize: Math.max(10, o.style.fontSize * k), padding: o.style.padding * k, radius: o.style.radius * k } };
          }
          const newH = d.handle === "e" || d.handle === "w" ? d.rect.h : Math.max(10, d.rect.h + (top ? -dyp : dyp));
          const ny = top ? (d.rect.y + d.rect.h - newH) / H : x.y;
          return { ...x, x: nx, y: ny, w: newW / W, h: newH / H };
        }),
      }));
    }
    engine?.invalidate();
  };

  const onPointerUp = () => {
    if (drag.current) useStudio.getState().endGesture();
    drag.current = null;
    setGuides({ v: [], h: [] });
  };

  const safe = doc.meta.showSafeArea && doc.meta.showSafeArea !== "none" ? SAFE_ZONES[doc.meta.showSafeArea] : null;

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center">
      <div className="relative shadow-[0_20px_60px_rgba(0,0,0,.5)]" style={{ width: box.w, height: box.h }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full rounded-[6px] bg-black" style={{ width: box.w, height: box.h }} />
        <div
          className="absolute inset-0 touch-none"
          onPointerDown={clean ? undefined : onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => {
            const el = document.getElementById("prop-text");
            if (el) (el as HTMLTextAreaElement).focus();
          }}
          data-testid="preview-surface"
        >
          {!clean && safe ? (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
              {safe.zones.map(([x, y, w, h], i) => (
                <rect key={i} x={x} y={y} width={w} height={h} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.45)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          ) : null}
          {!clean && safe ? <span className="pointer-events-none absolute bottom-1.5 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white/70">Przerywane pola: strefy przycisków {safe.label} — tylko w edytorze</span> : null}
          {!clean
            ? selRects.map(({ o, r }) => (
                <div key={o.id} className="pointer-events-none absolute border border-sky-400" style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: Math.max(r.h, 8) * scale }}>
                  {selRects.length === 1
                    ? (["nw", "ne", "sw", "se", "e", "w"] as const).map((hd) => (
                        <span
                          key={hd}
                          onPointerDown={(e) => startResize(e, o, r, hd)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          className="pointer-events-auto absolute h-2.5 w-2.5 rounded-[2px] border border-sky-500 bg-white"
                          style={{
                            left: hd.includes("w") ? -5 : hd.includes("e") ? "calc(100% - 5px)" : undefined,
                            top: hd === "e" || hd === "w" ? "calc(50% - 5px)" : hd.includes("n") ? -5 : "calc(100% - 5px)",
                            cursor: hd === "e" || hd === "w" ? "ew-resize" : hd === "nw" || hd === "se" ? "nwse-resize" : "nesw-resize",
                          }}
                        />
                      ))
                    : null}
                </div>
              ))
            : null}
          {!clean
            ? bubblesAt(doc, time).map((o) => {
                // grab area over every visible face bubble: drag it anywhere on the frame
                const b = o.bubble!;
                const R = (b.size * doc.width * scale) / 2;
                return (
                  <div
                    key={`grab-${o.id}`}
                    className="absolute cursor-move rounded-full hover:ring-2 hover:ring-sky-400/70"
                    style={{ left: b.x * doc.width * scale - R, top: b.y * doc.height * scale - R, width: R * 2, height: R * 2 }}
                    title="Przeciągnij kółko w dowolne miejsce"
                    data-testid="bubble-grab"
                  />
                );
              })
            : null}
          {!clean
            ? selRects
                .filter(({ o }) => o.kind === "image" && !!o.bubble && visibleAt(doc, time).some((v) => v.id === o.id))
                .map(({ o }) => {
                  const b = (o as ImageOverlay).bubble!;
                  const R = (b.size * doc.width * scale) / 2;
                  const cx = b.x * doc.width * scale;
                  const cy = b.y * doc.height * scale;
                  return (
                    <div key={`bub-${o.id}`} className="pointer-events-none absolute rounded-full border-2 border-dashed border-sky-400" style={{ left: cx - R, top: cy - R, width: R * 2, height: R * 2 }} data-testid="bubble-outline">
                      <span
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          useStudio.getState().beginGesture();
                          drag.current = { mode: "bubbleSize", id: o.id };
                          (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        className="pointer-events-auto absolute h-3 w-3 cursor-nwse-resize rounded-full border border-sky-500 bg-white"
                        style={{ left: R + R * Math.SQRT1_2 - 6, top: R + R * Math.SQRT1_2 - 6 }}
                        data-testid="bubble-resize"
                        title="Przeciągnij, aby zmienić wielkość kółka"
                      />
                    </div>
                  );
                })
            : null}
          {!clean && selection?.kind === "subtitles" && subRect ? (
            <div className="pointer-events-none absolute border border-dashed border-sky-400" style={{ left: subRect.x * scale, top: subRect.y * scale, width: subRect.w * scale, height: subRect.h * scale }} />
          ) : null}
          {guides.v.map((x) => (
            <div key={`v${x}`} className="pointer-events-none absolute top-0 h-full w-px bg-fuchsia-500" style={{ left: x * scale }} />
          ))}
          {guides.h.map((y) => (
            <div key={`h${y}`} className="pointer-events-none absolute left-0 h-px w-full bg-fuchsia-500" style={{ top: y * scale }} />
          ))}
        </div>
      </div>
    </div>
  );
}
