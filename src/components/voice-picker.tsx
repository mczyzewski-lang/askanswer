"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { VoicePreviewButton } from "./voice-preview";

export interface AccountVoice {
  id: string;
  name: string;
  labels: Record<string, string>;
  previewUrl: string | null;
}
export interface VoiceCollection {
  id: string;
  name: string;
  items: Array<{ id: string; voiceId: string; label: string | null }>;
}
interface VoicesResponse {
  configured: boolean;
  error?: string;
  defaultVoiceId: string;
  model: string;
  voices: AccountVoice[];
}

/** Account voices (ElevenLabs) + the admin's own collections, shared by every voice picker. */
export function useVoiceData() {
  const [voices, setVoices] = useState<VoicesResponse | null>(null);
  const [collections, setCollections] = useState<VoiceCollection[]>([]);
  const reload = useCallback(async () => {
    const [v, c] = await Promise.all([
      fetch("/api/admin/voices").then((r) => r.json()).catch(() => null),
      fetch("/api/admin/voice-collections").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setVoices(v);
    setCollections(Array.isArray(c) ? c : []);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { voices, collections, reload };
}

export function voiceLabel(v: AccountVoice) {
  return [v.name, v.labels?.accent, v.labels?.gender].filter(Boolean).join(" · ");
}

const MODE_KEY = "askby-voice-source";

/**
 * Voice selector with a "Moje kolekcje / Wszystkie głosy" toggle, a star to add the
 * current voice to a collection, and a Polish sample preview.
 */
export function VoicePicker({
  value,
  onChange,
  modelId,
  previewText,
  dark,
  allowDefault,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  modelId?: string | null;
  previewText?: string;
  dark?: boolean;
  allowDefault?: boolean;
}) {
  const { voices, collections, reload } = useVoiceData();
  const [mode, setModeState] = useState<"collections" | "all">("collections");
  const [collectionId, setCollectionId] = useState<string>("");
  const [starOpen, setStarOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "all" || m === "collections") setModeState(m);
    } catch {
      /* ignore */
    }
  }, []);
  const setMode = (m: "collections" | "all") => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const hasCollections = collections.some((c) => c.items.length > 0);
  const effectiveMode = mode === "collections" && !hasCollections ? "all" : mode;
  const activeCollection = collections.find((c) => c.id === collectionId) ?? collections.find((c) => c.items.length > 0) ?? null;
  const byId = new Map((voices?.voices ?? []).map((v) => [v.id, v]));
  const nameOf = (id: string, label?: string | null) => label || (byId.get(id) ? voiceLabel(byId.get(id)!) : id);
  const inCollections = collections.filter((c) => c.items.some((i) => i.voiceId === value));
  const defaultId = voices?.defaultVoiceId ?? "";
  const current = value || defaultId;

  const selectCls = dark
    ? "h-8 w-full rounded-lg border border-studio-line bg-studio-3 px-2 text-[12.5px] text-studio-text outline-none"
    : "h-10 w-full rounded-xl border border-line bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30";
  const segCls = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-2 py-1 text-center transition",
      dark ? "text-[11.5px]" : "text-[12.5px]",
      active ? (dark ? "bg-white text-black" : "bg-ink text-white") : dark ? "text-studio-muted hover:text-studio-text" : "text-muted hover:text-ink",
    );

  const addTo = async (cid: string | null) => {
    let id = cid;
    if (!id) {
      const name = prompt("Nazwa nowej kolekcji:", "Moja kolekcja");
      if (!name) return;
      const res = await fetch("/api/admin/voice-collections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) return setMsg("Nie udało się utworzyć kolekcji");
      id = (await res.json()).id;
    }
    const res = await fetch(`/api/admin/voice-collections/${id}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voiceId: current }) });
    setMsg(res.ok ? "Dodano do kolekcji" : ((await res.json()).error ?? "Błąd"));
    setStarOpen(false);
    await reload();
    setTimeout(() => setMsg(null), 2500);
  };

  if (voices && !voices.configured) {
    return (
      <div className="space-y-1.5">
        <input className={selectCls} placeholder={defaultId || "voice_id"} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Identyfikator głosu" />
        <p className={cn("text-xs", dark ? "text-studio-muted" : "text-amber-700")}>Ustaw ELEVENLABS_API_KEY, aby wybierać głosy z konta ElevenLabs i tworzyć kolekcje.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="voice-picker">
      <div className={cn("flex rounded-lg p-0.5", dark ? "border border-studio-line bg-studio-3" : "bg-black/[.05]")}>
        <button type="button" className={segCls(effectiveMode === "collections")} onClick={() => setMode("collections")} disabled={!hasCollections} title={hasCollections ? undefined : "Nie masz jeszcze kolekcji"}>
          Moje kolekcje
        </button>
        <button type="button" className={segCls(effectiveMode === "all")} onClick={() => setMode("all")}>
          Wszystkie głosy
        </button>
      </div>

      {effectiveMode === "collections" && activeCollection ? (
        <>
          {collections.filter((c) => c.items.length).length > 1 ? (
            <select className={selectCls} value={activeCollection.id} onChange={(e) => setCollectionId(e.target.value)} aria-label="Kolekcja">
              {collections
                .filter((c) => c.items.length)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    Kolekcja: {c.name} ({c.items.length})
                  </option>
                ))}
            </select>
          ) : null}
          <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Głos">
            {allowDefault ? <option value="">Domyślny ({nameOf(defaultId)})</option> : null}
            {value && !activeCollection.items.some((i) => i.voiceId === value) ? <option value={value}>{nameOf(value)} (spoza kolekcji)</option> : null}
            {activeCollection.items.map((i) => (
              <option key={i.id} value={i.voiceId}>
                {nameOf(i.voiceId, i.label)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Głos">
          {allowDefault ? <option value="">Domyślny ({nameOf(defaultId)})</option> : null}
          {value && !byId.has(value) ? <option value={value}>{nameOf(value)}</option> : null}
          {(voices?.voices ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {voiceLabel(v)}
            </option>
          ))}
        </select>
      )}

      <div className="relative flex flex-wrap items-center gap-2">
        <VoicePreviewButton dark={dark} voiceId={current} modelId={modelId} text={previewText} />
        <button
          type="button"
          onClick={() => setStarOpen(!starOpen)}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap px-3 font-medium transition [&_svg]:size-4",
            dark ? "h-8 rounded-lg border border-studio-line bg-studio-3 text-[12.5px] text-studio-text hover:bg-studio-line" : "h-10 rounded-xl border border-line bg-white text-sm hover:bg-black/[.03]",
          )}
          aria-label="Dodaj głos do kolekcji"
        >
          <Star className={cn(inCollections.length && "fill-amber-400 text-amber-400")} />
          {inCollections.length ? "W kolekcji" : "Do kolekcji"}
        </button>
        {starOpen ? (
          <div className={cn("absolute left-0 top-full z-20 mt-1 min-w-56 rounded-xl p-1 shadow-xl", dark ? "border border-studio-line bg-studio-2" : "border border-line bg-white")}>
            {collections.map((c) => {
              const has = c.items.some((i) => i.voiceId === current);
              return (
                <button key={c.id} type="button" disabled={has} onClick={() => addTo(c.id)} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] disabled:opacity-50", dark ? "hover:bg-studio-3" : "hover:bg-black/[.04]")}>
                  {c.name}
                  {has ? <span className="text-xs">✓</span> : null}
                </button>
              );
            })}
            <button type="button" onClick={() => addTo(null)} className={cn("w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium", dark ? "text-sky-300 hover:bg-studio-3" : "text-brand hover:bg-black/[.04]")}>
              + Nowa kolekcja…
            </button>
          </div>
        ) : null}
        <Link href="/admin/voices" className={cn("text-xs", dark ? "text-sky-300 hover:underline" : "text-brand hover:underline")}>
          Zarządzaj głosami →
        </Link>
      </div>
      {msg ? <p className={cn("text-xs", dark ? "text-emerald-300" : "text-emerald-700")}>{msg}</p> : null}
      {voices?.error ? <p className="text-xs text-red-500">{voices.error}</p> : null}
    </div>
  );
}
