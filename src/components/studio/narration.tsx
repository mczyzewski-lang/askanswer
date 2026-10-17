"use client";
import { useEffect, useRef, useState } from "react";
import { TTS_MODELS } from "@/lib/tts-models";
import { Loader2, RefreshCw } from "lucide-react";
import type { AudioClip } from "@/lib/editor/types";
import { VoicePicker } from "@/components/voice-picker";
import { useStudio } from "./store";
import { Row, Select, SButton, Slider } from "./controls";
import { retimeNarration, withNarrationSubtitles } from "@/lib/editor/timeline";

/**
 * Change the ElevenLabs narrator of this video: pick a voice (collections / all / own ID),
 * listen to a sample and regenerate the question narration. The new audio replaces the
 * narration clip in place (position and volume are kept) and is cached per voice.
 */
export function NarrationVoiceChanger({ questionText, initialVoiceId }: { questionText?: string | null; initialVoiceId?: string | null }) {
  const compositionId = useStudio((s) => s.compositionId);
  const doc = useStudio((s) => s.doc)!;
  const assets = useStudio((s) => s.assets);
  const current = doc.narration[0];
  const [voice, setVoice] = useState<string>(initialVoiceId || (current ? (assets[current.assetId]?.voiceId ?? "") : ""));
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const currentVoice = current ? assets[current.assetId]?.voiceId : null;

  const regenerate = async () => {
    if (!voice) return setMsg({ text: "Wybierz głos", ok: false });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/compositions/${compositionId}/narration`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // the server picks the text: the narrator's question (spokenText), else the title
        body: JSON.stringify({ voiceId: voice, modelId: model || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nie udało się wygenerować lektora");
      const st = useStudio.getState();
      st.addAssets([data]);
      const prevSpeed = st.doc?.narration[0]?.speed ?? 1;
      st.apply((d) => {
        const dur = data.durationSec ?? 3;
        if (d.narration.length)
          return { ...d, narration: d.narration.map((n, i) => (i === 0 ? { ...n, assetId: data.id, sourceIn: 0, sourceOut: dur, muted: false, speed: undefined, baseAssetId: undefined } : n)) };
        const clip: AudioClip = { id: `aud_${Date.now()}`, assetId: data.id, kind: "narration", start: 0, sourceIn: 0, sourceOut: dur, volume: 1, muted: false, fadeIn: 0, fadeOut: 0.05, label: "Lektor ElevenLabs" };
        return { ...d, narration: [clip] };
      });
      // the new voice keeps the chosen tempo
      const n0 = useStudio.getState().doc?.narration[0];
      if (n0 && Math.abs(prevSpeed - 1) > 0.005) await applyNarrationSpeed(compositionId, n0.id, prevSpeed);
      setMsg({ text: "Lektor zmieniony — odtwórz, aby posłuchać", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5" data-testid="narration-changer">
      <VoicePicker dark value={voice} onChange={setVoice} modelId={model || null} previewText={questionText ?? undefined} />
      <Row label="Model">
        <Select value={model} onChange={setModel}>
          <option value="">Domyślny projektu</option>
          {TTS_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>
      <SButton variant="primary" className="w-full" disabled={busy || !voice} onClick={regenerate}>
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {current ? (voice && voice === currentVoice && !model ? "Wygeneruj ponownie" : "Zmień lektora") : "Dodaj lektora"}
      </SButton>
      {msg ? <p className={msg.ok ? "text-[12px] text-emerald-300" : "text-[12px] text-red-300"}>{msg.text}</p> : null}
    </div>
  );
}

/** Re-time a narration clip (pitch kept) and fit the timeline to it. */
export async function applyNarrationSpeed(compositionId: string, clipId: string, speed: number) {
  const st = useStudio.getState();
  const clip = st.doc?.narration.find((n) => n.id === clipId);
  if (!clip) return;
  const baseAssetId = clip.baseAssetId ?? clip.assetId;
  const res = await fetch(`/api/admin/compositions/${compositionId}/narration-speed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseAssetId, speed }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Nie udało się zmienić tempa lektora");
  const now = useStudio.getState();
  now.addAssets([data]);
  const srcDur = (id: string) => now.assets[id]?.durationSec ?? Number.POSITIVE_INFINITY;
  now.apply((d) => retimeNarration(d, clipId, { assetId: data.id, duration: data.durationSec ?? 0, baseAssetId, speed }, srcDur), `narr-speed:${clipId}`);
}

/**
 * "Tempo lektora": a slow narrator × 1.15 — the question ends sooner and the listening part / intro
 * on the timeline is shortened to match (the answer moves up).
 */
export function NarrationSpeed({ clipId }: { clipId?: string }) {
  const compositionId = useStudio((s) => s.compositionId);
  const clip = useStudio((s) => (clipId ? s.doc?.narration.find((n) => n.id === clipId) : s.doc?.narration[0]));
  const [value, setValue] = useState(clip?.speed ?? 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setValue(clip?.speed ?? 1), [clip?.speed]);
  if (!clip) return null;
  const change = (v: number) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        await applyNarrationSpeed(compositionId, clip.id, v);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 350);
  };
  return (
    <div className="space-y-1" data-testid="narration-speed">
      <Row label={`Tempo lektora: ${value.toFixed(2).replace(".", ",")}×${busy ? " …" : ""}`}>
        <Slider value={value} min={0.9} max={1.4} step={0.05} onChange={change} format={(v) => `${v.toFixed(2)}×`} aria-label="Tempo lektora" />
      </Row>
      <p className="text-[11.5px] text-studio-muted">Wysokość głosu bez zmian. „Słuchanie pytania” na osi czasu skraca się (lub wydłuża) automatycznie, odpowiedź zaczyna się zaraz po pytaniu.</p>
      {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
    </div>
  );
}

/**
 * The narrator's question in the subtitles: added once per narration file (also for videos made
 * before this existed, and after a voice change). Deleted question subtitles stay deleted.
 */
export function useNarrationSubtitles() {
  const compositionId = useStudio((s) => s.compositionId);
  const n = useStudio((s) => s.doc?.narration[0]);
  const done = useStudio((s) => s.doc?.meta.narrationSubs ?? null);
  const base = n && !n.muted ? (n.baseAssetId ?? n.assetId) : null;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!base || base === done || asked.current === base) return;
    asked.current = base;
    void (async () => {
      const res = await fetch(`/api/admin/compositions/${compositionId}/narration-subtitles`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: base }) }).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (!data?.segments?.length) return;
      const st = useStudio.getState();
      // the narration may have changed meanwhile
      const cur = st.doc?.narration[0];
      if (!cur || (cur.baseAssetId ?? cur.assetId) !== data.baseAssetId) return;
      st.apply((d) => withNarrationSubtitles(d, data.baseAssetId, data.segments), "narration-subs");
    })();
  }, [base, done, compositionId]);
}
