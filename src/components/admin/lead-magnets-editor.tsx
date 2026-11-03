"use client";
import { useState } from "react";
import { Label, Textarea } from "@/components/ui";
import { formatLeadMagnets, LEAD_MAGNET_PRESETS, parseLeadMagnets, type LeadMagnet } from "@/lib/lead-magnets";

/**
 * The brand's lead magnets for content scoring: the new version's CTA points to the one that fits the
 * reel, using only these DM keywords / names. One per line: SŁOWO | Nazwa | o czym | link.
 */
export function LeadMagnetsEditor({ value, onSave }: { value: LeadMagnet[] | null | undefined; onSave: (items: LeadMagnet[] | null) => Promise<void> | void }) {
  const [text, setText] = useState(formatLeadMagnets(value));
  const saved = formatLeadMagnets(value);
  const save = (t: string) => {
    const items = parseLeadMagnets(t);
    if (formatLeadMagnets(items) === saved) return;
    void onSave(items.length ? items : null);
  };
  const count = parseLeadMagnets(text).length;
  return (
    <div className="space-y-1.5" data-testid="lead-magnets">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Label htmlFor="lead-magnets">Lead magnety do CTA {count ? <span className="font-normal text-muted">({count})</span> : null}</Label>
        <span className="flex flex-wrap gap-2 text-xs">
          {LEAD_MAGNET_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="text-muted underline hover:text-ink"
              onClick={() => {
                if (count && !confirm(`Zastąpić obecną listę zestawem „${p.name}”?`)) return;
                const t = formatLeadMagnets(p.items);
                setText(t);
                save(t);
              }}
            >
              Wczytaj: {p.name}
            </button>
          ))}
        </span>
      </div>
      <Textarea id="lead-magnets" rows={count ? Math.min(10, count + 1) : 2} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => save(text)} placeholder={"SŁOWO | Nazwa materiału | o czym / dla kogo | link (opcjonalnie)\nnp. PLAN | Trudna rozmowa bez kłótni | plan trudnej rozmowy krok po kroku | /wiedza/trudna-rozmowa"} className="font-mono text-xs" />
      <p className="text-xs text-muted">Przy ocenie AI dobiera materiał pasujący do treści, a CTA („Napisz SŁOWO w wiadomości”) używa tylko słów z tej listy. Słowo spoza listy zostanie oznaczone w uwagach.</p>
    </div>
  );
}
