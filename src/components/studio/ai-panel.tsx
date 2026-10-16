"use client";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Check, Clapperboard, Loader2, Plus, RefreshCw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import type { AiBrollItem, AssetInfo, EditorDocument, ImageOverlay, VideoOverlay } from "@/lib/editor/types";
import { docDuration, formatShort, timedSegments } from "@/lib/editor/timeline";
import { uid } from "@/lib/editor/id";
import { cn } from "@/lib/utils";
import { useStudio } from "./store";
import { Section, Seg, Select, SButton, TextField } from "./controls";
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

/** Full-frame infographic image for the moment's length (fades in under the question and captions). */
function infographicOverlay(item: AiBrollItem, asset: AssetInfo, total: number): ImageOverlay {
  const start = Math.max(0, Math.min(item.start, total - 0.5));
  return {
    id: uid("ovl"),
    kind: "image",
    name: `Infografika: ${item.infographic?.headline ?? item.title}`.slice(0, 80),
    assetId: asset.id,
    fit: "cover",
    start,
    end: Math.min(total, start + Math.max(2, item.end - item.start)),
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    opacity: 1,
    animation: "fade",
  };
}

const isInfographic = (i: AiBrollItem) => i.kind === "infographic";

/** Starting infographic content for an item that has none (custom scenes, older proposals). */
function defaultInfographic(item: AiBrollItem) {
  const text = item.quote || item.prompt;
  return { headline: item.title, items: [{ value: "1.", label: text.split(/\s+/).slice(0, 9).join(" ") }], note: null };
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
          const job = (await res.json().catch(() => null)) as { status: string; error?: string | null; warning?: string | null; assets?: AssetInfo[] } | null;
          if (!job) continue;
          if (job.status === "FAILED") patchItem(itemId, { status: "failed", error: (job.error ?? "Generowanie nie powiodło się").slice(0, 900) });
          if (job.status === "SUCCEEDED" && job.assets?.[0]) {
            const asset = job.assets[0];
            const st = useStudio.getState();
            st.addAssets([asset]);
            st.apply((d) => {
              const item = items(d).find((i) => i.id === itemId);
              if (!item || item.status !== "generating") return d;
              const ov = isInfographic(item) ? infographicOverlay(item, asset, docDuration(d)) : brollOverlay(item, asset, docDuration(d));
              return {
                ...d,
                // below the question and other layers; captions are always drawn on top
                overlays: [ov, ...d.overlays],
                meta: { ...d.meta, aiBroll: items(d).map((i) => (i.id === itemId ? { ...i, status: "done" as const, overlayId: ov.id, error: null, warning: job.warning ?? null } : i)) },
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
  const [styled, setStyled] = useState<boolean | null>(null);
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
      const sugg = data.suggestions as Array<Omit<AiBrollItem, "model" | "status">>;
      setEngineUsed(String(data.engine ?? ""));
      setStyled(Boolean(data.styled));
      const snap = (d: number) => modelInfo.durations.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b), modelInfo.durations[0] ?? 5);
      apply((d) => ({
        ...d,
        meta: {
          ...d.meta,
          // keep what is generating or already placed; replace old untouched proposals
          aiBroll: [...items(d).filter((i) => i.status !== "suggested"), ...sugg.map((s) => ({ ...s, id: uid("ai"), duration: snap(s.duration ?? 5), model: modelInfo.id, illustration: ai.higgsfield, status: "suggested" as const }))],
        },
      }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generate = async (item: AiBrollItem) => {
    patchItem(item.id, { status: "generating", error: null, warning: null });
    try {
      if (isInfographic(item)) {
        const info = item.infographic ?? defaultInfographic(item);
        const data = await readJson(
          await fetch(`/api/admin/compositions/${compositionId}/broll/infographic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              infographic: { headline: info.headline, items: info.items.filter((r) => r.value.trim() || r.label.trim()), note: info.note || null },
              imagePrompt: item.illustration && item.imagePrompt ? item.imagePrompt : null,
              start: item.start,
            }),
          }),
        );
        patchItem(item.id, { jobId: String(data.jobId) });
        return;
      }
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
    const item: AiBrollItem = { id: uid("ai"), kind: "video", start, end: Math.min(total, start + dur), quote: "", title: prompt.split(/\s+/).slice(0, 5).join(" "), reason: "Własna scena", prompt, imagePrompt: prompt, illustration: ai.higgsfield, duration: dur, model: modelInfo.id, status: "suggested" };
    apply((d) => ({ ...d, meta: { ...d.meta, aiBroll: [...items(d), item] } }));
    setCustom("");
  };

  return (
    <div>
      <Section title="AI: sceny i infografiki">
        <p className="text-[12px] leading-snug text-studio-muted">
          AI czyta, co mówi ekspert, i proponuje na przemian sceny wideo (Higgsfield) i infografiki — w stylu kategorii i kolorach motywu. Zaakceptowany element trafia na pełny ekran w tym fragmencie; głos eksperta, pytanie i napisy zostają.
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
        {styled === true ? <p className="text-[11.5px] text-studio-muted">Styl scen: z ustawień kategorii / motywu (Motywy → Styl scen AI).</p> : null}
        {styled === false ? <p className="text-[11.5px] text-studio-muted">Brak stylu w kategorii i motywie — sceny w filmowym realizmie. Styl ustawisz w Motywy → Styl scen AI.</p> : null}
        {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
      </Section>

      {list.length ? (
        <Section title={`Propozycje (${list.length})`}>
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
  const info = isInfographic(item);
  const content = item.infographic ?? defaultInfographic(item);
  const setInfo = (patch: Partial<typeof content>) => patchItem(item.id, (it) => ({ infographic: { ...(it.infographic ?? defaultInfographic(it)), ...patch } }));
  const area = "w-full resize-y rounded-lg border border-studio-line bg-studio-2 px-2 py-1.5 text-[11.5px] leading-snug text-studio-text outline-none focus:border-white/30 disabled:opacity-70";
  const canAccept = info ? content.headline.trim().length > 0 && content.items.some((r) => r.value.trim() || r.label.trim()) : canGenerate && item.prompt.trim().length >= 5;
  return (
    <div className={cn("space-y-2 rounded-xl border p-3", item.status === "done" ? "border-emerald-500/40 bg-emerald-500/5" : "border-studio-line bg-studio-3/40")} data-testid="ai-item" data-kind={info ? "infographic" : "video"}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSeek} className="shrink-0 rounded-md bg-studio-3 px-1.5 py-0.5 font-mono text-[11px] text-studio-text hover:bg-studio-line" title="Przejdź do tego miejsca">
          {formatShort(item.start)}–{formatShort(item.end)}
        </button>
        <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">
          {info ? <BarChart3 className="mr-1 inline h-3.5 w-3.5 text-studio-muted" /> : <Clapperboard className="mr-1 inline h-3.5 w-3.5 text-studio-muted" />}
          {item.title}
        </p>
        <button type="button" onClick={onRemove} className="rounded p-0.5 text-studio-muted hover:text-studio-text" aria-label={item.status === "done" ? "Usuń z wideo" : "Odrzuć"} title={item.status === "done" ? "Usuń z wideo" : "Odrzuć"}>
          {item.status === "done" ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
      {item.quote ? <p className="text-[11.5px] italic leading-snug text-studio-muted">„{item.quote}”</p> : null}
      {item.reason && item.reason !== "Własna scena" ? <p className="text-[11.5px] leading-snug text-studio-muted">{item.reason}</p> : null}
      {editable ? (
        <Seg<"video" | "infographic">
          value={info ? "infographic" : "video"}
          onChange={(k) => patchItem(item.id, (it) => ({ kind: k, ...(k === "infographic" && !it.infographic ? { infographic: defaultInfographic(it) } : {}) }))}
          options={[
            ["video", "Wideo AI"],
            ["infographic", "Infografika"],
          ]}
        />
      ) : null}

      {info ? (
        <div className="space-y-1.5">
          <TextField value={content.headline} disabled={!editable} onChange={(e) => setInfo({ headline: e.target.value })} aria-label="Nagłówek infografiki" placeholder="Nagłówek" />
          {content.items.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              <TextField
                value={r.value}
                disabled={!editable}
                className="w-[86px] shrink-0 font-semibold"
                aria-label={`Wartość ${i + 1}`}
                placeholder="np. 6 mies."
                onChange={(e) => setInfo({ items: content.items.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}
              />
              <TextField value={r.label} disabled={!editable} aria-label={`Opis ${i + 1}`} placeholder="Opis" onChange={(e) => setInfo({ items: content.items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              {editable && content.items.length > 1 ? (
                <button type="button" aria-label="Usuń wiersz" className="px-1 text-studio-muted hover:text-studio-text" onClick={() => setInfo({ items: content.items.filter((_, k) => k !== i) })}>
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
          {editable && content.items.length < 4 ? (
            <SButton variant="ghost" className="h-7 w-full" onClick={() => setInfo({ items: [...content.items, { value: "", label: "" }] })}>
              <Plus /> Dodaj wiersz
            </SButton>
          ) : null}
          <TextField value={content.note ?? ""} disabled={!editable} onChange={(e) => setInfo({ note: e.target.value })} aria-label="Przypis" placeholder="Przypis (opcjonalnie)" />
          <label className={cn("flex items-center gap-2 text-[11.5px]", !ai.higgsfield && "opacity-50")}>
            <input type="checkbox" checked={!!item.illustration && ai.higgsfield} disabled={!editable || !ai.higgsfield} onChange={(e) => patchItem(item.id, { illustration: e.target.checked })} />
            Ilustracja AI w tle (Higgsfield, styl kategorii)
          </label>
          {item.illustration && ai.higgsfield ? (
            <textarea value={item.imagePrompt ?? ""} disabled={!editable} onChange={(e) => patchItem(item.id, { imagePrompt: e.target.value })} rows={3} aria-label="Prompt ilustracji" className={area} />
          ) : null}
        </div>
      ) : (
        <textarea value={item.prompt} disabled={!editable} onChange={(e) => patchItem(item.id, { prompt: e.target.value })} rows={5} aria-label="Prompt sceny" className={area} />
      )}

      {editable ? (
        <div className="flex items-center gap-2">
          {!info ? (
            <Select value={item.duration} onChange={(v) => patchItem(item.id, { duration: Number(v) })} className="w-[76px]">
              {model.durations.map((d) => (
                <option key={d} value={d}>
                  {d} s
                </option>
              ))}
            </Select>
          ) : null}
          <SButton variant="primary" className="flex-1" onClick={onGenerate} disabled={!canAccept} data-testid="ai-accept">
            {item.status === "failed" ? <RefreshCw /> : <Check />}
            {item.status === "failed" ? "Spróbuj ponownie" : info ? "Akceptuj i utwórz infografikę" : "Akceptuj i generuj"}
          </SButton>
        </div>
      ) : null}
      {item.status === "generating" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-sky-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {info ? (item.illustration && ai.higgsfield ? "Tworzę infografikę z ilustracją AI… zwykle do minuty." : "Tworzę infografikę…") : "Higgsfield generuje scenę… zwykle 1–4 min. Możesz dalej edytować."}
        </p>
      ) : null}
      {item.status === "done" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-emerald-300" data-testid="ai-done">
          {info ? <BarChart3 className="h-3.5 w-3.5" /> : <Clapperboard className="h-3.5 w-3.5" />} Wstawiono na osi czasu jako {info ? "infografika (warstwa obrazu)" : "warstwa wideo"}.
        </p>
      ) : null}
      {item.warning ? <p className="text-[11.5px] text-amber-300">{item.warning}</p> : null}
      {item.status === "failed" && item.error ? <p className="text-[11.5px] text-red-300">{item.error}</p> : null}
    </div>
  );
}
