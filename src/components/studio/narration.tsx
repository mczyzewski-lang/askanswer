"use client";
import { useState } from "react";
import { TTS_MODELS } from "@/lib/tts-models";
import { Loader2, RefreshCw } from "lucide-react";
import type { AudioClip } from "@/lib/editor/types";
import { VoicePicker } from "@/components/voice-picker";
import { useStudio } from "./store";
import { Row, Select, SButton } from "./controls";

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
      st.apply((d) => {
        const dur = data.durationSec ?? 3;
        if (d.narration.length)
          return { ...d, narration: d.narration.map((n, i) => (i === 0 ? { ...n, assetId: data.id, sourceIn: 0, sourceOut: dur, muted: false } : n)) };
        const clip: AudioClip = { id: `aud_${Date.now()}`, assetId: data.id, kind: "narration", start: 0, sourceIn: 0, sourceOut: dur, volume: 1, muted: false, fadeIn: 0, fadeOut: 0.05, label: "Lektor ElevenLabs" };
        return { ...d, narration: [clip] };
      });
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
