"use client";
/**
 * Browser playback engine for the Studio preview.
 * A wall clock drives timeline time; <video>/<audio> elements are slaved to it
 * (re-synced on drift) and every frame is drawn with the shared compositor,
 * so what you see here is what the server renderer produces.
 */
import type { AssetInfo, AudioClip, EditorDocument } from "@/lib/editor/types";
import { inflateSync } from "fflate";
import { maskFrameIndex, maskToRgba, parseMaskHeader, type MaskHeader } from "@/lib/render/mask-format";

interface MaskEntry {
  url: string;
  state: "loading" | "ready" | "error";
  h?: MaskHeader;
  buf?: Uint8Array;
  canvas?: HTMLCanvasElement;
  gray?: Uint8Array;
  img?: ImageData;
  index: number;
  fallback?: MaskEntry;
}

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
import { clipAt, clipEnd, docDuration, overlayEnd, sortedClips } from "@/lib/editor/timeline";
import { drawFrame, overlayVideoTime, type FrameSource } from "@/lib/render/compositor";
import type { VideoOverlay } from "@/lib/editor/types";

const DRIFT = 0.25;

let h264: boolean | null = null;
/** Use the H.264 master when the browser can decode it, otherwise the WebM preview proxy. */
export function playableUrl(a: AssetInfo): string {
  if (h264 === null) h264 = typeof document !== "undefined" && document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== "";
  return !h264 && a.proxyUrl ? a.proxyUrl : a.url;
}

export class PlaybackEngine {
  private container: HTMLDivElement;
  private videos = new Map<string, HTMLVideoElement[]>(); // per asset, 2 elements
  private assignment = new Map<HTMLVideoElement, string>(); // element -> clip id
  private audios = new Map<string, HTMLAudioElement>(); // per audio clip id
  private images = new Map<string, HTMLImageElement>();
  private masks = new Map<string, MaskEntry>();
  /** media time of the frame each video element currently shows (requestVideoFrameCallback) */
  private presented = new WeakMap<HTMLVideoElement, number>();
  private scratchCanvases = new Map<string, HTMLCanvasElement>();
  private overlayVideos = new Map<string, HTMLVideoElement>(); // per video overlay id
  private raf = 0;
  private playing = false;
  private startWall = 0;
  private startT = 0;
  private needsDraw = true;
  doc: EditorDocument | null = null;
  assets: Record<string, AssetInfo> = {};
  canvas: HTMLCanvasElement | null = null;
  onTime: (t: number) => void = () => {};
  onEnded: () => void = () => {};
  time = 0;
  includeSuggested = true;
  hideOverlayIds = new Set<string>();

  constructor() {
    this.container = document.createElement("div");
    this.container.setAttribute("aria-hidden", "true");
    Object.assign(this.container.style, { position: "fixed", width: "2px", height: "2px", overflow: "hidden", opacity: "0", pointerEvents: "none", left: "0", top: "0" });
    document.body.appendChild(this.container);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Keep video-overlay elements in sync with the timeline (seek on drift, play/pause with the transport). */
  private syncOverlayVideos(t: number, force: boolean) {
    const doc = this.doc;
    if (!doc) return;
    const dur = docDuration(doc);
    const live = new Set<string>();
    for (const o of doc.overlays) {
      if (o.kind !== "video") continue;
      live.add(o.id);
      const asset = this.assets[o.assetId];
      if (!asset) continue;
      let v = this.overlayVideos.get(o.id);
      if (!v) {
        v = document.createElement("video");
        v.preload = "auto";
        v.playsInline = true;
        v.src = playableUrl(asset);
        v.addEventListener("seeked", () => this.invalidate());
        v.addEventListener("loadeddata", () => this.invalidate());
        this.container.appendChild(v);
        this.overlayVideos.set(o.id, v);
      }
      const visible = !o.hidden && t >= o.start && t < overlayEnd(o, dur);
      const local = overlayVideoTime(o, t, asset.durationSec);
      v.muted = o.volume <= 0;
      v.volume = Math.max(0, Math.min(1, o.volume));
      if (!visible) {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - local) > 0.05 && !v.seeking) v.currentTime = local;
        continue;
      }
      if (force || Math.abs(v.currentTime - local) > (this.playing ? DRIFT : 0.02)) {
        if (!v.seeking || force) v.currentTime = local;
      }
      if (this.playing && v.paused) void v.play().catch(() => {});
      if (!this.playing && !v.paused) v.pause();
    }
    for (const [id, v] of this.overlayVideos) {
      if (!live.has(id)) {
        v.pause();
        v.remove();
        this.overlayVideos.delete(id);
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const list of this.videos.values()) for (const v of list) v.pause();
    for (const v of this.overlayVideos.values()) v.pause();
    for (const a of this.audios.values()) a.pause();
    this.container.remove();
  }

  invalidate() {
    this.needsDraw = true;
  }

  private videoEls(assetId: string): HTMLVideoElement[] {
    let list = this.videos.get(assetId);
    if (!list) {
      const a = this.assets[assetId];
      list = [0, 1].map(() => {
        const v = document.createElement("video");
        v.preload = "auto";
        v.playsInline = true;
        if (a) v.src = playableUrl(a);
        v.addEventListener("seeked", () => this.invalidate());
        v.addEventListener("loadeddata", () => this.invalidate());
        // which source frame is on screen right now (for the blur mask)
        const fv = v as FrameCallbackVideo;
        if (fv.requestVideoFrameCallback) {
          const onFrame = (_: number, meta: { mediaTime: number }) => {
            this.presented.set(v, meta.mediaTime);
            fv.requestVideoFrameCallback!(onFrame);
          };
          fv.requestVideoFrameCallback(onFrame);
        }
        this.container.appendChild(v);
        return v;
      });
      this.videos.set(assetId, list);
    }
    return list;
  }

  private image(assetId: string): HTMLImageElement | null {
    let img = this.images.get(assetId);
    if (!img) {
      const a = this.assets[assetId];
      if (!a) return null;
      img = new Image();
      img.onload = () => this.invalidate();
      img.src = a.url;
      this.images.set(assetId, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  /**
   * Person mask (background blur) at a source time. The compressed AMSK file is loaded once and
   * each frame is inflated synchronously when shown (~1 ms), so the mask is always the exact frame
   * of the picture — never a late one that would make the edge jump.
   */
  private mask(assetId: string, sourceTime: number): FrameSource | null {
    const a = this.assets[assetId];
    if (!a?.maskUrl) return null;
    let m = this.masks.get(assetId);
    if (!m || m.url !== a.maskUrl) {
      const entry: MaskEntry = { url: a.maskUrl, state: "loading", index: -1 };
      // keep showing the previous mask while a better one loads
      if (m?.state === "ready") entry.fallback = m;
      m = entry;
      this.masks.set(assetId, m);
      void (async () => {
        try {
          const buf = new Uint8Array(await (await fetch(entry.url)).arrayBuffer());
          const h = parseMaskHeader(buf);
          const canvas = document.createElement("canvas");
          canvas.width = h.width;
          canvas.height = h.height;
          Object.assign(entry, { h, buf, canvas, state: "ready", fallback: undefined });
          this.invalidate();
        } catch {
          entry.state = "error";
        }
      })();
    }
    if (m.state !== "ready" && m.fallback) m = m.fallback;
    if (m.state !== "ready" || !m.h || !m.buf || !m.canvas) return null;
    const h = m.h;
    const i = maskFrameIndex(h, sourceTime);
    if (i !== m.index) {
      const gray = inflateSync(m.buf.subarray(h.dataStart + h.offsets[i], h.dataStart + h.offsets[i + 1]), { out: (m.gray ??= new Uint8Array(h.width * h.height)) });
      const ctx = m.canvas.getContext("2d")!;
      m.img ??= ctx.createImageData(h.width, h.height);
      maskToRgba(gray, m.img.data);
      ctx.putImageData(m.img, 0, 0);
      m.index = i;
    }
    return { image: m.canvas, width: h.width, height: h.height };
  }

  private scratch(key: string, w: number, h: number) {
    let c = this.scratchCanvases.get(key);
    if (!c) {
      c = document.createElement("canvas");
      this.scratchCanvases.set(key, c);
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return { canvas: c, ctx: c.getContext("2d")! };
  }

  /** Element bound to a clip, binding a free one (and seeking it) if needed. */
  private elementFor(clipId: string, assetId: string, src: number, reserve?: string): HTMLVideoElement {
    const list = this.videoEls(assetId);
    let el = list.find((v) => this.assignment.get(v) === clipId);
    if (!el) {
      el = list.find((v) => this.assignment.get(v) !== reserve) ?? list[0];
      this.assignment.set(el, clipId);
      if (Math.abs(el.currentTime - src) > 0.01) el.currentTime = src;
    }
    return el;
  }

  play() {
    if (!this.doc) return;
    const dur = docDuration(this.doc);
    if (this.time >= dur - 0.05) this.time = 0;
    this.playing = true;
    this.startWall = performance.now();
    this.startT = this.time;
  }

  pause() {
    this.playing = false;
    for (const list of this.videos.values()) for (const v of list) v.pause();
    for (const v of this.overlayVideos.values()) v.pause();
    for (const a of this.audios.values()) a.pause();
    this.invalidate();
  }

  seek(t: number) {
    this.time = Math.max(0, t);
    if (this.playing) {
      this.startWall = performance.now();
      this.startT = this.time;
    }
    this.syncMedia(true);
    this.invalidate();
  }

  isPlaying() {
    return this.playing;
  }

  private syncMedia(force = false) {
    const doc = this.doc;
    if (!doc) return;
    const t = this.time;
    const clip = clipAt(doc, t);
    const ordered = sortedClips(doc);
    const next = clip ? ordered.find((c) => c.start >= clipEnd(clip) - 1e-3 && c.id !== clip.id) : ordered.find((c) => c.start > t);
    const used = new Set<HTMLVideoElement>();
    if (clip) {
      const src = clip.sourceIn + (t - clip.start);
      const el = this.elementFor(clip.id, clip.assetId, src, next?.assetId === clip.assetId ? next.id : undefined);
      used.add(el);
      // enhanced voice: the video element is muted and a synced <audio> plays the replacement track
      el.muted = clip.muted || !!clip.audioAssetId;
      el.volume = Math.max(0, Math.min(1, clip.volume));
      if (force || Math.abs(el.currentTime - src) > (this.playing ? DRIFT : 0.02)) {
        if (!el.seeking || force) el.currentTime = src;
      }
      if (this.playing && el.paused) void el.play().catch(() => {});
      if (!this.playing && !el.paused) el.pause();
      // pre-roll the next clip on the spare element so cuts are seamless
      if (next && next.assetId === clip.assetId) {
        const spare = this.elementFor(next.id, next.assetId, next.sourceIn, clip.id);
        if (spare !== el) {
          used.add(spare);
          if (!spare.paused) spare.pause();
          if (Math.abs(spare.currentTime - next.sourceIn) > 0.05 && !spare.seeking) spare.currentTime = next.sourceIn;
        }
      }
    } else if (next) {
      const spare = this.elementFor(next.id, next.assetId, next.sourceIn);
      used.add(spare);
      if (!spare.paused) spare.pause();
    }
    for (const list of this.videos.values()) for (const v of list) if (!used.has(v) && !v.paused) v.pause();
    this.syncLinkedAudio(clip, t, force);
    for (const c of [...doc.narration, ...doc.music]) this.syncAudio(c, t, force);
    this.syncOverlayVideos(t, force);
    // clean up audio elements for removed clips
    const ids = new Set([...doc.narration, ...doc.music].map((c) => c.id));
    for (const [id, a] of this.audios) {
      if (!ids.has(id) && !id.startsWith("av:")) {
        a.pause();
        a.remove();
        this.audios.delete(id);
      }
    }
  }

  /** Replacement audio (e.g. enhanced voice) for the active AV clip, kept in sync with the video's source time. */
  private syncLinkedAudio(clip: ReturnType<typeof clipAt>, t: number, force: boolean) {
    const activeKey = clip?.audioAssetId ? `av:${clip.audioAssetId}` : null;
    for (const [key, a] of this.audios) if (key.startsWith("av:") && key !== activeKey && !a.paused) a.pause();
    if (!clip || !clip.audioAssetId || !activeKey) return;
    const asset = this.assets[clip.audioAssetId];
    if (!asset) return;
    let a = this.audios.get(activeKey);
    if (!a) {
      a = document.createElement("audio");
      a.preload = "auto";
      a.src = asset.url;
      this.container.appendChild(a);
      this.audios.set(activeKey, a);
    }
    if (clip.muted || !this.playing) {
      if (!a.paused) a.pause();
      return;
    }
    a.volume = Math.max(0, Math.min(1, clip.volume));
    const src = clip.sourceIn + (t - clip.start);
    if (force || Math.abs(a.currentTime - src) > DRIFT) a.currentTime = src;
    if (a.paused) void a.play().catch(() => {});
  }

  private syncAudio(c: AudioClip, t: number, force: boolean) {
    let a = this.audios.get(c.id);
    const asset = this.assets[c.assetId];
    if (!asset) return;
    if (!a) {
      a = document.createElement("audio");
      a.preload = "auto";
      a.src = asset.url;
      this.container.appendChild(a);
      this.audios.set(c.id, a);
    }
    if (a.src !== asset.url && !a.src.endsWith(asset.url)) a.src = asset.url;
    const inside = t >= c.start && t < clipEnd(c);
    if (!inside || c.muted || !this.playing) {
      if (!a.paused) a.pause();
      return;
    }
    const local = t - c.start;
    const len = c.sourceOut - c.sourceIn;
    let gain = c.volume;
    if (c.fadeIn > 0 && local < c.fadeIn) gain *= local / c.fadeIn;
    if (c.fadeOut > 0 && len - local < c.fadeOut) gain *= Math.max(0, (len - local) / c.fadeOut);
    a.volume = Math.max(0, Math.min(1, gain));
    const src = c.sourceIn + local;
    if (force || Math.abs(a.currentTime - src) > DRIFT) a.currentTime = src;
    if (a.paused) void a.play().catch(() => {});
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const doc = this.doc;
    if (!doc || !this.canvas) return;
    if (this.playing) {
      const dur = docDuration(doc);
      this.time = this.startT + (now - this.startWall) / 1000;
      if (this.time >= dur) {
        this.time = dur;
        this.pause();
        this.onEnded();
      }
      this.syncMedia();
      this.onTime(this.time);
      this.needsDraw = true;
    }
    if (!this.needsDraw) return;
    this.needsDraw = false;
    this.draw();
  }

  draw() {
    const doc = this.doc;
    const canvas = this.canvas;
    if (!doc || !canvas) return;
    if (canvas.width !== doc.width || canvas.height !== doc.height) {
      canvas.width = doc.width;
      canvas.height = doc.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!this.playing) this.syncMedia();
    drawFrame(ctx, doc, this.time, {
      getFrame: (clipId, assetId) => {
        const list = this.videos.get(assetId);
        const el = list?.find((v) => this.assignment.get(v) === clipId);
        if (!el || el.readyState < 2 || !el.videoWidth) return null;
        return { image: el, width: el.videoWidth, height: el.videoHeight, time: this.presented.get(el) ?? el.currentTime };
      },
      getImage: (id) => {
        const img = this.image(id);
        return img ? { image: img, width: img.naturalWidth, height: img.naturalHeight } : null;
      },
      includeSuggestedZooms: this.includeSuggested,
      hideOverlayIds: this.hideOverlayIds,
      // paused: entrance animations shown in their final state so layers stay visible and editable
      settled: !this.playing,
      getMask: (assetId, sourceTime) => this.mask(assetId, sourceTime),
      scratch: (key, w, h) => this.scratch(key, w, h),
      getOverlayFrame: (o: VideoOverlay) => {
        const v = this.overlayVideos.get(o.id);
        if (!v || v.readyState < 2 || !v.videoWidth) return null;
        return { image: v, width: v.videoWidth, height: v.videoHeight };
      },
    });
  }
}
