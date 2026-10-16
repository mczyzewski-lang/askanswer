"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button, Card, Label, NativeSelect, Textarea } from "@/components/ui";
import { api } from "@/lib/utils";
import { colorName, fillStyle, STYLE_PRESETS } from "@/lib/broll-style";
import type { ThemeTokens } from "@/lib/editor/types";

export interface StyleCategory {
  id: string;
  name: string;
  brollStyle: string | null;
  expertId: string | null;
}

/** Theme settings → visual style of AI scenes (Higgsfield), default + per category, with theme colours filled in. */
export function AiStyleCard({
  themeId,
  themeStyle,
  tokens,
  projects,
  experts,
  toast,
}: {
  themeId: string;
  themeStyle: string | null;
  tokens: ThemeTokens;
  projects: Array<{ id: string; name: string; categories: StyleCategory[] }>;
  experts: Array<{ id: string; name: string }>;
  toast: (t: string, tone?: "ok" | "err") => void;
}) {
  const router = useRouter();
  const [style, setStyle] = useState(themeStyle ?? "");
  const [prev, setPrev] = useState(themeStyle);
  if (prev !== themeStyle) {
    setPrev(themeStyle);
    setStyle(themeStyle ?? "");
  }
  const save = async (url: string, json: Record<string, unknown>, ok: string) => {
    try {
      await api(url, { method: "PATCH", json });
      toast(ok);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  const swatches: Array<[string, string, string]> = [
    ["{{paper}}", tokens.background, "papier / tło"],
    ["{{ink}}", tokens.primary, "linie / tusz"],
    ["{{accent}}", tokens.accent, "akcenty"],
  ];
  return (
    <Card className="space-y-4 p-5" data-testid="ai-style-card">
      <div>
        <p className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4" /> Styl scen AI (Higgsfield)
        </p>
        <p className="mt-1 text-xs text-muted">
          Styl opisuje, <b>jak</b> wyglądają sceny generowane w Studio (technika, kreska, ruch, dźwięk). <b>Co</b> dzieje się w scenach, AI układa z wypowiedzi eksperta — ujęcie po ujęciu. Kolory pochodzą z motywu: wpisz w stylu
          znaczniki poniżej, a przy generowaniu zamienią się na nazwy kolorów tego motywu.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {swatches.map(([k, c, hint]) => (
          <span key={k} className="inline-flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-xs">
            <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: c }} />
            <code>{k}</code>
            <span className="text-muted">
              {hint}: {colorName(c)}
            </span>
          </span>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="theme-style">Styl domyślny motywu</Label>
        <Textarea id="theme-style" rows={4} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Puste = filmowy realizm w kolorach motywu" />
        <div className="flex flex-wrap items-center gap-2">
          {STYLE_PRESETS.map((p) => (
            <Button key={p.key} size="sm" variant="ghost" onClick={() => setStyle(p.style)}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" className="ml-auto" disabled={style === (themeStyle ?? "")} onClick={() => save(`/api/admin/themes/${themeId}`, { brollStyle: style }, "Zapisano styl motywu")}>
            Zapisz styl
          </Button>
        </div>
        {style.trim() ? (
          <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-muted">
            <span className="font-medium text-ink">Po podstawieniu kolorów: </span>
            {fillStyle(style, tokens)}
          </p>
        ) : null}
      </div>

      {projects.map((p) =>
        p.categories.length ? (
          <div key={p.id} className="space-y-2">
            <p className="text-sm font-medium">
              Kategorie projektu „{p.name}” <span className="font-normal text-muted">— styl kategorii zastępuje styl motywu</span>
            </p>
            {p.categories.map((c) => (
              <CategoryStyleRow key={c.id} category={c} experts={experts} onSave={(json, ok) => save(`/api/admin/categories/${c.id}`, json, ok)} />
            ))}
          </div>
        ) : null,
      )}
    </Card>
  );
}

function CategoryStyleRow({ category, experts, onSave }: { category: StyleCategory; experts: Array<{ id: string; name: string }>; onSave: (json: Record<string, unknown>, ok: string) => void }) {
  const [style, setStyle] = useState(category.brollStyle ?? "");
  const [prev, setPrev] = useState(category.brollStyle);
  if (prev !== category.brollStyle) {
    setPrev(category.brollStyle);
    setStyle(category.brollStyle ?? "");
  }
  return (
    <div className="space-y-2 rounded-xl border border-line p-3" data-testid="category-style">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">{category.name}</p>
        <Label htmlFor={`cat-exp-${category.id}`} className="text-xs text-muted">
          Ekspert domyślny
        </Label>
        <NativeSelect
          id={`cat-exp-${category.id}`}
          className="h-8 w-48 text-xs"
          value={category.expertId ?? ""}
          onChange={(e) => onSave({ expertId: e.target.value || null }, "Zapisano eksperta kategorii")}
        >
          <option value="">— brak —</option>
          {experts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Textarea rows={3} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Puste = styl domyślny motywu" aria-label={`Styl scen AI — ${category.name}`} className="text-xs" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setStyle(STYLE_PRESETS[0].style)}>
          Wstaw styl tuszu
        </Button>
        <Button size="sm" variant="subtle" disabled={style === (category.brollStyle ?? "")} onClick={() => onSave({ brollStyle: style }, `Zapisano styl kategorii „${category.name}”`)}>
          Zapisz
        </Button>
      </div>
    </div>
  );
}
