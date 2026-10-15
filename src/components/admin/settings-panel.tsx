"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, NativeSelect, Switch, Textarea } from "@/components/ui";
import { api } from "@/lib/utils";
import type { PanelProps } from "./project-view";
import { VoicePicker } from "@/components/voice-picker";

interface VoiceList {
  configured: boolean;
  error?: string;
  defaultVoiceId: string;
  model: string;
  voices: Array<{ id: string; name: string; labels: Record<string, string>; previewUrl: string | null }>;
}

export function SettingsPanel({ data, refresh, toast }: PanelProps) {
  const router = useRouter();
  const p = data.project;
  const [form, setForm] = useState({
    name: p.name,
    description: p.description ?? "",
    recordingMode: p.recordingMode,
    sequential: p.sequential,
    questionVisibility: p.questionVisibility,
    questionSeconds: p.questionSeconds,
    voiceId: p.voiceId ?? "",
    ttsModel: p.ttsModel ?? "",
  });
  const [voices, setVoices] = useState<VoiceList | null>(null);
  useEffect(() => {
    void api<VoiceList>("/api/admin/voices").then(setVoices, () => setVoices(null));
  }, []);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <p className="font-medium">Projekt</p>
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Nazwa</Label>
          <Input id="s-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-desc">Opis</Label>
          <Textarea id="s-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-mode">Tryb nagrywania</Label>
          <NativeSelect id="s-mode" value={form.recordingMode} onChange={(e) => set("recordingMode", e.target.value as typeof form.recordingMode)}>
            <option value="CONTINUOUS">A — Ciągły wywiad (kamera nagrywa reakcję podczas pytania)</option>
            <option value="ANSWER_ONLY">B — Tylko odpowiedź (najpierw pytanie, potem 3‑2‑1)</option>
          </NativeSelect>
          <p className="text-xs text-muted">W trybie A mikrofon jest wyciszany podczas lektora, a głos ElevenLabs trafia na osobną ścieżkę. Gdy odtwarzanie się nie powiedzie, aplikacja automatycznie przejdzie do trybu B.</p>
        </div>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Kolejność nagrywania wymuszona
            <span className="block text-xs text-muted">Ekspert nagrywa pytania po kolei.</span>
          </span>
          <Switch checked={form.sequential} onCheckedChange={(v) => set("sequential", v)} />
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="s-vis">Widoczność pytania na wideo</Label>
          <NativeSelect id="s-vis" value={form.questionVisibility} onChange={(e) => set("questionVisibility", e.target.value as typeof form.questionVisibility)}>
            <option value="FULL">Przez cały film (domyślnie)</option>
            <option value="NARRATION_ONLY">Tylko podczas czytania pytania</option>
            <option value="FIRST_SECONDS">Przez pierwsze sekundy odpowiedzi</option>
          </NativeSelect>
        </div>
        {form.questionVisibility === "FIRST_SECONDS" ? (
          <div className="space-y-1.5">
            <Label htmlFor="s-sec">Liczba sekund</Label>
            <Input id="s-sec" type="number" min={1} max={60} value={form.questionSeconds} onChange={(e) => set("questionSeconds", Number(e.target.value))} />
          </div>
        ) : null}
        <p className="text-xs text-muted">Ustawienia widoczności dotyczą nowych kompozycji. Istniejące filmy edytujesz w Studio.</p>
      </Card>
      <div className="space-y-6">
        <Card className="space-y-4 p-5">
          <p className="font-medium">Lektor ElevenLabs</p>
          {!voices?.configured ? (
            <p className="text-sm text-amber-700">Ustaw ELEVENLABS_API_KEY w pliku .env, aby wybrać głos z konta ElevenLabs. Możesz też wpisać identyfikator głosu ręcznie.</p>
          ) : voices.error ? (
            <p className="text-sm text-red-600">{voices.error}</p>
          ) : null}
          <div className="space-y-1.5">
            <Label>Głos</Label>
            <VoicePicker value={form.voiceId} onChange={(v) => set("voiceId", v)} modelId={form.ttsModel || null} allowDefault />
            <p className="text-xs text-muted">„Odsłuchaj” odtwarza krótką polską próbkę wybranym głosem i modelem.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-model">Model TTS</Label>
            <NativeSelect id="s-model" value={form.ttsModel} onChange={(e) => set("ttsModel", e.target.value)}>
              <option value="">Domyślny ({voices?.model ?? "eleven_multilingual_v2"})</option>
              <option value="eleven_multilingual_v2">eleven_multilingual_v2 — najlepsza jakość PL</option>
              <option value="eleven_flash_v2_5">eleven_flash_v2_5 — szybki, niski koszt</option>
              <option value="eleven_turbo_v2_5">eleven_turbo_v2_5</option>
              <option value="eleven_v3">eleven_v3</option>
            </NativeSelect>
          </div>
          <p className="text-xs text-muted">Wygenerowane nagrania pytań są zapisywane w pamięci podręcznej — ten sam tekst i głos nie są syntezowane ponownie.</p>
        </Card>
        <Card className="space-y-3 p-5">
          <p className="font-medium">Motyw i branding</p>
          <p className="text-sm text-muted">
            Aktualny motyw: <b className="text-ink">{p.themeName ?? "domyślny"}</b>. Zmiany kolorów i czcionek aktualizują wszystkie filmy projektu.
          </p>
          <Link href={`/admin/themes?theme=${p.themeId ?? ""}`} className="inline-flex text-sm font-medium text-brand">
            Edytuj motyw →
          </Link>
        </Card>
        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={async () => {
              try {
                await api(`/api/admin/projects/${p.id}`, {
                  method: "PATCH",
                  json: { ...form, description: form.description || null, voiceId: form.voiceId || null, ttsModel: form.ttsModel || null },
                });
                toast("Zapisano ustawienia");
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            Zapisz ustawienia
          </Button>
          <Button
            variant="outline"
            className="text-red-600"
            onClick={async () => {
              if (!confirm("Usunąć cały projekt wraz z pytaniami i montażami? Tej operacji nie można cofnąć.")) return;
              await api(`/api/admin/projects/${p.id}`, { method: "DELETE" });
              router.push("/admin");
            }}
          >
            Usuń projekt
          </Button>
        </div>
      </div>
    </div>
  );
}
