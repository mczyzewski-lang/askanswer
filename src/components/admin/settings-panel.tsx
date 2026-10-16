"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, NativeSelect, Switch, Textarea } from "@/components/ui";
import { api } from "@/lib/utils";
import type { PanelProps } from "./project-view";
import { VoicePicker } from "@/components/voice-picker";
import { ProjectExpertsCard } from "./project-experts-card";
import { FORMAT_LABELS, type ProjectFormat } from "@/lib/project-terms";
import { DEFAULT_TTS_MODEL, TTS_MODELS } from "@/lib/tts-models";

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
    format: p.format,
    dailyQuestionLimit: p.dailyQuestionLimit,
    questionVisibility: p.questionVisibility,
    questionSeconds: p.questionSeconds,
    voiceId: p.voiceId ?? "",
    ttsModel: p.ttsModel ?? "",
    voiceCollectionId: p.voiceCollectionId ?? "",
    naturalFillers: p.naturalFillers,
    autoInfographics: p.autoInfographics,
    autoBlur: p.autoBlur,
    autoVoice: p.autoVoice,
    autoZooms: p.autoZooms,
    autoImageEnhance: p.autoImageEnhance,
  });
  const [voices, setVoices] = useState<VoiceList | null>(null);
  const [collections, setCollections] = useState<Array<{ id: string; name: string; items: unknown[] }>>([]);
  useEffect(() => {
    void api<VoiceList>("/api/admin/voices").then(setVoices, () => setVoices(null));
    void api<Array<{ id: string; name: string; items: unknown[] }>>("/api/admin/voice-collections").then(setCollections, () => setCollections([]));
  }, []);
  const [voiceSource, setVoiceSource] = useState<"fixed" | "collection">(p.voiceCollectionId ? "collection" : "fixed");
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
          <Label htmlFor="s-format">Format projektu</Label>
          <NativeSelect id="s-format" value={form.format} onChange={(e) => set("format", e.target.value as typeof form.format)}>
            {(Object.keys(FORMAT_LABELS) as ProjectFormat[]).map((k) => (
              <option key={k} value={k}>
                {FORMAT_LABELS[k].name} — {FORMAT_LABELS[k].description}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted">W formacie Prompter zamiast pytań są pozycje „Hook + Treść”, a ekspert czyta je z promptera (bez lektora).</p>
        </div>
        {form.format === "ANSWERS" ? (
        <div className="space-y-1.5">
          <Label htmlFor="s-mode">Tryb nagrywania</Label>
          <NativeSelect id="s-mode" value={form.recordingMode} onChange={(e) => set("recordingMode", e.target.value as typeof form.recordingMode)}>
            <option value="CONTINUOUS">A — Ciągły wywiad (kamera nagrywa reakcję podczas pytania)</option>
            <option value="ANSWER_ONLY">B — Tylko odpowiedź (najpierw pytanie, potem 3‑2‑1)</option>
          </NativeSelect>
          <p className="text-xs text-muted">W trybie A mikrofon jest wyciszany podczas lektora, a głos ElevenLabs trafia na osobną ścieżkę. Gdy odtwarzanie się nie powiedzie, aplikacja automatycznie przejdzie do trybu B.</p>
        </div>
        ) : null}
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Kolejność nagrywania wymuszona
            <span className="block text-xs text-muted">Ekspert nagrywa pytania po kolei.</span>
          </span>
          <Switch checked={form.sequential} onCheckedChange={(v) => set("sequential", v)} />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Automatyczne infografiki AI
            <span className="block text-xs text-muted">
              Po przetworzeniu nagrania AI wybiera momenty i od razu osadza w filmie do 3 infografik (OpenAI, gdy jest klucz; inaczej szablon motywu). Sceny wideo zostają propozycjami w zakładce AI.
            </span>
          </span>
          <Switch checked={form.autoInfographics} onCheckedChange={(v) => set("autoInfographics", v)} />
        </label>
        <div className="space-y-3 rounded-xl border border-line p-3" data-testid="auto-polish-settings">
          <p className="text-sm font-medium">
            Automatycznie w każdym nowym filmie
            <span className="block text-xs font-normal text-muted">Od razu po wgraniu i przetworzeniu nagrania, w tle — tak jak ilustracje. Każdą rzecz można potem zmienić lub wyłączyć w Studio.</span>
          </p>
          {(
            [
              ["autoBlur", "Rozmyte tło za ekspertem", "Sylwetka jest wykrywana automatycznie; w Studio możesz wyłączyć rozmycie dla wybranych klipów."],
              ["autoVoice", "Głos: podcast + ElevenLabs", "Usunięcie szumów i pogłosu (ElevenLabs Voice Isolator) + mastering „podcast”."],
              ["autoZooms", "Dynamiczne zbliżenia", "Płynne przybliżenia na granicach zdań, jak w montażu reelsów."],
              ["autoImageEnhance", "Magiczna poprawa obrazu", "Automatyczna jasność, kontrast i kolory — jak „Popraw” w iMovie."],
            ] as const
          ).map(([k, label, hint]) => (
            <label key={k} className="flex items-center justify-between gap-4 text-sm">
              <span>
                {label}
                <span className="block text-xs text-muted">{hint}</span>
              </span>
              <Switch checked={form[k]} onCheckedChange={(v) => set(k, v)} aria-label={label} />
            </label>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-daily">Pytań na dziś na liście eksperta</Label>
          <Input id="s-daily" type="number" min={0} max={500} className="w-28" value={form.dailyQuestionLimit} onChange={(e) => set("dailyQuestionLimit", Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          <p className="text-xs text-muted">
            Gdy ekspert ma więcej pytań, codziennie widzi tyle — po równo z każdej kategorii (najpierw te najmniej nagrane), żeby nie nagrywał wszystkiego z jednej. Lista nie zmienia się w ciągu dnia. 0 = cała lista naraz.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-vis">Widoczność {form.format === "PROMPTER" ? "hooka" : "pytania"} na wideo</Label>
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
        <ProjectExpertsCard data={data} refresh={refresh} toast={toast} />
        {form.format === "ANSWERS" ? (
        <Card className="space-y-4 p-5">
          <p className="font-medium">Lektor ElevenLabs</p>
          {!voices?.configured ? (
            <p className="text-sm text-amber-700">Ustaw ELEVENLABS_API_KEY w pliku .env, aby wybrać głos z konta ElevenLabs. Możesz też wpisać identyfikator głosu ręcznie.</p>
          ) : voices.error ? (
            <p className="text-sm text-red-600">{voices.error}</p>
          ) : null}
          <div className="space-y-1.5">
            <Label>Głos lektora</Label>
            <div className="flex gap-1 rounded-xl border border-line p-1 text-sm" role="radiogroup" aria-label="Źródło głosu">
              {(
                [
                  ["fixed", "Jeden głos"],
                  ["collection", "Losowo z kolekcji"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={voiceSource === k}
                  onClick={() => {
                    setVoiceSource(k);
                    if (k === "fixed") set("voiceCollectionId", "");
                    else if (!form.voiceCollectionId && collections[0]) set("voiceCollectionId", collections[0].id);
                  }}
                  className={voiceSource === k ? "flex-1 rounded-lg bg-ink px-3 py-1.5 font-medium text-white" : "flex-1 rounded-lg px-3 py-1.5 text-muted hover:text-ink"}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {voiceSource === "fixed" ? (
            <div className="space-y-1.5">
              <VoicePicker value={form.voiceId} onChange={(v) => set("voiceId", v)} modelId={form.ttsModel || null} allowDefault />
              <p className="text-xs text-muted">„Odsłuchaj” odtwarza krótką polską próbkę wybranym głosem i modelem.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <NativeSelect aria-label="Kolekcja głosów" value={form.voiceCollectionId} onChange={(e) => set("voiceCollectionId", e.target.value)}>
                {collections.length === 0 ? <option value="">Brak kolekcji — utwórz ją w zakładce Głosy</option> : null}
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.items.length} {c.items.length === 1 ? "głos" : c.items.length < 5 ? "głosy" : "głosów"})
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted">
                Każde pytanie dostaje losowy głos z kolekcji — na stałe, więc ponowne nagranie i podgląd mają ten sam głos. Kolekcje tworzysz w zakładce{" "}
                <Link href="/admin/voices" className="font-medium text-brand">
                  Głosy
                </Link>
                .
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="s-model">Model TTS</Label>
            <NativeSelect id="s-model" value={form.ttsModel} onChange={(e) => set("ttsModel", e.target.value)}>
              <option value="">Domyślny serwera ({voices?.model ?? DEFAULT_TTS_MODEL})</option>
              {TTS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Naturalne wtrącenia lektora
              <span className="block text-xs text-muted">Czasem „yyy…”, „mm…” lub „ech…” przed pytaniem albo w środku — delikatnie, przy części pytań. Tekst na wideo zostaje bez zmian.</span>
            </span>
            <Switch checked={form.naturalFillers} onCheckedChange={(v) => set("naturalFillers", v)} aria-label="Naturalne wtrącenia lektora" />
          </label>
          <p className="text-xs text-muted">Wygenerowane nagrania pytań są zapisywane w pamięci podręcznej — ten sam tekst i głos nie są syntezowane ponownie.</p>
        </Card>
        ) : null}
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
                  json: { ...form, description: form.description || null, voiceId: form.voiceId || null, ttsModel: form.ttsModel || null, voiceCollectionId: voiceSource === "collection" ? form.voiceCollectionId || null : null },
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
