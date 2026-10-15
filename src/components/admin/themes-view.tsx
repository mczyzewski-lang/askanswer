"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Input, Label, NativeSelect, useToast } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { FONT_FAMILIES, THEME_PRESETS, themeFromRow } from "@/lib/themes";
import { ThemePreview } from "./theme-preview";

interface ThemeRow {
  id: string;
  name: string;
  presetKey: string | null;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  questionFont: string;
  subtitleFont: string;
  labelFont: string;
  logoAssetId: string | null;
  logoUrl: string | null;
  projects: Array<{ id: string; name: string }>;
}

const COLORS: Array<[keyof ThemeRow, string, string]> = [
  ["primaryColor", "Kolor główny", "tło pytania, belki"],
  ["accentColor", "Akcent", "dekoracje, callouty"],
  ["secondaryColor", "Kolor dodatkowy", "elementy pomocnicze"],
  ["textColor", "Tekst", "tekst na tle głównym"],
  ["highlightColor", "Podświetlenie napisów", "aktywne słowo"],
  ["backgroundColor", "Tło", "plansze i przerwy"],
];

export function ThemesView({ themes, initialId }: { themes: ThemeRow[]; initialId: string | null }) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [id, setId] = useState(initialId);
  const current = themes.find((t) => t.id === id) ?? themes[0];
  const [draft, setDraft] = useState<ThemeRow | null>(current ?? null);
  const [lastId, setLastId] = useState(current?.id);
  if (current && current.id !== lastId) {
    setLastId(current.id);
    setDraft(current);
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const tokens = useMemo(() => (draft ? themeFromRow(draft) : null), [draft]);
  if (!current || !draft || !tokens) return <EmptyState title="Brak motywów projektów">Motyw jest tworzony automatycznie razem z projektem.</EmptyState>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

  const save = async (extra?: Record<string, unknown>) => {
    try {
      await api(`/api/admin/themes/${draft.id}`, {
        method: "PATCH",
        json: extra ?? {
          name: draft.name,
          primaryColor: draft.primaryColor,
          accentColor: draft.accentColor,
          secondaryColor: draft.secondaryColor,
          textColor: draft.textColor,
          highlightColor: draft.highlightColor,
          backgroundColor: draft.backgroundColor,
          questionFont: draft.questionFont,
          subtitleFont: draft.subtitleFont,
          labelFont: draft.labelFont,
        },
      });
      toast("Zapisano motyw — zmiany obejmą wszystkie filmy projektu");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };

  return (
    <div>
      <h1 className="font-display text-[28px] font-semibold">Motywy</h1>
      <p className="mt-1 text-sm text-muted">Kolory, czcionki i logo marki. Zmiana motywu automatycznie aktualizuje pytania, napisy, belki i dekoracje we wszystkich filmach projektu — także w eksporcie.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {themes.map((t) => (
          <button key={t.id} onClick={() => setId(t.id)} className={cn("rounded-xl border px-3 py-2 text-left text-sm transition", t.id === current.id ? "border-ink bg-white shadow-sm" : "border-line hover:bg-white")}>
            <span className="flex items-center gap-2">
              <span className="flex">
                {[t.primaryColor, t.accentColor, t.highlightColor].map((c, i) => (
                  <span key={i} className="-ml-1 h-4 w-4 rounded-full ring-2 ring-white first:ml-0" style={{ background: c }} />
                ))}
              </span>
              {t.name}
            </span>
            <span className="mt-0.5 block text-xs text-muted">{t.projects.map((p) => p.name).join(", ") || "nieużywany"}</span>
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_auto]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Preset startowy</p>
              <span className="text-xs text-muted">Zastępuje kolory i czcionki — logo zostaje.</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    if (confirm(`Zastosować preset „${p.name}”?`)) void save({ applyPreset: p.key });
                  }}
                  className="rounded-xl border border-line p-2.5 text-left text-xs transition hover:border-black/20"
                >
                  <span className="mb-2 flex h-8 overflow-hidden rounded-lg">
                    <span className="flex-1" style={{ background: p.background }} />
                    <span className="flex-1" style={{ background: p.primary }} />
                    <span className="flex-1" style={{ background: p.accent }} />
                    <span className="flex-1" style={{ background: p.highlight }} />
                  </span>
                  <span className="font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card className="space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Nazwa motywu</Label>
              <Input id="t-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {COLORS.map(([k, label, hint]) => (
                <div key={k} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                  <input type="color" aria-label={label} className="h-9 w-9 cursor-pointer rounded-lg border-0 bg-transparent p-0" value={draft[k] as string} onChange={(e) => setDraft({ ...draft, [k]: e.target.value.toUpperCase() })} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted">{hint}</p>
                  </div>
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    value={draft[k] as string}
                    aria-label={`${label} (hex)`}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </Card>
          <Card className="space-y-4 p-5">
            <p className="font-medium">Czcionki</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["questionFont", "Pytanie"],
                  ["subtitleFont", "Napisy"],
                  ["labelFont", "Etykiety i belki"],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`f-${k}`}>{label}</Label>
                  <NativeSelect id={`f-${k}`} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={{ fontFamily: draft[k] }}>
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>
                        {f}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">Czcionki na licencji SIL Open Font License — te same pliki są używane w podglądzie i w eksporcie.</p>
          </Card>
          <Card className="space-y-3 p-5">
            <p className="font-medium">Logo</p>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded-xl border border-dashed border-line bg-[repeating-conic-gradient(#f3f3f3_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
                {draft.logoUrl ? <img src={draft.logoUrl} alt="Logo" className="max-h-12 max-w-36 object-contain" /> : <span className="text-xs text-muted">brak logo</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <ImagePlus /> Wgraj logo
                </Button>
                {draft.logoAssetId ? (
                  <Button variant="ghost" onClick={() => save({ logoAssetId: null })}>
                    <Trash2 /> Usuń
                  </Button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const fd = new FormData();
                  fd.set("file", f);
                  const res = await fetch(`/api/admin/themes/${draft.id}/logo`, { method: "POST", body: fd });
                  const d = await res.json();
                  if (!res.ok) toast(d.error ?? "Błąd wysyłania", "err");
                  else {
                    toast("Wgrano logo");
                    router.refresh();
                  }
                }}
              />
            </div>
            <p className="text-xs text-muted">PNG z przezroczystością, maks. 5 MB. Logo pojawia się w nowych filmach (warstwa „Logo”) i można je dodać w Studio.</p>
          </Card>
          <div className="flex gap-3">
            <Button disabled={!dirty} onClick={() => save()}>
              Zapisz motyw
            </Button>
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(current)}>
              Anuluj zmiany
            </Button>
          </div>
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 text-xs font-medium text-muted">Podgląd na żywo</p>
          <ThemePreview theme={tokens} logoUrl={draft.logoUrl} width={270} />
        </div>
      </div>
      {toastNode}
    </div>
  );
}
