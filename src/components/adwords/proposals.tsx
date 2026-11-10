"use client";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button, Card, Input, NativeSelect } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import type { AwData, Toast } from "./types";

interface Proposal {
  kind: "headline" | "long_headline" | "description" | "image" | "meta";
  text: string;
  angle: string;
  why: string;
  limit?: number;
  issues: string[];
  data?: Record<string, string>;
}
interface Result {
  summary: string[];
  analysis: { bullets: string[]; history: { period: string | null; top: Array<{ text: string; clicks: number; impressions: number; ctr: number | null; confidence: string }> } };
  proposals: Proposal[];
  tests: Array<{ hypothesis: string; a: string; b: string }>;
  engine: "openai" | "rule";
  warning: string | null;
}
const KIND: Record<Proposal["kind"], string> = { headline: "Nagłówki (≤30)", long_headline: "Długie nagłówki (≤90)", description: "Opisy (≤90)", image: "Koncepty graficzne (3 formaty)", meta: "Reklamy Meta" };
const LAYOUT: Record<string, string> = { typographic: "typograficzny", comparison: "porównanie", process_steps: "kroki", expert: "z ekspertem" };

/** Asystent → analysis of the project (PMax history, current set, rules) + new content proposals by OpenAI */
export function ProposalsPanel({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const base = `/api/admin/adwords/${data.project.id}`;
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [items, setItems] = useState<Array<Proposal & { on: boolean }>>([]);
  const [campaign, setCampaign] = useState(data.campaigns[0]?.code ?? "");
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<Result>(`${base}/propose`, { method: "POST" });
      setRes(r);
      // clean proposals pre-picked; ones with issues left for a person to fix or skip
      setItems(r.proposals.map((p) => ({ ...p, on: !p.issues.length })));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const picked = items.filter((i) => i.on).map(({ on: _on, ...p }) => (void _on, p));
    try {
      const r = await api<{ texts: number; concepts: string[]; meta: number }>(`${base}/propose`, { method: "PUT", json: { proposals: picked, campaignCode: campaign || null } });
      toast(`Dodano: ${r.texts} tekstów, ${r.concepts.length} konceptów graficznych${r.concepts.length ? ` (${r.concepts.join(", ")})` : ""}, ${r.meta} reklam Meta`);
      setItems((x) => x.map((i) => ({ ...i, on: false })));
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const groups = (Object.keys(KIND) as Proposal["kind"][]).filter((k) => items.some((i) => i.kind === k));
  return (
    <Card className="space-y-4 p-5" data-testid="proposals">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-medium">Analiza i propozycje treści (AI)</p>
          <p className="text-sm text-muted">Analiza historii PMax (co miało największą ekspozycję i CTR — kierunkowo), obecnego zestawu względem zaleceń Google i reguł projektu (temat, oferta, twierdzenia bez dowodu, archiwum). Na tej podstawie OpenAI pisze NOWE nagłówki, opisy, koncepty graficzne i reklamy Meta — treści z CSV są tylko inspiracją. Każda propozycja jest sprawdzona; nic się nie zapisze bez Twojego wyboru.</p>
        </div>
        <Button onClick={() => void run()} disabled={busy || !data.canEdit} data-testid="proposals-run">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {res ? "Przeanalizuj ponownie" : "Przeanalizuj i zaproponuj treści"}
        </Button>
      </div>
      {res ? (
        <div className="space-y-4">
          {res.warning ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{res.warning}</p> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1" data-testid="proposals-analysis">
              <p className="text-sm font-medium">Analiza</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {res.analysis.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Wnioski {res.engine === "openai" ? "AI" : ""}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {res.summary.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              {res.tests.length ? (
                <div className="mt-2 space-y-1 text-sm">
                  <p className="font-medium">Proponowane testy A/B</p>
                  {res.tests.map((t, i) => (
                    <p key={i} className="text-xs">
                      {t.hypothesis}: <b>A</b> „{t.a}” vs <b>B</b> „{t.b}”
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {groups.map((k) => (
            <div key={k} className="space-y-1.5">
              <p className="text-sm font-medium">{KIND[k]}</p>
              {items.map((p, i) =>
                p.kind !== k ? null : (
                  <div key={i} className={cn("flex flex-wrap items-start gap-2 rounded-lg border px-2 py-1.5 text-sm", p.issues.length ? "border-amber-300" : "border-line")} data-testid="proposal">
                    <input type="checkbox" className="mt-2 h-4 w-4" checked={p.on} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label={`Wybierz: ${p.text}`} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Input className="h-8" value={p.text} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} aria-label={`Propozycja ${k} ${i}`} />
                        {p.limit ? <span className={cn("shrink-0 text-xs tabular-nums", [...p.text].length > p.limit ? "font-semibold text-red-600" : "text-muted")}>{[...p.text].length}/{p.limit}</span> : null}
                      </div>
                      <p className="text-xs text-muted">
                        {p.angle ? `${p.angle} · ` : ""}
                        {p.why}
                        {p.kind === "image" && p.data ? ` · układ: ${LAYOUT[p.data.layout] ?? p.data.layout}${p.data.cta ? ` · CTA „${p.data.cta}”` : ""}${p.data.layout === "comparison" ? ` · „${p.data.left}” vs „${p.data.right}”` : ""}${p.data.layout === "process_steps" && p.data.body ? ` · ${p.data.body}` : ""}` : ""}
                        {p.kind === "meta" && p.data ? ` · „${p.data.primary_text}” · nagłówek „${p.data.headline}”` : ""}
                      </p>
                      {p.issues.length ? <p className="text-xs text-amber-800">⚠ {p.issues.join(" · ")}</p> : null}
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
          {items.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect className="h-9 w-56" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Kampania propozycji AI">
                <option value="">— bez kampanii —</option>
                {data.campaigns.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <Button disabled={!items.some((i) => i.on) || !data.canEdit} onClick={() => void add()} data-testid="proposals-add">
                Dodaj zaznaczone ({items.filter((i) => i.on).length})
              </Button>
              <span className="text-xs text-muted">Propozycje z ostrzeżeniem nie są zaznaczone — popraw tekst albo pomiń.</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
