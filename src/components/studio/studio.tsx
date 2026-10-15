"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Captions,
  ChevronLeft,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  FileText,
  Film,
  HelpCircle,
  LayoutTemplate,
  Loader2,
  Minus,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Shapes,
  SkipBack,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import type { AssetInfo, EditorDocument, ThemeTokens } from "@/lib/editor/types";
import { clipEnd, deleteClip, deleteRange, docDuration, formatTimecode, splitAt } from "@/lib/editor/timeline";
import { EXPORT_FORMATS } from "@/lib/editor/factory";
import { FONT_FAMILIES } from "@/lib/themes";
import { ensureFontsLoaded } from "@/lib/client/fonts";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, Tip } from "@/components/ui";
import { useStudio, type RenderInfo } from "./store";
import { PlaybackEngine } from "./playback";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import { Properties } from "./properties";
import { AudioPanel, GraphicsPanel, PausesPanel, QuestionPanel, SubtitlesPanel, TakesPanel, TemplatesPanel, TextPanel, ZoomPanel, type StudioMeta } from "./panels";
import { Row, Section, Select, SButton } from "./controls";

interface StudioPayload {
  composition: { id: string; name: string; version: number; status: string; document: EditorDocument };
  project: StudioMeta["project"];
  question: StudioMeta["question"];
  take: (StudioMeta["take"] & { originalAssetId: string | null }) | null;
  takes: StudioMeta["takes"];
  assets: AssetInfo[];
  renders: RenderInfo[];
  elevenLabs: boolean;
}

const TABS = [
  { key: "question", label: "Pytanie", icon: HelpCircle },
  { key: "takes", label: "Nagrania", icon: Film },
  { key: "subs", label: "Napisy", icon: Captions },
  { key: "pauses", label: "Pauzy", icon: AudioLines },
  { key: "zoom", label: "Zbliżenia", icon: ZoomIn },
  { key: "audio", label: "Audio", icon: Clapperboard },
  { key: "text", label: "Tekst", icon: Type },
  { key: "graphics", label: "Grafika", icon: Shapes },
  { key: "templates", label: "Szablony", icon: LayoutTemplate },
  { key: "theme", label: "Motyw", icon: Palette },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function Studio({ id }: { id: string }) {
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<PlaybackEngine | null>(null);
  const [tab, setTab] = useState<TabKey>("subs");
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const doc = useStudio((s) => s.doc);
  const time = useStudio((s) => s.time);
  const playing = useStudio((s) => s.playing);
  const saving = useStudio((s) => s.saving);
  const dirty = useStudio((s) => s.dirty);
  const past = useStudio((s) => s.past.length);
  const future = useStudio((s) => s.future.length);
  const selection = useStudio((s) => s.selection);
  const range = useStudio((s) => s.range);
  const clean = useStudio((s) => s.cleanPreview);
  const assets = useStudio((s) => s.assets);
  const pps = useStudio((s) => s.pxPerSec);

  const toast = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setNotice({ text, tone });
    setTimeout(() => setNotice(null), 3500);
  }, []);

  // load composition
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/compositions/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Nie udało się wczytać projektu");
        await ensureFontsLoaded();
        if (cancelled) return;
        useStudio.getState().load({ compositionId: id, name: data.composition.name, doc: data.composition.document, version: data.composition.version, assets: data.assets });
        setPayload(data);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // playback engine
  useEffect(() => {
    if (!payload) return;
    const e = new PlaybackEngine();
    e.onTime = (t) => useStudio.getState().setTime(t);
    e.onEnded = () => useStudio.getState().setPlaying(false);
    setEngine(e);
    return () => e.destroy();
  }, [payload]);

  useEffect(() => {
    if (!engine || !doc) return;
    engine.doc = doc;
    engine.assets = assets;
    engine.invalidate();
  }, [engine, doc, assets]);

  useEffect(() => {
    if (!engine) return;
    if (!engine.isPlaying() && Math.abs(engine.time - time) > 1e-4) engine.seek(time);
    engine.invalidate();
  }, [engine, time]);

  // ---- autosave (debounced + periodic) and unload protection ----
  const save = useCallback(async () => {
    const st = useStudio.getState();
    if (!st.doc || !st.dirty || st.saving === "saving" || st.saving === "conflict") return;
    const docToSave = st.doc;
    st.setSaving("saving");
    try {
      const res = await fetch(`/api/admin/compositions/${st.compositionId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: st.version, document: docToSave }),
      });
      const data = await res.json();
      if (res.status === 409) {
        st.setSaving("conflict");
        toast(data.error, "err");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Błąd zapisu");
      useStudio.getState().markSaved(data.version, docToSave);
    } catch (e) {
      useStudio.getState().setSaving("error");
      toast(`Nie zapisano: ${(e as Error).message}`, "err");
    }
  }, [toast]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
  }, [doc, dirty, save]);
  useEffect(() => {
    const t = setInterval(save, 10_000);
    const h = (e: BeforeUnloadEvent) => {
      if (useStudio.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", h);
    };
  }, [save]);

  // ---- transport ----
  const togglePlay = useCallback(() => {
    if (!engine) return;
    const st = useStudio.getState();
    if (engine.isPlaying()) {
      engine.pause();
      st.setPlaying(false);
    } else {
      engine.seek(st.time);
      engine.play();
      st.setPlaying(true);
    }
  }, [engine]);

  const seek = useCallback(
    (t: number) => {
      const st = useStudio.getState();
      if (!st.doc) return;
      const tt = Math.max(0, Math.min(docDuration(st.doc), t));
      st.setTime(tt);
      engine?.seek(tt);
    },
    [engine],
  );

  const split = useCallback(() => {
    const st = useStudio.getState();
    const sel = st.selection;
    const id = sel && "id" in sel && (sel.kind === "clip" || sel.kind === "narration" || sel.kind === "music") ? sel.id : undefined;
    st.apply((d) => splitAt(d, st.time, id));
  }, []);

  const removeSelection = useCallback((ripple: boolean) => {
    const st = useStudio.getState();
    if (st.range && st.range.b - st.range.a > 0.02) {
      const r = st.range;
      st.apply((d) => deleteRange(d, r.a, r.b, true));
      st.setRange(null);
      return;
    }
    const sel = st.selection;
    if (!sel) return;
    if (sel.kind === "overlay") st.apply((d) => ({ ...d, overlays: d.overlays.filter((o) => !sel.ids.includes(o.id)) }));
    else if (sel.kind === "subtitles" && sel.segId) st.apply((d) => ({ ...d, subtitles: { ...d.subtitles, source: "edited", segments: d.subtitles.segments.filter((s) => s.id !== sel.segId) } }));
    else if ("id" in sel && sel.kind !== "pause") st.apply((d) => deleteClip(d, sel.id, ripple));
    st.select(null);
  }, []);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      const st = useStudio.getState();
      if (!st.doc) return;
      const mod = e.metaKey || e.ctrlKey;
      const frame = 1 / st.doc.fps;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (e.key === "s" || e.key === "S" || (mod && e.key.toLowerCase() === "b")) {
        e.preventDefault();
        split();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection(e.shiftKey);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(st.time - (e.shiftKey ? 1 : frame));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(st.time + (e.shiftKey ? 1 : frame));
      } else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(docDuration(st.doc));
      else if (e.key === "i" || e.key === "I") st.setRange({ a: st.time, b: Math.max(st.time + frame, st.range?.b ?? st.time + 1) });
      else if (e.key === "o" || e.key === "O") st.setRange({ a: Math.min(st.range?.a ?? Math.max(0, st.time - 1), st.time - frame), b: st.time });
      else if (e.key === "+" || e.key === "=") st.setPxPerSec(st.pxPerSec * 1.25);
      else if (e.key === "-") st.setPxPerSec(st.pxPerSec / 1.25);
      else if (e.key === "Escape") {
        st.select(null);
        st.setRange(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, split, removeSelection, seek, save]);

  // ---- server actions used by panels ----
  const upload = async (f: File): Promise<AssetInfo | null> => {
    const fd = new FormData();
    fd.set("file", f);
    const res = await fetch(`/api/admin/compositions/${id}/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error ?? "Błąd wysyłania", "err");
      return null;
    }
    useStudio.getState().addAssets([data]);
    return data;
  };

  const regenerateNarration = async (voiceId: string) => {
    const res = await fetch(`/api/admin/compositions/${id}/narration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voiceId }) });
    const data = await res.json();
    if (!res.ok) return toast(data.error ?? "Nie udało się wygenerować lektora", "err");
    const st = useStudio.getState();
    st.addAssets([data]);
    st.apply((d) => {
      if (d.narration.length) return { ...d, narration: d.narration.map((n, i) => (i === 0 ? { ...n, assetId: data.id, sourceIn: 0, sourceOut: data.durationSec ?? n.sourceOut } : n)) };
      return { ...d, narration: [{ id: `aud_${Date.now()}`, assetId: data.id, kind: "narration", start: 0, sourceIn: 0, sourceOut: data.durationSec ?? 3, volume: 1, muted: false, fadeIn: 0, fadeOut: 0.05, label: "Lektor ElevenLabs" }] };
    });
    toast("Wygenerowano nowy głos lektora");
  };

  const replaceTake = async (takeId: string) => {
    const st = useStudio.getState();
    const res = await fetch(`/api/admin/compositions/${id}/replace-take`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ takeId, document: st.doc }) });
    const data = await res.json();
    if (!res.ok) return toast(data.error ?? "Nie udało się zamienić ujęcia", "err");
    st.addAssets(data.assets);
    st.replaceDoc(data.document);
    setPayload((p) => (p ? { ...p, take: p.take ? { ...p.take, id: takeId, takeNumber: p.takes.find((t) => t.id === takeId)?.takeNumber ?? p.take.takeNumber } : p.take } : p));
    toast("Zamieniono ujęcie — projekt graficzny został zachowany");
  };

  const retranscribe = async () => {
    if (!payload?.take) return;
    const res = await fetch(`/api/admin/takes/${payload.take.id}/transcribe`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) return toast(data.error ?? "Błąd", "err");
    toast("Zlecono transkrypcję — odśwież Studio za chwilę");
  };

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-studio text-studio-text">
        <div className="text-center">
          <p className="text-lg">{error}</p>
          <Link href="/admin" className="mt-4 inline-block text-sm text-studio-muted underline">
            Wróć do panelu
          </Link>
        </div>
      </div>
    );
  }
  if (!payload || !doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-studio text-studio-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const meta: StudioMeta = { compositionId: id, project: payload.project, question: payload.question, take: payload.take, takes: payload.takes, elevenLabs: payload.elevenLabs };
  const duration = docDuration(doc);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-studio text-studio-text">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-studio-line px-3">
        <Link href={`/admin/projects/${payload.project.id}`} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-studio-muted hover:bg-studio-3 hover:text-studio-text">
          <ChevronLeft className="h-4 w-4" /> {payload.project.name}
        </Link>
        <span className="hidden min-w-0 truncate text-[13px] font-medium md:block">{payload.question?.text ?? payload.composition.name}</span>
        <span className="ml-auto text-[11.5px] text-studio-muted" data-testid="save-status">
          {saving === "saving" ? "Zapisywanie…" : saving === "conflict" ? "Konflikt wersji — odśwież" : saving === "error" ? "Błąd zapisu" : dirty ? "Niezapisane zmiany" : "Zapisano"}
        </span>
        <Tip label={clean ? "Pokaż nakładki edytora" : "Podgląd bez nakładek"}>
          <button className="rounded-lg p-2 text-studio-muted hover:bg-studio-3 hover:text-studio-text" onClick={() => useStudio.getState().setCleanPreview(!clean)} aria-label="Podgląd bez nakładek">
            {clean ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </Tip>
        <SButton variant="primary" onClick={() => setExportOpen(true)}>
          <Download /> Eksportuj
        </SButton>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left: assets & tools */}
        <nav className="scroll-thin flex w-[62px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-studio-line py-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn("flex w-[54px] shrink-0 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] transition", tab === t.key ? "bg-studio-3 text-white" : "text-studio-muted hover:text-studio-text")}
              data-testid={`tab-${t.key}`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </nav>
        <aside className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-r border-studio-line bg-studio-2">
          {tab === "question" ? <QuestionPanel meta={meta} /> : null}
          {tab === "takes" ? <TakesPanel meta={meta} onReplaceTake={replaceTake} /> : null}
          {tab === "subs" ? <SubtitlesPanel engine={engine} meta={meta} onRetranscribe={retranscribe} /> : null}
          {tab === "pauses" ? <PausesPanel engine={engine} /> : null}
          {tab === "zoom" ? <ZoomPanel engine={engine} /> : null}
          {tab === "audio" ? <AudioPanel meta={meta} onUpload={async (f) => void (await upload(f))} onRegenerate={regenerateNarration} /> : null}
          {tab === "text" ? <TextPanel /> : null}
          {tab === "graphics" ? <GraphicsPanel meta={meta} onUpload={upload} /> : null}
          {tab === "templates" ? <TemplatesPanel /> : null}
          {tab === "theme" ? <ThemePanel themeId={payload.project.themeId} toast={toast} /> : null}
        </aside>

        {/* center: preview */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-4">
            <Preview engine={engine} />
          </div>
        </main>

        {/* right: properties */}
        <aside className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-l border-studio-line bg-studio-2">
          <Properties />
        </aside>
      </div>

      {/* bottom: transport + timeline */}
      <div className="flex h-[350px] shrink-0 flex-col border-t border-studio-line bg-studio-2">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-studio-line px-3">
          <Tip label="Na początek (Home)">
            <button className="rounded-lg p-2 hover:bg-studio-3" onClick={() => seek(0)} aria-label="Na początek">
              <SkipBack className="h-4 w-4" />
            </button>
          </Tip>
          <Tip label="Odtwórz / pauza (Spacja)">
            <button className="rounded-lg bg-white p-2 text-black hover:bg-white/90" onClick={togglePlay} aria-label={playing ? "Pauza" : "Odtwórz"} data-testid="play">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          </Tip>
          <span className="tabular ml-2 w-[150px] text-[12.5px]" data-testid="timecode">
            {formatTimecode(time, doc.fps)} <span className="text-studio-muted">/ {formatTimecode(duration, doc.fps)}</span>
          </span>
          <div className="mx-2 h-5 w-px bg-studio-line" />
          <Tip label="Podziel w miejscu głowicy (S)">
            <SButton variant="ghost" onClick={split}>
              <Scissors /> Podziel
            </SButton>
          </Tip>
          <Tip label="Usuń zaznaczenie (Delete) · Shift — z zamknięciem luki">
            <SButton variant="ghost" onClick={() => removeSelection(false)} disabled={!selection && !range}>
              <Trash2 /> Usuń
            </SButton>
          </Tip>
          <Tip label="Usuń i zamknij lukę (Shift+Delete)">
            <SButton variant="ghost" onClick={() => removeSelection(true)} disabled={!selection && !range}>
              Usuń z przesunięciem
            </SButton>
          </Tip>
          {range ? (
            <span className="ml-1 flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-2 py-1 text-[11.5px] text-sky-200">
              Zaznaczono {(range.b - range.a).toFixed(2)} s
              <SButton variant="primary" className="h-6 px-2" onClick={() => removeSelection(true)} data-testid="delete-range">
                Wytnij fragment
              </SButton>
              <button className="text-sky-200/70 hover:text-white" onClick={() => useStudio.getState().setRange(null)} aria-label="Anuluj zaznaczenie">
                ×
              </button>
            </span>
          ) : (
            <span className="ml-1 hidden text-[11px] text-studio-muted xl:inline">Przeciągnij po fali dźwięku, aby zaznaczyć fragment</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Tip label="Cofnij (⌘/Ctrl+Z)">
              <button className="rounded-lg p-2 hover:bg-studio-3 disabled:opacity-30" disabled={!past} onClick={() => useStudio.getState().undo()} aria-label="Cofnij">
                <Undo2 className="h-4 w-4" />
              </button>
            </Tip>
            <Tip label="Ponów (⌘/Ctrl+Shift+Z)">
              <button className="rounded-lg p-2 hover:bg-studio-3 disabled:opacity-30" disabled={!future} onClick={() => useStudio.getState().redo()} aria-label="Ponów">
                <Redo2 className="h-4 w-4" />
              </button>
            </Tip>
            <div className="mx-2 h-5 w-px bg-studio-line" />
            <SButton variant="ghost" onClick={() => setTab("pauses")}>
              <AudioLines /> Wykryj pauzy
            </SButton>
            <SButton variant="ghost" onClick={() => setTab("zoom")}>
              <WandSparkles /> Zbliżenia
            </SButton>
            <div className="mx-2 h-5 w-px bg-studio-line" />
            <button className="rounded-lg p-1.5 hover:bg-studio-3" onClick={() => useStudio.getState().setPxPerSec(pps / 1.3)} aria-label="Oddal oś czasu">
              <Minus className="h-4 w-4" />
            </button>
            <input type="range" className="range w-24" min={8} max={600} value={pps} onChange={(e) => useStudio.getState().setPxPerSec(Number(e.target.value))} aria-label="Powiększenie osi czasu" />
            <button className="rounded-lg p-1.5 hover:bg-studio-3" onClick={() => useStudio.getState().setPxPerSec(pps * 1.3)} aria-label="Przybliż oś czasu">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <Timeline engine={engine} />
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} compositionId={id} initial={payload.renders} take={payload.take} save={save} />
      {notice ? (
        <div className={cn("fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-xl", notice.tone === "ok" ? "bg-white text-black" : "bg-red-600 text-white")} role="status">
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThemePanel({ themeId, toast }: { themeId: string | null; toast: (t: string, tone?: "ok" | "err") => void }) {
  const doc = useStudio((s) => s.doc)!;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = (patch: Partial<ThemeTokens>) => {
    const st = useStudio.getState();
    // theme is applied live to the document; the project theme is persisted so every video follows
    st.apply((d) => ({ ...d, theme: { ...d.theme, ...patch } }), `theme:${Object.keys(patch).join(",")}`);
    if (!themeId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const t = useStudio.getState().doc!.theme;
      const res = await fetch(`/api/admin/themes/${themeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryColor: t.primary,
          accentColor: t.accent,
          secondaryColor: t.secondary,
          textColor: t.text,
          highlightColor: t.highlight,
          backgroundColor: t.background,
          questionFont: t.questionFont,
          subtitleFont: t.subtitleFont,
          labelFont: t.labelFont,
        }),
      });
      if (!res.ok) toast((await res.json()).error ?? "Nie zapisano motywu", "err");
    }, 700);
  };
  const colors: Array<[keyof ThemeTokens, string]> = [
    ["primary", "Kolor główny"],
    ["accent", "Akcent"],
    ["highlight", "Podświetlenie napisów"],
    ["text", "Tekst"],
    ["secondary", "Dodatkowy"],
    ["background", "Tło"],
  ];
  return (
    <div>
      <Section title={`Motyw: ${doc.theme.name}`}>
        {colors.map(([k, label]) => (
          <Row key={k} label={label}>
            <span className="flex items-center gap-2">
              <input
                type="color"
                aria-label={label}
                data-testid={`theme-${k}`}
                className="h-8 w-10 cursor-pointer rounded-md border border-studio-line bg-transparent p-0.5"
                value={String(doc.theme[k])}
                onChange={(e) => update({ [k]: e.target.value.toUpperCase() } as Partial<ThemeTokens>)}
              />
              <span className="font-mono text-[11.5px] text-studio-muted">{String(doc.theme[k])}</span>
            </span>
          </Row>
        ))}
        {(
          [
            ["questionFont", "Czcionka pytań"],
            ["subtitleFont", "Czcionka napisów"],
            ["labelFont", "Czcionka etykiet"],
          ] as const
        ).map(([k, label]) => (
          <Row key={k} label={label}>
            <Select value={doc.theme[k]} onChange={(v) => update({ [k]: v } as Partial<ThemeTokens>)}>
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Row>
        ))}
        <p className="text-[11.5px] text-studio-muted">Zmiany motywu zapisują się w projekcie i obejmują wszystkie jego filmy: pytanie, podświetlenie napisów, belki, callouty i tła.</p>
        <Link href={`/admin/themes?theme=${themeId ?? ""}`} className="text-[12px] text-sky-300 hover:underline">
          Pełne ustawienia motywu i logo →
        </Link>
      </Section>
    </div>
  );
}

function ExportDialog({
  open,
  onOpenChange,
  compositionId,
  initial,
  take,
  save,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  compositionId: string;
  initial: RenderInfo[];
  take: StudioPayload["take"];
  save: () => Promise<void>;
}) {
  const [format, setFormat] = useState("1080x1920");
  const [quality, setQuality] = useState("standard");
  const [job, setJob] = useState<(RenderInfo & { previewUrl?: string | null }) | null>(initial[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/render-jobs/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 1500);
    return () => clearInterval(t);
  }, [job]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      // render exactly what is on screen: flush pending edits first
      await save();
      if (useStudio.getState().dirty) await save();
      const res = await fetch(`/api/admin/compositions/${compositionId}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format, quality }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nie udało się rozpocząć renderowania");
      setJob({ id: data.id, status: "QUEUED", progress: 0, error: null, downloadUrl: null, createdAt: new Date().toISOString() });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const running = job && (job.status === "QUEUED" || job.status === "RUNNING");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dark title="Eksport wideo" description="Renderowanie po stronie serwera: MP4 · H.264 · AAC. Zawiera wszystkie cięcia, napisy, grafiki, zbliżenia i audio.">
        <div className="space-y-4">
          <Row label="Format">
            <Select value={format} onChange={setFormat}>
              {Object.entries(EXPORT_FORMATS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Jakość">
            <Select value={quality} onChange={setQuality}>
              <option value="standard">Standardowa (zalecana)</option>
              <option value="high">Wysoka (wolniejszy render)</option>
              <option value="draft">Szkic (szybki podgląd)</option>
            </Select>
          </Row>
          <SButton variant="primary" className="h-10 w-full" onClick={start} disabled={busy || !!running}>
            {busy || running ? <Loader2 className="animate-spin" /> : <Download />} {running ? "Renderowanie…" : "Renderuj MP4"}
          </SButton>
          {err ? <p className="text-sm text-red-300">{err}</p> : null}
          {job ? (
            <div className="rounded-xl border border-studio-line p-3" data-testid="render-status">
              <div className="mb-2 flex justify-between text-[12.5px]">
                <span>{job.status === "SUCCEEDED" ? "Gotowe" : job.status === "FAILED" ? "Błąd renderowania" : job.status === "RUNNING" ? "Renderowanie" : "W kolejce"}</span>
                <span className="tabular text-studio-muted">{Math.round((job.progress ?? 0) * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-studio-line">
                <div className={cn("h-full rounded-full transition-all", job.status === "FAILED" ? "bg-red-500" : "bg-white")} style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
              </div>
              {job.error && job.status !== "SUCCEEDED" ? <p className="mt-2 text-[12px] text-red-300">{job.error}</p> : null}
              {job.status === "FAILED" ? (
                <SButton
                  className="mt-2"
                  onClick={async () => {
                    await fetch(`/api/admin/render-jobs/${job.id}`, { method: "POST" });
                    setJob({ ...job, status: "QUEUED", progress: 0, error: null });
                  }}
                >
                  Ponów render
                </SButton>
              ) : null}
              {job.status === "SUCCEEDED" && job.downloadUrl ? (
                <a href={job.downloadUrl} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-black" data-testid="download-mp4">
                  <Download className="h-4 w-4" /> Pobierz MP4
                </a>
              ) : null}
            </div>
          ) : null}
          <div className="border-t border-studio-line pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-studio-muted">Inne pliki</p>
            <div className="flex flex-wrap gap-2">
              {take ? (
                <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-studio-line px-3 text-[12.5px] hover:bg-studio-3" href={`/api/admin/takes/${take.id}/download`}>
                  <Film className="h-3.5 w-3.5" /> Oryginalne nagranie
                </a>
              ) : null}
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-studio-line px-3 text-[12.5px] hover:bg-studio-3" href={`/api/admin/compositions/${compositionId}/export?type=srt`} onClick={() => void save()}>
                <Captions className="h-3.5 w-3.5" /> Napisy SRT
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-studio-line px-3 text-[12.5px] hover:bg-studio-3" href={`/api/admin/compositions/${compositionId}/export?type=txt`}>
                <FileText className="h-3.5 w-3.5" /> Transkrypcja TXT
              </a>
              {take?.hasTranscript ? (
                <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-studio-line px-3 text-[12.5px] hover:bg-studio-3" href={`/api/admin/takes/${take.id}/transcript`}>
                  <FileText className="h-3.5 w-3.5" /> Oryginalna transkrypcja
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { clipEnd };
