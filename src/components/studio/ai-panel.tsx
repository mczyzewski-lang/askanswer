"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Clapperboard, Loader2, RefreshCw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import type { AiBrollItem, AssetInfo, EditorDocument, VideoOverlay } from "@/lib/editor/types";
import { docDuration, formatShort, timedSegments } from "@/lib/editor/timeline";
import { uid } from "@/lib/editor/id";
import { cn } from "@/lib/utils";
import { useStudio } from "./store";
import { Section, Select, SButton } from "./controls";
import type { PlaybackEngine } from "./playback";

export interface AiConfig {
  higgsfield: boolean;
  claude: boolean;
  models: Array<{ id: string; label: string; description: string; durations: number[] }>;
  defaultModel: string;
}

async function readJson(res: Response) {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Serwer nie odpowiedział poprawnie (HTTP ${res.status}) — mógł się właśnie aktualizować. Spróbuj ponownie za chwilę.`);
  }
  if (!res.ok) throw new Error(String(data.error ?? `Błąd HTTP ${res.status}`));
  return data;
}

function items(doc: EditorDocument): AiBrollItem[] {
  return doc.meta.aiBroll ?? [];
}

function patchItem(id: string, patch: Partial<AiBrollItem> | ((it: AiBrollItem) => Partial<AiBrollItem>)) {
  useStudio.getState().apply((d) => ({
    ...d,
    meta: { ...d.meta, aiBroll: items(d).map((it) => (it.id === id ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it)) },
  }));
}

/** Full-frame, muted video layer under the question/captions; the expert keeps talking underneath. */
function brollOverlay(item: AiBrollItem, asset: AssetInfo, total: number): VideoOverlay {
  const len = Math.max(1, asset.durationSec ?? item.duration);
  const wanted = item.end - item.start >= 1.5 ? Math.min(item.end - item.start, len) : len;
  const start = Math.max(0, Math.min(item.start, total - 0.5));
  return {
    id: uid("ovl"),
    kind: "video",
    name: `AI: ${item.title}`.slice(0, 80),
    assetId: asset.id,
    fit: "cover",
    sourceIn: 0,
    loop: false,
    volume: 0,
    radius: 0,
    start,
    end: Math.min(total, start + wanted),
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    opacity: 1,
    animation: "fade",
  };
}

/**
 * Keeps polling Higgsfield jobs while the Studio is open (also when the AI tab is closed, and after a
 * reload): when a clip is ready it is placed on the timeline at the accepted moment.
 */
export function useBrollJobs() {
  // a string selector keeps the snapshot stable between renders
  const pending = useStudio((s) =>
    s.doc
      ? items(s.doc)
          .filter((i) => i.status === "generating" && i.jobId)
          .map((i) => `${i.id}:${i.jobId}`)
          .join(",")
      : "",
  );
  const busy = useRef(false);
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        for (const pair of pending.split(",")) {
          const [itemId, jobId] = pair.split(":");
          const res = await fetch(`/api/admin/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
          if (!res?.ok || stopped) continue;
          const job = (await res.json().catch(() => null)) as { status: string; error?: string | null; assets?: AssetInfo[] } | null;
          if (!job) continue;
          if (job.status === "FAILED") patchItem(itemId, { status: "failed", error: (job.error ?? "Generowanie nie powiodło się").slice(0, 900) });
          if (job.status === "SUCCEEDED" && job.assets?.[0]) {
            const asset = job.assets[0];
            const st = useStudio.getState();
            st.addAssets([asset]);
            st.apply((d) => {
              const item = items(d).find((i) => i.id === itemId);
              if (!item || item.status !== "generating") return d;
              const ov = brollOverlay(item, asset, docDuration(d));
              return {
                ...d,
                // below the question and other layers; captions are always drawn on top
                overlays: [ov, ...d.overlays],
                meta: { ...d.meta, aiBroll: items(d).map((i) => (i.id === itemId ? { ...i, status: "done" as const, overlayId: ov.id, error: null } : i)) },
              };
            });
          }
        }
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [pending]);
}

export function AiPanel({ engine, compositionId, ai }: { engine: PlaybackEngine | null; compositionId: string; ai: AiConfig }) {
  const doc = useStudio((s) => s.doc)!;
  const time = useStudio((s) => s.time);
  const apply = useStudio((s) => s.apply);
  const [model, setModel] = useState(ai.defaultModel);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [engineUsed, setEngineUsed] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const list = items(doc);
  const modelInfo = ai.models.find((m) => m.id === model) ?? ai.models[0];
  const total = docDuration(doc);

  const seek = (t: number) => {
    useStudio.getState().setTime(t);
    engine?.seek(t);
  };

  const suggest = async () => {
    setLoading(true);
    setErr(null);
    try {
      const segments = timedSegments(doc).map((s) => ({ t0: s.t0, t1: s.t1, text: s.words.map((w) => w.text).join(" ") }));
      if (!segments.length) throw new Error("Brak napisów — najpierw wygeneruj transkrypcję w zakładce „Napisy”, żeby AI wiedziało, o czym mówi ekspert.");
      const data = await readJson(
        await fetch(`/api/admin/compositions/${compositionId}/broll/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments, duration: total }) }),
      );
      const sugg = data.suggestions as Array<Omit<AiBrollItem, "duration" | "model" | "status">>;
      setEngineUsed(String(data.engine ?? ""));
      const dur = modelInfo.durations[0] ?? 5;
      apply((d) => ({
        ...d,
        meta: {
          ...d.meta,
          // keep what is generating or already placed; replace old untouched proposals
          aiBroll: [...items(d).filter((i) => i.status !== "suggested"), ...sugg.map((s) => ({ ...s, id: uid("ai"), duration: dur, model: modelInfo.id, status: "suggested" as const }))],
        },
      }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generate = async (item: AiBrollItem) => {
    patchItem(item.id, { status: "generating", error: null });
    try {
      const data = await readJson(
        await fetch(`/api/admin/compositions/${compositionId}/broll/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: item.prompt, duration: item.duration, model: item.model, aspect: doc.width >= doc.height ? (doc.width === doc.height ? "1:1" : "16:9") : "9:16", start: item.start }),
        }),
      );
      patchItem(item.id, { jobId: String(data.jobId), duration: Number(data.duration ?? item.duration) });
    } catch (e) {
      patchItem(item.id, { status: "failed", error: (e as Error).message });
    }
  };

  const remove = (item: AiBrollItem) =>
    apply((d) => ({
      ...d,
      overlays: item.overlayId ? d.overlays.filter((o) => o.id !== item.overlayId) : d.overlays,
      meta: { ...d.meta, aiBroll: items(d).filter((i) => i.id !== item.id) },
    }));

  const addCustom = () => {
    const prompt = custom.trim();
    if (prompt.length < 5) return;
    const dur = modelInfo.durations[0] ?? 5;
    const start = Math.min(time, Math.max(0, total - 1));
    const item: AiBrollItem = { id: uid("ai"), start, end: Math.min(total, start + dur), quote: "", title: prompt.split(/\s+/).slice(0, 5).join(" "), reason: "Własna scena", prompt, duration: dur, model: modelInfo.id, status: "suggested" };
    apply((d) => ({ ...d, meta: { ...d.meta, aiBroll: [...items(d), item] } }));
    setCustom("");
  };

  return (
    <div>
      <Section title="AI przebitki (Higgsfield)">
        <p className="text-[12px] leading-snug text-studio-muted">
          AI czyta, co mówi ekspert, i proponuje krótkie sceny wideo w kolorystyce motywu. Zaakceptowana scena jest generowana w Higgsfield i wstawiana na pełny ekran w tym fragmencie — głos eksperta i napisy zostają.
        </p>
        {!ai.higgsfield ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            Higgsfield nie jest podłączony. Dodaj zmienną <code>HIGGSFIELD_CREDENTIALS</code> = <code>KEY_ID:KEY_SECRET</code> w Railway → Variables.
          </p>
        ) : null}
        <div>
          <p className="mb-1.5 text-[11.5px] text-studio-muted">Model wideo</p>
          <Select value={model} onChange={setModel}>
            {ai.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11.5px] leading-snug text-studio-muted">{modelInfo.description}</p>
        </div>
        <SButton variant="primary" className="w-full" onClick={suggest} disabled={loading} data-testid="ai-suggest">
          {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {loading ? "AI analizuje wypowiedź…" : list.some((i) => i.status === "suggested") ? "Zaproponuj ponownie" : "Zaproponuj sceny"}
        </SButton>
        {!ai.claude ? <p className="text-[11.5px] text-studio-muted">Tryb podstawowy: propozycje bez modelu językowego. Dodaj <code>ANTHROPIC_API_KEY</code>, aby AI (Claude) dobierało sceny i pisało prompty.</p> : null}
        {engineUsed === "claude" ? <p className="text-[11.5px] text-studio-muted">Propozycje przygotował Claude na podstawie transkrypcji.</p> : null}
        {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
      </Section>

      {list.length ? (
        <Section title={`Sceny (${list.length})`}>
          {list
            .slice()
            .sort((a, b) => a.start - b.start)
            .map((it) => (
              <BrollCard key={it.id} item={it} ai={ai} canGenerate={ai.higgsfield} onSeek={() => seek(it.start)} onGenerate={() => generate(it)} onRemove={() => remove(it)} />
            ))}
        </Section>
      ) : null}

      <Section title="Własna scena">
        <p className="text-[12px] text-studio-muted">Opisz scenę — zostanie dodana w miejscu głowicy ({formatShort(time)}).</p>
        <textarea
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          rows={3}
          placeholder="np. Close-up of hands signing a contract on a wooden desk, warm light, slow push-in"
          className="w-full resize-y rounded-lg border border-studio-line bg-studio-3 px-2 py-1.5 text-[12.5px] text-studio-text outline-none focus:border-white/30"
        />
        <SButton className="w-full" onClick={addCustom} disabled={custom.trim().length < 5}>
          <Wand2 /> Dodaj propozycję
        </SButton>
      </Section>
    </div>
  );
}

function BrollCard({ item, ai, canGenerate, onSeek, onGenerate, onRemove }: { item: AiBrollItem; ai: AiConfig; canGenerate: boolean; onSeek: () => void; onGenerate: () => void; onRemove: () => void }) {
  const model = ai.models.find((m) => m.id === item.model) ?? ai.models[0];
  const editable = item.status === "suggested" || item.status === "failed";
  return (
    <div className={cn("space-y-2 rounded-xl border p-3", item.status === "done" ? "border-emerald-500/40 bg-emerald-500/5" : "border-studio-line bg-studio-3/40")} data-testid="ai-item">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSeek} className="shrink-0 rounded-md bg-studio-3 px-1.5 py-0.5 font-mono text-[11px] text-studio-text hover:bg-studio-line" title="Przejdź do tego miejsca">
          {formatShort(item.start)}–{formatShort(item.end)}
        </button>
        <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{item.title}</p>
        <button type="button" onClick={onRemove} className="rounded p-0.5 text-studio-muted hover:text-studio-text" aria-label={item.status === "done" ? "Usuń scenę z wideo" : "Odrzuć"} title={item.status === "done" ? "Usuń scenę z wideo" : "Odrzuć"}>
          {item.status === "done" ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
      {item.quote ? <p className="text-[11.5px] italic leading-snug text-studio-muted">„{item.quote}”</p> : null}
      {item.reason && item.reason !== "Własna scena" ? <p className="text-[11.5px] leading-snug text-studio-muted">{item.reason}</p> : null}
      <textarea
        value={item.prompt}
        disabled={!editable}
        onChange={(e) => patchItem(item.id, { prompt: e.target.value })}
        rows={4}
        aria-label="Prompt sceny"
        className="w-full resize-y rounded-lg border border-studio-line bg-studio-2 px-2 py-1.5 text-[11.5px] leading-snug text-studio-text outline-none focus:border-white/30 disabled:opacity-70"
      />
      {editable ? (
        <div className="flex items-center gap-2">
          <Select value={item.duration} onChange={(v) => patchItem(item.id, { duration: Number(v) })} className="w-[76px]">
            {model.durations.map((d) => (
              <option key={d} value={d}>
                {d} s
              </option>
            ))}
          </Select>
          <SButton variant="primary" className="flex-1" onClick={onGenerate} disabled={!canGenerate || item.prompt.trim().length < 5} data-testid="ai-accept">
            {item.status === "failed" ? <RefreshCw /> : <Check />}
            {item.status === "failed" ? "Spróbuj ponownie" : "Akceptuj i generuj"}
          </SButton>
        </div>
      ) : null}
      {item.status === "generating" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-sky-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Higgsfield generuje scenę… zwykle 1–4 min. Możesz dalej edytować.
        </p>
      ) : null}
      {item.status === "done" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-emerald-300" data-testid="ai-done">
          <Clapperboard className="h-3.5 w-3.5" /> Wstawiono na osi czasu jako warstwa wideo.
        </p>
      ) : null}
      {item.status === "failed" && item.error ? <p className="text-[11.5px] text-red-300">{item.error}</p> : null}
    </div>
  );
}
