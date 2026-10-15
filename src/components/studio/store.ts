"use client";
import { create } from "zustand";
import type { AssetInfo, EditorDocument } from "@/lib/editor/types";

export type Selection =
  | { kind: "overlay"; ids: string[] }
  | { kind: "clip"; id: string }
  | { kind: "narration"; id: string }
  | { kind: "music"; id: string }
  | { kind: "zoom"; id: string }
  | { kind: "subtitles"; segId?: string }
  | { kind: "pause"; id: string }
  | null;

export interface RenderInfo {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
  createdAt: string | Date;
}

interface StudioState {
  compositionId: string;
  name: string;
  doc: EditorDocument | null;
  version: number;
  dirty: boolean;
  saving: "idle" | "saving" | "saved" | "error" | "conflict";
  lastSavedAt: number | null;
  past: EditorDocument[];
  future: EditorDocument[];
  gestureBase: EditorDocument | null;
  lastMergeKey: string | null;
  lastMergeAt: number;
  selection: Selection;
  range: { a: number; b: number } | null;
  time: number;
  playing: boolean;
  pxPerSec: number;
  assets: Record<string, AssetInfo>;
  cleanPreview: boolean;

  load: (p: { compositionId: string; name: string; doc: EditorDocument; version: number; assets: AssetInfo[] }) => void;
  apply: (fn: (d: EditorDocument) => EditorDocument, mergeKey?: string) => void;
  replaceDoc: (d: EditorDocument) => void;
  beginGesture: () => void;
  updateGesture: (fn: (base: EditorDocument) => EditorDocument) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setRange: (r: { a: number; b: number } | null) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setPxPerSec: (z: number) => void;
  addAssets: (a: AssetInfo[]) => void;
  markSaved: (version: number, savedDoc: EditorDocument) => void;
  setSaving: (s: StudioState["saving"]) => void;
  setCleanPreview: (v: boolean) => void;
}

const HISTORY = 200;

export const useStudio = create<StudioState>((set, get) => ({
  compositionId: "",
  name: "",
  doc: null,
  version: 0,
  dirty: false,
  saving: "idle",
  lastSavedAt: null,
  past: [],
  future: [],
  gestureBase: null,
  lastMergeKey: null,
  lastMergeAt: 0,
  selection: null,
  range: null,
  time: 0,
  playing: false,
  pxPerSec: 60,
  assets: {},
  cleanPreview: false,

  load: ({ compositionId, name, doc, version, assets }) =>
    set({
      compositionId,
      name,
      doc,
      version,
      dirty: false,
      past: [],
      future: [],
      selection: null,
      time: 0,
      assets: Object.fromEntries(assets.map((a) => [a.id, a])),
      saving: "idle",
    }),

  /** Apply an edit with undo history. Rapid edits sharing a mergeKey (e.g. slider drags) coalesce into one step. */
  apply: (fn, mergeKey) => {
    const { doc, past, lastMergeKey, lastMergeAt } = get();
    if (!doc) return;
    const next = fn(doc);
    if (next === doc) return;
    const now = Date.now();
    const merge = mergeKey && mergeKey === lastMergeKey && now - lastMergeAt < 800;
    set({
      doc: next,
      past: merge ? past : [...past.slice(-HISTORY), doc],
      future: [],
      dirty: true,
      lastMergeKey: mergeKey ?? null,
      lastMergeAt: now,
    });
  },
  replaceDoc: (d) => set((s) => ({ doc: d, past: s.doc ? [...s.past.slice(-HISTORY), s.doc] : s.past, future: [], dirty: true })),

  beginGesture: () => set((s) => ({ gestureBase: s.doc })),
  updateGesture: (fn) => {
    const base = get().gestureBase;
    if (!base) return;
    set({ doc: fn(base) });
  },
  endGesture: () => {
    const { gestureBase, doc, past } = get();
    if (gestureBase && doc && gestureBase !== doc) set({ past: [...past.slice(-HISTORY), gestureBase], future: [], dirty: true, gestureBase: null, lastMergeKey: null });
    else set({ gestureBase: null });
  },

  undo: () => {
    const { past, doc, future } = get();
    if (!past.length || !doc) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], dirty: true, lastMergeKey: null });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length || !doc) return;
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], dirty: true, lastMergeKey: null });
  },

  select: (selection) => set({ selection }),
  setRange: (range) => set({ range }),
  setTime: (t) => set({ time: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setPxPerSec: (z) => set({ pxPerSec: Math.min(600, Math.max(8, z)) }),
  addAssets: (a) => set((s) => ({ assets: { ...s.assets, ...Object.fromEntries(a.map((x) => [x.id, x])) } })),
  markSaved: (version, savedDoc) => set((s) => ({ version, dirty: s.doc !== savedDoc, saving: "saved", lastSavedAt: Date.now() })),
  setSaving: (saving) => set({ saving }),
  setCleanPreview: (cleanPreview) => set({ cleanPreview }),
}));
