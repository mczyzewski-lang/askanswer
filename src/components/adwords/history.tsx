"use client";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Trash2 } from "lucide-react";
import { Badge, Button, Card, NativeSelect } from "@/components/ui";
import { DropZone } from "@/components/drop-zone";
import { api, cn } from "@/lib/utils";
import { decodeCsv } from "@/lib/csv-import";
import { ANGLE_LABEL, HISTORY_SOURCES, MISSING_DATA, TYPE_LABEL, directionalCtr, matchHistory, type TypeKey } from "@/lib/adwords/history";
import { exposureConfidence } from "@/lib/adwords/experiments";
import type { AwData, AwHistoryRow, Toast } from "./types";

const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toLocaleString("pl-PL", { minimumFractionDigits: d, maximumFractionDigits: d }));
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("pl-PL", { timeZone: "UTC" }) : "—");
export const periodOf = (i: { periodFrom: string | null; periodTo: string | null; periodRaw: string | null } | undefined) => (i ? (i.periodFrom && i.periodTo ? `${day(i.periodFrom)} – ${day(i.periodTo)}` : i.periodRaw ?? "?") : "");

/** The warning over every table of historical metrics. */
export function NonAdditiveNote() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="non-additive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <b>Metryki komponentów są przypisane przez Google i nieaddytywne.</b> Ta sama konwersja, wyświetlenie, kliknięcie czy koszt mogą być przypisane kilku komponentom jednej reklamy — <b>nie sumujemy ich</b> (to nie są wydatki ani unikalne konwersje kampanii). CTR to tylko sygnał
        kierunkowy (komponenty współwystępują i działają w różnych kanałach). To nie jest test A/B.{" "}
        {HISTORY_SOURCES.map((s, i) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline" title={s.title}>
            [{i + 1}]
          </a>
        ))}
      </p>
    </div>
  );
}

export function HistoryTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const { imports, rows } = data.history;
  const [importId, setImportId] = useState(imports[0]?.id ?? "");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [angle, setAngle] = useState("all");
  const [compare, setCompare] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const concepts = [...new Set(data.assets.map((a) => a.conceptId).filter((x): x is string => !!x))];
  const cur = imports.find((i) => i.id === importId) ?? imports[0];
  const list = rows.filter((r) => r.importId === cur?.id && (type === "all" || r.typeKey === type) && (status === "all" || r.status === status) && (angle === "all" || r.angle === angle));
  const other = rows.filter((r) => r.importId === compare);
  const read = async (f: File) => {
    try {
      const text = decodeCsv(await f.arrayBuffer());
      const r = await api<{ total: number; applied: boolean; replaced: boolean; error?: string; issues: Array<{ row: number; message: string }> }>(`/api/admin/adwords/${data.project.id}/history`, { method: "POST", json: { text, fileName: f.name, dryRun: false } });
      if (!r.applied) return toast(r.issues[0] ? `Wiersz ${r.issues[0].row}: ${r.issues[0].message}` : "Nie zaimportowano", "err");
      toast(`Historia: ${r.total} komponentów${r.replaced ? " (ten sam raport — zastąpiony, bez duplikatów)" : ""}`);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const roasAvailable = rows.some((r) => (r.convValue ?? 0) > 0);
  return (
    <div className="space-y-4" data-testid="history">
      <DropZone accept=".csv,text/csv" multiple={false} label="Upuść raport Google Ads" onFiles={(fs) => void read(fs[0])} className="rounded-2xl">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Historia PMax — kierunkowe sygnały z emisji komponentów</p>
            <p className="text-sm text-muted">Eksport z Google Ads: „Grupa plików – raport szczegółowych informacji o komponentach”. Ponowny import tego samego raportu nie tworzy duplikatów; inny okres = osobny import do porównania.</p>
          </div>
          <Button onClick={() => fileRef.current?.click()} disabled={!data.canEdit} data-testid="history-import">
            <FileUp /> Importuj historię z Google Ads
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="history-file" onChange={(e) => (e.target.files?.[0] ? void read(e.target.files[0]) : null, (e.target.value = ""))} />
        </Card>
      </DropZone>
      {!imports.length ? <p className="text-sm text-muted">Brak zaimportowanej historii.</p> : null}
      {cur ? (
        <>
          <NonAdditiveNote />
          <div className="flex flex-wrap items-center gap-2" data-testid="history-filters">
            <NativeSelect className="h-9 w-60" value={cur.id} onChange={(e) => setImportId(e.target.value)} aria-label="Okres">
              {imports.map((i) => (
                <option key={i.id} value={i.id}>
                  {periodOf(i)} · {i.rowCount} komp.
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="h-9 w-48" value={type} onChange={(e) => setType(e.target.value)} aria-label="Typ komponentu">
              <option value="all">Każdy typ</option>
              {Object.entries(TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Stan">
              <option value="all">Każdy stan</option>
              <option value="Odpowiedni">Odpowiedni</option>
              <option value="Nieodpowiedni">Nieodpowiedni</option>
            </NativeSelect>
            <NativeSelect className="h-9 w-56" value={angle} onChange={(e) => setAngle(e.target.value)} aria-label="Motyw komunikacji">
              <option value="all">Każdy motyw komunikacji</option>
              {Object.entries(ANGLE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            {imports.length > 1 ? (
              <NativeSelect className="h-9 w-56" value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="Porównaj z okresem">
                <option value="">Porównaj z okresem…</option>
                {imports.filter((i) => i.id !== cur.id).map((i) => (
                  <option key={i.id} value={i.id}>
                    {periodOf(i)}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            <span className="text-sm text-muted">ROAS: {roasAvailable ? "patrz CRM" : <b data-testid="roas">ROAS niedostępny</b>} (wartość konwersji w raporcie = 0)</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-red-600"
              onClick={async () => {
                if (!confirm(`Usunąć import ${periodOf(cur)}?`)) return;
                await api(`/api/admin/adwords/${data.project.id}/history/imports/${cur.id}`, { method: "DELETE" });
                await reload();
              }}
            >
              <Trash2 /> Usuń import
            </Button>
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs" data-testid="history-table">
              <thead className="bg-black/[.03]">
                <tr>
                  {["Komponent", "Typ", "Stan", "Ostatnia aktualizacja*", "Wyświetlenia", "Kliknięcia", "CTR (kierunkowy)", "Konwersje przypisane", "Koszt przypisany", "Motyw", "Hipoteza dla konceptu"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const ctr = directionalCtr(r);
                  const prev = compare ? other.find((o) => o.component === r.component && o.typeKey === r.typeKey) : null;
                  return (
                    <tr key={r.id} className="border-t border-line/60 align-top" data-testid="history-row">
                      <td className="max-w-[320px] whitespace-pre-line px-2 py-1.5">{r.component}</td>
                      <td className="px-2 py-1.5">{TYPE_LABEL[r.typeKey as TypeKey] ?? r.assetType}</td>
                      <td className="px-2 py-1.5">{r.status === "Nieodpowiedni" ? <Badge tone="red">Nieodpowiedni</Badge> : r.status}</td>
                      <td className="px-2 py-1.5">{day(r.lastUpdated)}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {n(r.impressions)}
                        {prev ? <span className="block text-muted">poprz. {n(prev.impressions)}</span> : null}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {n(r.clicks)}
                        {prev ? <span className="block text-muted">poprz. {n(prev.clicks)}</span> : null}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{ctr == null ? "—" : `${(ctr * 100).toFixed(1)}%`}</td>
                      <td className="px-2 py-1.5 tabular-nums">{n(r.conversions, 2)}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {n(r.cost, 2)} {r.currency ?? ""}
                      </td>
                      <td className="px-2 py-1.5">{ANGLE_LABEL[(r.angle ?? "inne") as keyof typeof ANGLE_LABEL]}</td>
                      <td className="px-2 py-1.5">
                        <NativeSelect
                          className="h-7 w-28 text-xs"
                          value={r.conceptId ?? ""}
                          aria-label={`Koncept dla ${r.component.slice(0, 30)}`}
                          disabled={!data.canEdit}
                          onChange={async (e) => {
                            await api(`/api/admin/adwords/${data.project.id}/history/rows/${r.id}`, { method: "PATCH", json: { conceptId: e.target.value || null } });
                            await reload();
                          }}
                        >
                          <option value="">—</option>
                          {concepts.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted">
            * „Ostatnia aktualizacja” to data zmiany komponentu, nie pierwszej emisji. Komponenty zmienione niedawno (np. 4 listopada) mają za małą ekspozycję, by oceniać ich wynik. Niska emisja obrazów nie oznacza słabej kreacji — sprawdź kanały, ustawienia PMax i stan „Nieodpowiedni”. Wysokie
            liczby przy „Nazwa firmy” czy „Logo” to przypisania, nie liczba sprzedanych usług.
          </p>
          <Card className="space-y-2 p-4" data-testid="missing-data">
            <p className="text-sm font-medium">Brakujące dane przed decyzjami budżetowymi (priorytet)</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm">
              {MISSING_DATA.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ol>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/**
 * "Potwierdzenie historyczne" for a message: the matched historical component (linked by hand, or the
 * same text), its period and sample, and the confidence about the SCALE of exposure only.
 */
export function HistoricalEvidence({ data, conceptId, text }: { data: AwData; conceptId: string | null; text: string }) {
  const rows = data.history.rows;
  const latest = data.history.imports[0];
  const found = useMemo(() => {
    const linked = rows.filter((r) => r.conceptId && r.conceptId === conceptId);
    return (linked.length ? linked : matchHistory<AwHistoryRow>(text, rows)).slice(0, 3);
  }, [rows, conceptId, text]);
  if (!latest) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-line p-3 text-xs" data-testid="historical-evidence">
      <p className="font-medium">Potwierdzenie historyczne</p>
      {!found.length ? <p className="text-muted">Brak dopasowanego komunikatu w historii — <b>hipoteza</b>, wymaga testu A/B.</p> : null}
      {found.map((r) => {
        const imp = data.history.imports.find((i) => i.id === r.importId);
        const c = exposureConfidence(r.impressions);
        return (
          <p key={r.id}>
            „{r.component.split("\n")[0]}” · {periodOf(imp)} · {n(r.impressions)} wyśw. / {n(r.clicks)} klik. · pewność ekspozycji: <b>{c.level}</b> <span className="rounded bg-black/[.05] px-1">{c.label}</span>
            <span className="block text-muted">Konwersje przypisane komponentowi: {n(r.conversions, 2)} — nie są wynikiem tej kreacji.</span>
          </p>
        );
      })}
      <p className={cn("font-medium", "text-amber-800")}>Status: Wymaga testu A/B</p>
    </div>
  );
}
