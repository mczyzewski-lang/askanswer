"use client";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Check, Clapperboard, ImageIcon, Loader2, Plus, RefreshCw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import type { AiBrollItem, AssetInfo, EditorDocument, VideoOverlay } from "@/lib/editor/types";
import { docDuration, formatShort, timedSegments } from "@/lib/editor/timeline";
import { uid } from "@/lib/editor/id";
import { infographicOverlay as buildInfographicOverlay } from "@/lib/editor/ai-overlays";
import { cn } from "@/lib/utils";
import { useStudio } from "./store";
import { Section, Seg, Select, SButton, TextField } from "./controls";
import type { PlaybackEngine } from "./playback";

export interface AiConfig {
  higgsfield: boolean;
  claude: boolean;
  openai?: boolean;
  openaiHint?: string | null;
  models: Array<{ id: string; label: string; description: string; durations: number[] }>;
  defaultModel: string;
}

export interface AutoVisualsJob {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | string;
  error: string | null;
  result: { placed?: number; proposed?: number; skipped?: string; engine?: string; warnings?: string[] } | null;
  updatedAt: string;
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

const isInfographic = (i: AiBrollItem) => i.kind === "infographic";
const isIllustration = (i: AiBrollItem) => i.kind === "illustration";
/** still image layers (infographic / illustration) vs. video scenes */
const isImage = (i: AiBrollItem) => isInfographic(i) || isIllustration(i);

/** Background of a template infographic: none, Higgsfield or OpenAI illustration (only providers that are set up). */
function bgSource(item: AiBrollItem, ai: AiConfig): "none" | "higgsfield" | "openai" {
  if (!item.illustration) return "none";
  const want = item.illustrationSource ?? (ai.openai ? "openai" : "higgsfield");
  if (want === "openai") return ai.openai ? "openai" : ai.higgsfield ? "higgsfield" : "none";
  return ai.higgsfield ? "higgsfield" : ai.openai ? "openai" : "none";
}

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
          const job = (await res.json().catch(() => null)) as { status: string; error?: string | null; warning?: string | null; assets?: AssetInfo[]; result?: { variantIds?: string[] } | null } | null;
          if (!job) continue;
          if (job.status === "FAILED") patchItem(itemId, { status: "failed", error: (job.error ?? "Generowanie nie powiodło się").slice(0, 900) });
          if (job.status === "SUCCEEDED" && job.assets?.[0]) {
            const asset = job.assets[0];
            const variants = job.result?.variantIds && job.result.variantIds.length > 1 ? job.result.variantIds : undefined;
            const st = useStudio.getState();
            st.addAssets(job.assets);
            st.apply((d) => {
              const item = items(d).find((i) => i.id === itemId);
              if (!item || item.status !== "generating") return d;
              const ov = isImage(item) ? buildInfographicOverlay(item, asset.id, docDuration(d)) : brollOverlay(item, asset, docDuration(d));
              return {
                ...d,
                // below the question and other layers; captions are always drawn on top
                overlays: [ov, ...d.overlays],
                meta: { ...d.meta, aiBroll: items(d).map((i) => (i.id === itemId ? { ...i, status: "done" as const, overlayId: ov.id, error: null, warning: job.warning ?? null, variants } : i)) },
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

export function AiPanel({
  engine,
  compositionId,
  ai,
  autoJob = null,
  onAutoStarted,
}: {
  engine: PlaybackEngine | null;
  compositionId: string;
  ai: AiConfig;
  autoJob?: AutoVisualsJob | null;
  onAutoStarted?: (job: AutoVisualsJob | null) => void;
}) {
  const doc = useStudio((s) => s.doc)!;
  const time = useStudio((s) => s.time);
  const apply = useStudio((s) => s.apply);
  const [model, setModel] = useState(ai.defaultModel);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [engineUsed, setEngineUsed] = useState<string | null>(null);
  const [styled, setStyled] = useState<boolean | null>(null);
  const [custom, setCustom] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; message: string; openai?: { ok: boolean; message: string }; claude?: string } | "busy" | null>(null);
  const runCheck = async () => {
    setCheck("busy");
    try {
      setCheck((await readJson(await fetch("/api/admin/ai/check", { method: "POST" }))) as { ok: boolean; message: string; openai?: { ok: boolean; message: string }; claude?: string });
    } catch (e) {
      setCheck({ ok: false, message: (e as Error).message });
    }
  };
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const runAuto = async () => {
    setAutoErr(null);
    try {
      const data = await readJson(await fetch(`/api/admin/compositions/${compositionId}/auto-visuals`, { method: "POST" }));
      onAutoStarted?.((data.autoVisualsJob as AutoVisualsJob | null) ?? null);
    } catch (e) {
      setAutoErr((e as Error).message);
    }
  };
  const autoBusy = autoJob?.status === "QUEUED" || autoJob?.status === "RUNNING";
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
          aiBroll: [...items(d).filter((i) => i.status !== "suggested"), ...sugg.map((s) => ({ ...s, id: uid("ai"), duration: snap(s.duration ?? 5), model: modelInfo.id, illustration: ai.higgsfield || !!ai.openai, illustrationSource: ai.openai ? ("openai" as const) : ("higgsfield" as const), engine: ai.openai ? ("openai" as const) : ("template" as const), status: "suggested" as const }))],
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
      if (isIllustration(item)) {
        const data = await readJson(
          await fetch(`/api/admin/compositions/${compositionId}/broll/infographic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              engine: "illustration",
              imagePrompt: item.imagePrompt || item.prompt,
              passage: item.passage || item.quote || null,
              focus: item.quote || null,
              // what the other illustrations of this video show, so this one looks different
              others: items(doc)
                .filter((o) => o.id !== item.id && isIllustration(o) && o.quote)
                .map((o) => o.quote.slice(0, 190))
                .slice(0, 8),
              title: item.title,
              start: item.start,
            }),
          }),
        );
        patchItem(item.id, { jobId: String(data.jobId) });
        return;
      }
      if (isInfographic(item)) {
        const info = item.infographic ?? defaultInfographic(item);
        const data = await readJson(
          await fetch(`/api/admin/compositions/${compositionId}/broll/infographic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              infographic: { headline: info.headline, items: info.items.filter((r) => r.value.trim() || r.label.trim()), note: info.note || null },
              imagePrompt: bgSource(item, ai) !== "none" && item.imagePrompt ? item.imagePrompt : null,
              illustration: bgSource(item, ai),
              engine: (item.engine ?? (ai.openai ? "openai" : "template")) === "openai" && ai.openai ? "openai" : "template",
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
          AI czyta całą wypowiedź eksperta i proponuje do jej głównych myśli ilustracje (OpenAI), sceny wideo (Higgsfield) lub infografiki z liczbami — w stylu kategorii i kolorach motywu. Zaakceptowany element trafia na pełny ekran w tym fragmencie; głos eksperta, pytanie i napisy zostają na wierzchu.
        </p>
        {!ai.higgsfield ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            Higgsfield nie jest podłączony, więc generowanie wideo jest wyłączone. Dodaj zmienną <code>HIGGSFIELD_CREDENTIALS</code> = <code>KEY_ID:KEY_SECRET</code> w Railway → Variables. Infografiki działają bez niego.
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <SButton variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={runCheck} disabled={check === "busy"} data-testid="ai-check">
            {check === "busy" ? <Loader2 className="animate-spin" /> : null} Sprawdź połączenia (Higgsfield, OpenAI, Claude)
          </SButton>
        </div>
        {check && check !== "busy" ? (
          <p className={cn("rounded-lg px-3 py-2 text-[12px]", check.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300")} data-testid="ai-check-result">
            {check.message}
            {"openai" in check && check.openai ? <span className="mt-1 block">{(check.openai as { message: string }).message}</span> : null}
            {"claude" in check && check.claude ? <span className="mt-1 block">{String(check.claude)}</span> : null}
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

      <Section title="Automatyczne ilustracje">
        <p className="text-[12px] leading-snug text-studio-muted">
          Po przetworzeniu nagrania AI czyta całą wypowiedź, wybiera jej główne myśli i osadza pod napisami pełnoekranowe ilustracje tych myśli (OpenAI, kolory motywu, styl kategorii) — a infografikę tylko tam, gdzie padają liczby lub kroki.
        </p>
        {!ai.openai ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200" data-testid="openai-hint">
            Ilustracje są wyłączone: {ai.openaiHint ?? "brak klucza OPENAI_API_KEY."}
          </p>
        ) : null}
        <AutoStatus job={autoJob} />
        <SButton className="w-full" onClick={runAuto} disabled={autoBusy} data-testid="auto-visuals-run">
          {autoBusy ? <Loader2 className="animate-spin" /> : <BarChart3 />}
          {autoBusy ? "AI rysuje ilustracje…" : autoJob?.status === "SUCCEEDED" && (autoJob.result?.placed ?? 0) > 0 ? "Dodaj kolejne ilustracje" : "Osadź ilustracje teraz"}
        </SButton>
        {autoErr ? <p className="text-[12px] text-red-300">{autoErr}</p> : null}
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
  const illu = isIllustration(item);
  const canIllustrate = !!ai.openai || ai.higgsfield;
  const content = item.infographic ?? defaultInfographic(item);
  const setInfo = (patch: Partial<typeof content>) => patchItem(item.id, (it) => ({ infographic: { ...(it.infographic ?? defaultInfographic(it)), ...patch } }));
  const area = "w-full resize-y rounded-lg border border-studio-line bg-studio-2 px-2 py-1.5 text-[11.5px] leading-snug text-studio-text outline-none focus:border-white/30 disabled:opacity-70";
  const canAccept = illu
    ? canIllustrate && (item.imagePrompt ?? "").trim().length >= 5
    : info
      ? content.headline.trim().length > 0 && content.items.some((r) => r.value.trim() || r.label.trim())
      : canGenerate && item.prompt.trim().length >= 5;
  return (
    <div className={cn("space-y-2 rounded-xl border p-3", item.status === "done" ? "border-emerald-500/40 bg-emerald-500/5" : "border-studio-line bg-studio-3/40")} data-testid="ai-item" data-kind={illu ? "illustration" : info ? "infographic" : "video"}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSeek} className="shrink-0 rounded-md bg-studio-3 px-1.5 py-0.5 font-mono text-[11px] text-studio-text hover:bg-studio-line" title="Przejdź do tego miejsca">
          {formatShort(item.start)}–{formatShort(item.end)}
        </button>
        <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">
          {illu ? <ImageIcon className="mr-1 inline h-3.5 w-3.5 text-studio-muted" /> : info ? <BarChart3 className="mr-1 inline h-3.5 w-3.5 text-studio-muted" /> : <Clapperboard className="mr-1 inline h-3.5 w-3.5 text-studio-muted" />}
          {item.title}
        </p>
        <button type="button" onClick={onRemove} className="rounded p-0.5 text-studio-muted hover:text-studio-text" aria-label={item.status === "done" ? "Usuń z wideo" : "Odrzuć"} title={item.status === "done" ? "Usuń z wideo" : "Odrzuć"}>
          {item.status === "done" ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
      {item.quote ? <p className="text-[11.5px] italic leading-snug text-studio-muted">„{item.quote}”</p> : null}
      {item.reason && item.reason !== "Własna scena" ? <p className="text-[11.5px] leading-snug text-studio-muted">{item.reason}</p> : null}
      {editable ? (
        <Seg<"illustration" | "video" | "infographic">
          value={illu ? "illustration" : info ? "infographic" : "video"}
          onChange={(k) =>
            patchItem(item.id, (it) => ({
              kind: k,
              ...(k === "infographic" && !it.infographic ? { infographic: defaultInfographic(it) } : {}),
              ...(k === "illustration" && !it.imagePrompt ? { imagePrompt: it.prompt } : {}),
            }))
          }
          options={[
            ["illustration", "Ilustracja"],
            ["video", "Wideo AI"],
            ["infographic", "Infografika"],
          ]}
        />
      ) : null}

      {illu ? (
        <div className="space-y-1.5">
          <p className="text-[11px] leading-snug text-studio-muted">Pełnoekranowa ilustracja myśli z tego fragmentu — w kolorach motywu i stylu kategorii, bez tekstu, pod napisami.</p>
          <textarea value={item.imagePrompt ?? ""} disabled={!editable} onChange={(e) => patchItem(item.id, { imagePrompt: e.target.value })} rows={4} aria-label="Co przedstawia ilustracja" className={area} />
          {item.passage ? (
            <details className="text-[11px] text-studio-muted">
              <summary className="cursor-pointer">Fragment wypowiedzi, który ilustruje</summary>
              <p className="mt-1 leading-snug">„{item.passage}”</p>
            </details>
          ) : null}
          {!canIllustrate ? <p className="text-[11.5px] text-amber-300">Ilustracje wymagają klucza OpenAI. {ai.openaiHint ?? ""}</p> : null}
        </div>
      ) : info ? (
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
          <div className="space-y-1">
            <p className="text-[11px] text-studio-muted">Wykonanie</p>
            <Seg<"template" | "openai">
              value={(item.engine ?? (ai.openai ? "openai" : "template")) === "openai" && ai.openai ? "openai" : "template"}
              onChange={(v) => editable && patchItem(item.id, { engine: v })}
              options={[
                ["template", "Szablon (ostry tekst)"],
                ...(ai.openai ? ([["openai", "Cała grafika z OpenAI"]] as Array<["openai", string]>) : []),
              ]}
            />
            {(item.engine ?? (ai.openai ? "openai" : "template")) === "openai" && ai.openai ? (
              <p className="text-[11px] leading-snug text-studio-muted">OpenAI rysuje całą infografikę z tym tekstem, w kolorach motywu i stylu kategorii. Sprawdź pisownię na gotowej grafice.</p>
            ) : null}
          </div>
          {(item.engine ?? (ai.openai ? "openai" : "template")) === "openai" && ai.openai ? null : (
            <div className="space-y-1">
              <p className="text-[11px] text-studio-muted">Tło infografiki</p>
              <Seg<"none" | "higgsfield" | "openai">
                value={bgSource(item, ai)}
                onChange={(v) => editable && patchItem(item.id, v === "none" ? { illustration: false } : { illustration: true, illustrationSource: v })}
                options={[
                  ["none", "Motyw"],
                  ...(ai.higgsfield ? ([["higgsfield", "Higgsfield"]] as Array<["higgsfield", string]>) : []),
                  ...(ai.openai ? ([["openai", "OpenAI"]] as Array<["openai", string]>) : []),
                ]}
              />
              {bgSource(item, ai) !== "none" ? (
                <textarea value={item.imagePrompt ?? ""} disabled={!editable} onChange={(e) => patchItem(item.id, { imagePrompt: e.target.value })} rows={3} aria-label="Prompt ilustracji" className={area} />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <textarea value={item.prompt} disabled={!editable} onChange={(e) => patchItem(item.id, { prompt: e.target.value })} rows={5} aria-label="Prompt sceny" className={area} />
      )}

      {editable ? (
        <div className="flex items-center gap-2">
          {!info && !illu ? (
            <Select value={item.duration} onChange={(v) => patchItem(item.id, { duration: Number(v) })} className="w-[76px]">
              {model.durations.map((d) => (
                <option key={d} value={d}>
                  {d} s
                </option>
              ))}
            </Select>
          ) : null}
          <SButton
            variant="primary"
            className="flex-1"
            onClick={onGenerate}
            disabled={!canAccept}
            data-testid="ai-accept"
            title={!info && !illu && !canGenerate ? "Higgsfield nie jest podłączony (HIGGSFIELD_CREDENTIALS w Railway)" : undefined}
          >
            {item.status === "failed" ? <RefreshCw /> : <Check />}
            {item.status === "failed" ? "Spróbuj ponownie" : illu ? "Akceptuj i narysuj ilustrację" : info ? "Akceptuj i utwórz infografikę" : "Akceptuj i generuj"}
          </SButton>
        </div>
      ) : null}
      {editable && !info && !illu && !canGenerate ? (
        <p className="text-[11.5px] text-amber-300">Generowanie wideo jest wyłączone: brak klucza Higgsfield. Możesz przełączyć tę propozycję na „Ilustracja” lub „Infografika”.</p>
      ) : null}
      {item.status === "generating" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-sky-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {illu ? "Rysuję ilustrację… zwykle do minuty." : info ? ((item.engine ?? (ai.openai ? "openai" : "template")) === "openai" && ai.openai ? "OpenAI rysuje infografikę… zwykle do minuty." : bgSource(item, ai) !== "none" ? "Tworzę infografikę z ilustracją AI… zwykle do minuty." : "Tworzę infografikę…") : "Higgsfield generuje scenę… zwykle 1–4 min. Możesz dalej edytować."}
        </p>
      ) : null}
      {item.status === "done" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-emerald-300" data-testid="ai-done">
          {illu ? <ImageIcon className="h-3.5 w-3.5" /> : info ? <BarChart3 className="h-3.5 w-3.5" /> : <Clapperboard className="h-3.5 w-3.5" />} Wstawiono na osi czasu jako {illu ? "ilustracja (warstwa obrazu pod napisami)" : info ? "infografika (warstwa obrazu)" : "warstwa wideo"}.
        </p>
      ) : null}
      {item.status === "done" && item.variants && item.variants.length > 1 ? <VariantPicker item={item} /> : null}
      {item.warning ? <p className="text-[11.5px] text-amber-300">{item.warning}</p> : null}
      {item.status === "failed" && item.error ? <p className="text-[11.5px] text-red-300">{item.error}</p> : null}
    </div>
  );
}

function AutoStatus({ job }: { job: AutoVisualsJob | null }) {
  if (!job) return <p className="text-[11.5px] text-studio-muted" data-testid="auto-visuals-status">To nagranie nie miało jeszcze automatycznych ilustracji.</p>;
  if (job.status === "QUEUED" || job.status === "RUNNING") return <p className="text-[11.5px] text-studio-muted" data-testid="auto-visuals-status">Trwa generowanie (do ok. minuty na grafikę)…</p>;
  if (job.status === "FAILED") return <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-300" data-testid="auto-visuals-status">Nie udało się: {job.error ?? "nieznany błąd"}</p>;
  const r = job.result ?? {};
  const skipped =
    r.skipped === "no transcript" ? "Brak napisów — najpierw wygeneruj transkrypcję w zakładce „Napisy”." : r.skipped === "disabled" ? "Wyłączone w ustawieniach projektu (Automatyczne infografiki)." : r.skipped ? null : null;
  return (
    <div className="space-y-1" data-testid="auto-visuals-status">
      {skipped ? <p className="text-[12px] text-amber-200">{skipped}</p> : null}
      {!r.skipped ? (
        <p className="text-[11.5px] text-emerald-300">
          Dodano {r.placed ?? 0} {(r.placed ?? 0) === 1 ? "grafikę" : "grafik(i)"}
          {r.engine === "illustration" ? " — ilustracje myśli" : r.engine === "openai" ? " (OpenAI)" : r.engine === "template" ? " (szablon motywu)" : ""}.
        </p>
      ) : null}
      {(r.warnings ?? []).map((w) => (
        <p key={w} className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11.5px] text-amber-200">
          {w}
        </p>
      ))}
    </div>
  );
}

/** Illustration drawn in several variants: pick the one shown on the timeline. */
function VariantPicker({ item }: { item: AiBrollItem }) {
  const assets = useStudio((s) => s.assets);
  const current = useStudio((s) => {
    const o = s.doc?.overlays.find((x) => x.id === item.overlayId);
    return o && o.kind === "image" ? (o.assetId ?? null) : null;
  });
  const choose = (assetId: string) =>
    useStudio.getState().apply((d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === item.overlayId && o.kind === "image" ? { ...o, assetId } : o)) }), `variant:${item.id}`);
  return (
    <div className="space-y-1" data-testid="ai-variants">
      <p className="text-[11px] text-studio-muted">Wybierz wariant ({item.variants!.length}):</p>
      <div className="grid grid-cols-3 gap-1.5">
        {item.variants!.map((id, i) => {
          const a = assets[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              aria-label={`Wariant ${i + 1}`}
              aria-pressed={current === id}
              data-testid="ai-variant"
              className={cn("overflow-hidden rounded-md border-2 bg-studio-3", current === id ? "border-emerald-400" : "border-transparent hover:border-white/30")}
            >
              {a ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" />
              ) : (
                <div className="aspect-[9/16] w-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
