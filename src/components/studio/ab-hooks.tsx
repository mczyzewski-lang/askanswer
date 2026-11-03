"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Split, Trash2 } from "lucide-react";
import type { SubtitleSegment, TextOverlay } from "@/lib/editor/types";
import { switchHook, withTitleHooks } from "@/lib/editor/timeline";
import { cn } from "@/lib/utils";
import { useStudio } from "./store";
import { SButton, TextField } from "./controls";

type Idea = { mechanism: string; text: string; source: "ocena" | "nowe" | "własny" };
const MAX_EXTRA = 3;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Nie udało się");
  return data as T;
}

/**
 * A/B test of the hook on this video: the alternatives from the content review (or new ones), each
 * a version of this edit with its own title — and, when the narrator reads the question, its own
 * narration. Versions are switched at the top and exported together ("Renderuj wszystkie wersje hooka").
 */
export function AbHooksSection() {
  const compositionId = useStudio((s) => s.compositionId);
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const apply = useStudio((s) => s.apply);
  const [info, setInfo] = useState<{ narrated: boolean; canGenerate: boolean } | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState<"ideas" | "make" | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const q = doc.overlays.find((o): o is TextOverlay => o.kind === "text" && o.role === "question");
  const hooks = doc.hooks;
  const adsHooks = !!hooks?.clipId;
  const current = hooks && !adsHooks ? (hooks.variants[0]?.title ?? "") : (q?.text ?? doc.meta.questionText);

  useEffect(() => {
    void fetch(`/api/admin/compositions/${compositionId}/hook-ideas`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setInfo({ narrated: d.narrated, canGenerate: d.canGenerate });
        setIdeas(d.ideas ?? []);
        setPicked((d.ideas ?? []).slice(0, 2).map((x: Idea) => x.text));
      })
      .catch(() => {});
  }, [compositionId]);

  if (adsHooks) return null; // Ads Studio edits have their own hook versions (from the script)
  const narr = doc.narration[0];
  const withNarrator = !!info?.narrated && !!narr && !narr.muted;

  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length >= MAX_EXTRA ? p : [...p, t]));
  const generate = async () => {
    setBusy("ideas");
    setMsg(null);
    try {
      const d = await post<{ ideas: Idea[] }>(`/api/admin/compositions/${compositionId}/hook-ideas`, { count: 3 });
      setIdeas((cur) => [...d.ideas, ...cur.filter((x) => !d.ideas.some((y) => y.text === x.text))]);
      setPicked(d.ideas.slice(0, 2).map((x) => x.text));
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  };
  const addOwn = () => {
    const t = own.trim();
    if (t.length < 3) return;
    setIdeas((cur) => [{ mechanism: "własny", text: t, source: "własny" }, ...cur.filter((x) => x.text !== t)]);
    setPicked((p) => (p.includes(t) || p.length >= MAX_EXTRA ? p : [...p, t]));
    setOwn("");
  };

  /** each picked hook: its narration (same voice and tempo as now) and the narration's subtitles */
  const make = async () => {
    if (!picked.length) return;
    setBusy("make");
    setMsg(null);
    try {
      const versions: Parameters<typeof withTitleHooks>[1] = [];
      for (const text of picked) {
        if (!withNarrator) {
          versions.push({ text });
          continue;
        }
        const voiceId = assets[narr.baseAssetId ?? narr.assetId]?.voiceId ?? assets[narr.assetId]?.voiceId ?? undefined;
        const base = await post<{ id: string; durationSec: number | null; voiceId?: string | null }>(`/api/admin/compositions/${compositionId}/narration`, { text, ...(voiceId ? { voiceId } : {}) });
        let audio = base;
        const speed = narr.speed ?? 1;
        if (Math.abs(speed - 1) > 0.005) audio = await post(`/api/admin/compositions/${compositionId}/narration-speed`, { baseAssetId: base.id, speed });
        useStudio.getState().addAssets([base, audio] as never);
        const subs = await post<{ baseAssetId: string; segments: SubtitleSegment[] }>(`/api/admin/compositions/${compositionId}/narration-subtitles`, { assetId: base.id }).catch(() => null);
        versions.push({ text, narration: { assetId: audio.id, duration: audio.durationSec ?? 3, ...(audio.id !== base.id ? { baseAssetId: base.id, speed } : {}), subs: subs?.segments?.length ? subs : null } });
      }
      apply((d) => withTitleHooks(d, versions), "ab-hooks");
      setMsg({ text: `Gotowe: ${versions.length + 1} wersje hooka — przełączasz je u góry, eksport w „Eksport” → „Renderuj wszystkie wersje hooka”.`, ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  };
  const remove = () =>
    apply((d) => {
      const back = d.hooks && d.hooks.active !== 0 ? switchHook(d, 0) : d;
      const { hooks: _h, ...rest } = back;
      void _h;
      return rest;
    }, "ab-hooks");

  return (
    <div className="space-y-2.5" data-testid="ab-hooks">
      <p className="text-[11.5px] leading-snug text-studio-muted">
        {withNarrator
          ? "Każda wersja ma inny napis z pytaniem i własnego lektora (ten sam głos i tempo). Nagranie eksperta się nie zmienia."
          : "Każda wersja ma inny hook na ekranie (napis z pytaniem). Nagranie eksperta się nie zmienia — wypowiedziany hook zostaje."}
      </p>
      <div className="rounded-lg border border-studio-line p-2 text-[12.5px]">
        <span className="text-studio-muted">Hook A (obecny): </span>
        {current || "—"}
      </div>
      {hooks && !adsHooks ? (
        <>
          <ul className="space-y-1 text-[12.5px]" data-testid="ab-hooks-versions">
            {hooks.variants.slice(1).map((v) => (
              <li key={v.id} className="rounded-lg border border-studio-line p-2">
                <span className="text-studio-muted">{v.code}: </span>
                {v.title}
                {v.narration ? <span className="ml-1 text-[11px] text-emerald-300">+ lektor</span> : null}
              </li>
            ))}
          </ul>
          <SButton className="w-full" onClick={remove}>
            <Trash2 /> Usuń test A/B (zostaje hook A)
          </SButton>
        </>
      ) : (
        <>
          {ideas.length ? (
            <ul className="space-y-1">
              {ideas.map((h) => {
                const on = picked.includes(h.text);
                return (
                  <li key={h.text}>
                    <button
                      type="button"
                      onClick={() => toggle(h.text)}
                      aria-pressed={on}
                      data-testid="ab-hook-idea"
                      className={cn("w-full rounded-lg border p-2 text-left text-[12.5px] transition", on ? "border-sky-400 bg-sky-400/10" : "border-studio-line hover:border-studio-muted")}
                    >
                      <span className="mr-1 rounded bg-studio-3 px-1.5 py-0.5 text-[10.5px] text-studio-muted">
                        {h.mechanism || h.source}
                        {h.source === "ocena" ? " · z oceny" : ""}
                      </span>
                      {h.text}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-studio-muted">{info ? "Brak propozycji z oceny — wygeneruj nowe albo wpisz własny hook." : "Wczytuję propozycje…"}</p>
          )}
          <div className="flex gap-1.5">
            <TextField value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOwn()} placeholder="Własny hook…" aria-label="Własny hook" />
            <SButton onClick={addOwn} disabled={own.trim().length < 3} aria-label="Dodaj własny hook">
              <Plus />
            </SButton>
          </div>
          {info?.canGenerate ? (
            <SButton className="w-full" onClick={generate} disabled={!!busy} data-testid="ab-hooks-generate">
              {busy === "ideas" ? <Loader2 className="animate-spin" /> : <Sparkles />} Wygeneruj nowe propozycje
            </SButton>
          ) : null}
          <SButton variant="primary" className="w-full" onClick={make} disabled={!!busy || !picked.length} data-testid="ab-hooks-make">
            {busy === "make" ? <Loader2 className="animate-spin" /> : <Split />} Utwórz wersje A/B ({picked.length + 1})
          </SButton>
        </>
      )}
      {msg ? <p className={msg.ok ? "text-[12px] text-emerald-300" : "text-[12px] text-red-300"}>{msg.text}</p> : null}
    </div>
  );
}
