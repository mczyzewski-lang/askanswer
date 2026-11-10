"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Input, Label, NativeSelect, Textarea, useToast } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { FONT_FAMILIES, THEME_PRESETS, themeFromRow } from "@/lib/themes";
import { QUESTION_POSITIONS, QUESTION_STYLES } from "@/lib/question-styles";
import { ThemePreview } from "./theme-preview";
import { AiStyleCard, type StyleCategory } from "./ai-style-card";
import { INFOGRAPHIC_PROMPT_BASE, INFOGRAPHIC_TOKENS, infographicPrompt, isBasePrompt } from "@/lib/infographic-prompt";
import { fillStyle } from "@/lib/broll-style";
import type { ThemeTokens } from "@/lib/editor/types";

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
  questionStyle: string;
  questionPosition: string;
  logoAssetId: string | null;
  logoUrl: string | null;
  logoDarkAssetId?: string | null;
  logoDarkUrl?: string | null;
  brollStyle: string | null;
  infographicPrompt?: string | null;
  projects: Array<{ id: string; name: string; categories: StyleCategory[] }>;
}

const COLORS: Array<[keyof ThemeRow, string, string]> = [
  ["primaryColor", "Kolor główny", "tło pytania, belki"],
  ["accentColor", "Akcent", "dekoracje, callouty"],
  ["secondaryColor", "Kolor dodatkowy", "elementy pomocnicze"],
  ["textColor", "Tekst", "tekst na tle głównym"],
  ["highlightColor", "Podświetlenie napisów", "aktywne słowo"],
  ["backgroundColor", "Tło", "plansze i przerwy"],
];

/** `embedded`: inside a project's settings — just that project's theme, no list of the others. */
export function ThemesView({ themes, experts, initialId, embedded = false }: { themes: ThemeRow[]; experts: Array<{ id: string; name: string }>; initialId: string | null; embedded?: boolean }) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [id, setId] = useState(initialId);
  const [showUnused, setShowUnused] = useState(false);
  const current = themes.find((t) => t.id === id) ?? themes[0];
  const [draft, setDraft] = useState<ThemeRow | null>(current ?? null);
  const [lastId, setLastId] = useState(current?.id);
  if (current && current.id !== lastId) {
    setLastId(current.id);
    setDraft(current);
  }
  const unused = themes.filter((t) => !t.projects.length);
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
          questionStyle: draft.questionStyle,
          questionPosition: draft.questionPosition,
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
      {embedded ? null : (
        <>
      <h1 className="font-display text-[28px] font-semibold">Motywy</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Każdy projekt ma własny motyw (kopię presetu, od którego zaczął) — dlatego jest ich tyle, ile projektów. Zmiana motywu aktualizuje pytania, napisy, belki i dekoracje we wszystkich filmach tego projektu. Motyw projektu
        edytujesz też w projekcie: Ustawienia projektu → Motyw projektu.
      </p>
      <div className="mt-6 flex flex-wrap gap-2" data-testid="theme-list">
        {themes.filter((t) => t.projects.length || showUnused || t.id === current.id).map((t) => (
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
      {unused.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted" data-testid="unused-themes">
          <button type="button" className="underline hover:text-ink" onClick={() => setShowUnused((v) => !v)}>
            {showUnused ? "Ukryj nieużywane" : `Pokaż nieużywane (${unused.length})`}
          </button>
          <span>— motywy po usuniętych projektach, nie wpływają na żaden film.</span>
          <button
            type="button"
            className="text-red-600 underline"
            data-testid="delete-unused-themes"
            onClick={async () => {
              if (!confirm(`Usunąć ${unused.length} nieużywanych motywów? Żaden projekt z nich nie korzysta.`)) return;
              try {
                for (const t of unused) await api(`/api/admin/themes/${t.id}`, { method: "DELETE" });
                toast(`Usunięto ${unused.length} nieużywanych motywów`);
                setShowUnused(false);
                router.refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            Usuń nieużywane
          </button>
        </div>
      ) : null}
        </>
      )}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_auto]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Preset startowy</p>
              <span className="text-xs text-muted">Zastępuje kolory i czcionki — logo zostaje (preset z logo marki wstawia je).</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
          <Card className="space-y-4 p-5" data-testid="question-style-card">
            <div>
              <p className="font-medium">Styl pytania</p>
              <p className="text-xs text-muted">Jak pytanie widza wygląda na filmie — dotyczy wszystkich filmów projektu, w podglądzie i w eksporcie.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {QUESTION_STYLES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={draft.questionStyle === q.id}
                  onClick={() => setDraft({ ...draft, questionStyle: q.id })}
                  className={cn("rounded-xl border p-2.5 text-left text-xs transition", draft.questionStyle === q.id ? "border-ink bg-white shadow-sm" : "border-line hover:border-black/20")}
                >
                  <span className="block font-medium">{q.label}</span>
                  <span className="mt-0.5 block text-muted">{q.hint}</span>
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Położenie pytania</Label>
              <div className="flex gap-2">
                {QUESTION_POSITIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={draft.questionPosition === p.id}
                    onClick={() => setDraft({ ...draft, questionPosition: p.id })}
                    className={cn("rounded-lg border px-3 py-1.5 text-sm", draft.questionPosition === p.id ? "border-ink bg-white shadow-sm" : "border-line hover:border-black/20")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>
          <Card className="space-y-3 p-5" data-testid="theme-logos">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Logo</p>
              {THEME_PRESETS.find((p) => p.key === draft.presetKey && (p.logoFile || p.logoDarkFile)) ? (
                <Button variant="outline" onClick={() => void save({ presetLogos: draft.presetKey! } as never)} data-testid="preset-logos">
                  <ImagePlus /> Wstaw logo marki {THEME_PRESETS.find((p) => p.key === draft.presetKey)?.name}
                </Button>
              ) : null}
            </div>
            {(
              [
                ["light", "Na jasne tło", draft.logoUrl, draft.logoAssetId, "logoAssetId", "#ffffff"],
                ["dark", "Na ciemne tło", draft.logoDarkUrl ?? null, draft.logoDarkAssetId ?? null, "logoDarkAssetId", draft.backgroundColor],
              ] as const
            ).map(([variant, title, url, id, field, bgc]) => (
              <div key={variant} className="flex flex-wrap items-center gap-4" data-testid={`logo-${variant}`}>
                <div className="flex h-16 w-44 items-center justify-center rounded-xl border border-line" style={{ background: bgc }}>
                  {url ? <img src={url} alt={`Logo — ${title}`} className="max-h-12 max-w-40 object-contain" /> : <span className={cn("text-xs", variant === "dark" ? "text-white/70" : "text-muted")}>brak</span>}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{title}</p>
                  <div className="mt-1 flex gap-2">
                    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:border-black/20">
                      <ImagePlus className="h-4 w-4" /> Wgraj
                      <input
                        type="file"
                        accept="image/svg+xml,image/png,image/jpeg,image/webp"
                        className="hidden"
                        data-testid={`logo-upload-${variant}`}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (!f) return;
                          const fd = new FormData();
                          fd.set("file", f);
                          fd.set("variant", variant);
                          const res = await fetch(`/api/admin/themes/${draft.id}/logo`, { method: "POST", body: fd });
                          const d = await res.json();
                          if (!res.ok) toast(d.error ?? "Błąd wysyłania", "err");
                          else {
                            toast(d.counterpart ? "Wgrano logo — z SVG zrobiłem też wersję na drugie tło" : "Wgrano logo");
                            router.refresh();
                          }
                        }}
                      />
                    </label>
                    {id ? (
                      <Button variant="ghost" onClick={() => save({ [field]: null } as never)}>
                        <Trash2 /> Usuń
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted">SVG, PNG z przezroczystością, JPG lub WEBP, maks. 5 MB. SVG zamieniam na PNG; jeśli drugiej wersji brakuje, robię ją z SVG (białe ↔ kolor motywu). Grafiki same wybierają wersję do tła — na jasnych kartach porównania jasna, na ciemnych banerach ciemna.</p>
          </Card>
          <div className="flex gap-3">
            <Button disabled={!dirty} onClick={() => save()}>
              Zapisz motyw
            </Button>
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(current)}>
              Anuluj zmiany
            </Button>
          </div>
          <AiStyleCard themeId={current.id} themeStyle={current.brollStyle} tokens={tokens} projects={current.projects} experts={experts} toast={toast} />
          <InfographicPromptCard key={current.id} themeId={current.id} saved={current.infographicPrompt ?? null} tokens={tokens} style={current.brollStyle} toast={toast} />
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

/**
 * The prompt OpenAI gets for an infographic (reels and projects alike): this theme's template, with
 * {{placeholders}} filled for each graphic. "Przywróć bazowy" is shown whenever it differs from the base.
 */
function InfographicPromptCard({ themeId, saved, tokens, style, toast }: { themeId: string; saved: string | null; tokens: ThemeTokens; style: string | null; toast: (t: string, tone?: "ok" | "err") => void }) {
  const router = useRouter();
  const [text, setText] = useState(saved ?? INFOGRAPHIC_PROMPT_BASE);
  const [busy, setBusy] = useState(false);
  const changed = !isBasePrompt(text);
  const dirty = text.trim() !== (saved ?? INFOGRAPHIC_PROMPT_BASE).trim();
  const save = async (value: string | null, msg: string) => {
    setBusy(true);
    try {
      await api(`/api/admin/themes/${themeId}`, { method: "PATCH", json: { infographicPrompt: value } });
      toast(msg);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const example = infographicPrompt({ headline: "Ile trwa rozwód?", items: [{ value: "6 mies.", label: "średni czas sprawy" }, { value: "2", label: "rozprawy" }], note: null }, tokens, style?.trim() ? fillStyle(style.trim(), tokens) : null, text);
  return (
    <Card className="space-y-3 p-5" data-testid="infographic-prompt">
      <div>
        <p className="font-medium">Prompt infografiki (reelsy i filmy)</p>
        <p className="text-sm text-muted">
          Tekst, który dostaje OpenAI, gdy rysuje całą infografikę (z tekstem). W <code>{"{{…}}"}</code> wstawiają się wartości danej grafiki i kolory motywu.{" "}
          {saved ? <span className="font-medium text-amber-700">Ten motyw ma własną wersję.</span> : "Ten motyw używa promptu bazowego."}
        </p>
      </div>
      {changed || saved ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{saved && !dirty ? "Zapisana zmieniona wersja." : "Prompt różni się od bazowego."}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid="infographic-prompt-reset"
            onClick={() => {
              setText(INFOGRAPHIC_PROMPT_BASE);
              void save(null, "Przywrócono bazowy prompt infografiki");
            }}
          >
            Przywróć bazowy
          </Button>
        </div>
      ) : null}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="font-mono text-[12px] leading-relaxed" aria-label="Prompt infografiki" data-testid="infographic-prompt-text" />
      <div className="flex flex-wrap gap-1.5 text-xs text-muted">
        {INFOGRAPHIC_TOKENS.map(([k, label]) => (
          <button key={k} type="button" className="rounded-full border border-line px-2 py-0.5 hover:bg-black/[.03]" title={`Wstaw ${k}`} onClick={() => setText((t) => `${t}${t.endsWith("\n") ? "" : " "}${k}`)}>
            <code>{k}</code> {label}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || busy || !text.trim()} onClick={() => void save(text, "Zapisano prompt infografiki")} data-testid="infographic-prompt-save">
          Zapisz prompt
        </Button>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Podgląd po wstawieniu przykładowych wartości</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/[.04] p-3 font-mono text-[11.5px] leading-relaxed text-ink/85" data-testid="infographic-prompt-example">
          {example}
        </pre>
      </details>
    </Card>
  );
}
