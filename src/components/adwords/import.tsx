"use client";
import { useRef, useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { Button, Card, NativeSelect } from "@/components/ui";
import { DropZone } from "@/components/drop-zone";
import { api, cn } from "@/lib/utils";
import { decodeCsv } from "@/lib/csv-import";
import { ALL_COLUMNS as ADWORDS_COLUMNS, ROW_TYPE_LABEL, type AdwordsColumn, type CsvIssue, type RowType } from "@/lib/adwords/csv";
import type { AwData, Toast } from "./types";

interface DryRun {
  total: number;
  delimiter: string;
  headers: string[];
  mapping: Record<string, AdwordsColumn | null>;
  preview: Array<Record<string, string>>;
  issues: CsvIssue[];
  counts: Record<RowType, number>;
  concepts: { images: number; cleanPhotos: number; videos: number; scenes: number; texts: number; experiments?: number; meta?: number; sitelinks?: number; landing?: number };
  scopes?: { adAssets: number; landingContent: number };
  projectSlugMismatch: string[];
  applied: boolean;
  created: number;
  updated: number;
  unchanged: number;
  campaignsCreated: number;
}

interface HistoryDry {
  kind: "history";
  total: number;
  title: string | null;
  periodRaw: string | null;
  issues: Array<{ row: number; message: string }>;
  preview: Array<{ component: string; type: string | null; status: string | null; impressions: number | null; clicks: number | null; conversions: number | null }>;
}

export function ImportTab({ data, reload, toast, onDone }: { data: AwData; reload: () => Promise<void>; toast: Toast; onDone: (kind: "creatives" | "history") => void }) {
  const [hist, setHist] = useState<HistoryDry | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dry, setDry] = useState<DryRun | null>(null);
  const [mapping, setMapping] = useState<Record<string, AdwordsColumn | null>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/api/admin/adwords/${data.project.id}`;
  const check = async (t: string, m?: Record<string, AdwordsColumn | null>, fileName = name) => {
    setBusy(true);
    try {
      const r = await api<DryRun | HistoryDry>(`${base}/import`, { method: "POST", json: { text: t, dryRun: true, mapping: m, fileName } });
      // a Google Ads asset report: a different format (Historia PMax), not creatives
      if ((r as HistoryDry).kind === "history") {
        setHist(r as HistoryDry);
        setDry(null);
        return;
      }
      setHist(null);
      setDry(r as DryRun);
      setMapping((r as DryRun).mapping);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const read = async (f: File) => {
    const t = decodeCsv(await f.arrayBuffer());
    setText(t);
    setName(f.name);
    await check(t, undefined, f.name);
  };
  const errors = dry?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = dry?.issues.filter((i) => i.level === "warning") ?? [];
  return (
    <div className="space-y-4">
      <DropZone accept=".csv,text/csv" multiple={false} label="Upuść plik CSV" onFiles={(fs) => void read(fs[0])} onRejected={(n) => toast(`To nie jest CSV: ${n.join(", ")}`, "err")} className="rounded-2xl">
        <Card className="space-y-3 p-6 text-center" data-testid="import-drop">
          <FileUp className="mx-auto h-8 w-8 text-muted" />
          <p className="text-sm">Przeciągnij plik CSV albo</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => fileRef.current?.click()} disabled={!data.canEdit}>
              <Upload /> Wybierz plik
            </Button>
            <a href={`${base}/csv?template=1`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-black/[.03]">
              <Download className="h-4 w-4" /> Pobierz szablon CSV
            </a>
            <a href={`${base}/csv`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-black/[.03]" data-testid="export-csv">
              <Download className="h-4 w-4" /> Eksportuj CSV
            </a>
          </div>
          <p className="text-xs text-muted">Separator „;” lub „,”, UTF-8 (z BOM lub bez) albo Windows-1250. Ponowny import tego samego pliku nie tworzy duplikatów (klucz: asset_id).</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-file" onChange={(e) => (e.target.files?.[0] ? void read(e.target.files[0]) : null, (e.target.value = ""))} />
        </Card>
      </DropZone>

      {hist && text ? (
        <Card className="space-y-3 p-5" data-testid="import-history-detected">
          <p className="font-medium">To raport komponentów Google Ads — trafi do „Historia PMax”, nie do kreacji.</p>
          <p className="text-sm text-muted">
            {hist.title} · {hist.periodRaw} · {hist.total} komponentów
          </p>
          {hist.issues.length ? <p className="text-sm text-red-700">{hist.issues.map((i) => `Wiersz ${i.row}: ${i.message}`).join("; ")}</p> : null}
          <Button
            disabled={busy || hist.issues.length > 0 || !data.canEdit}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ total: number; replaced: boolean }>(`${base}/history`, { method: "POST", json: { text, fileName: name, dryRun: false } });
                toast(`Historia: ${r.total} komponentów${r.replaced ? " (zastąpiono ten sam raport)" : ""}`);
                setHist(null);
                setText(null);
                await reload();
                onDone("history");
              } catch (e) {
                toast((e as Error).message, "err");
              } finally {
                setBusy(false);
              }
            }}
            data-testid="import-history-confirm"
          >
            Importuj historię ({hist.total})
          </Button>
        </Card>
      ) : null}
      {dry && text ? (
        <Card className="space-y-4 p-5" data-testid="import-preview">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {name} · {dry.total} rekordów · separator „{dry.delimiter}”
            </p>
            <p className="text-sm text-muted" data-testid="import-counts">
              {dry.concepts.images} koncepty graficzne, {dry.concepts.cleanPhotos} czyste zdjęcia, {dry.concepts.videos} koncepty wideo, {dry.concepts.scenes} scen, {dry.concepts.texts} tekstów
              {dry.concepts.experiments ? `, ${dry.concepts.experiments} eksperymentów, ${dry.concepts.meta} wierszy planu / archiwum` : ""}
              {dry.concepts.sitelinks ? `, ${dry.concepts.sitelinks} sitelinków` : ""}
              {dry.scopes?.landingContent ? (
                <span className="block" data-testid="import-scopes">
                  CSV v5: {dry.scopes.adAssets} assetów reklam + {dry.scopes.landingContent} bloków Treści Landing Page (nie są assetami Google)
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(dry.counts).map(([k, n]) => (
              <span key={k} className="rounded-full bg-black/[.05] px-2 py-0.5">
                {ROW_TYPE_LABEL[k as RowType]}: {n}
              </span>
            ))}
          </div>
          {dry.projectSlugMismatch.length ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              W pliku jest project_slug „{dry.projectSlugMismatch.join(", ")}”, a ten projekt to „{data.project.slug}”. Import trafi do bieżącego projektu.
            </p>
          ) : null}
          <details open={errors.length > 0 || Object.values(mapping).some((v) => v === null)}>
            <summary className="cursor-pointer text-sm font-medium">Mapowanie kolumn ({Object.values(mapping).filter(Boolean).length}/{dry.headers.length})</summary>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {dry.headers.map((h) => (
                <label key={h} className="flex items-center gap-2 text-xs">
                  <span className="w-36 truncate font-mono" title={h}>
                    {h}
                  </span>
                  <NativeSelect
                    className="h-8 flex-1 text-xs"
                    value={mapping[h] ?? ""}
                    aria-label={`Kolumna ${h}`}
                    onChange={(e) => {
                      const m = { ...mapping, [h]: (e.target.value || null) as AdwordsColumn | null };
                      setMapping(m);
                      void check(text, m);
                    }}
                  >
                    <option value="">— zachowaj jako dodatkową —</option>
                    {ADWORDS_COLUMNS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ))}
            </div>
          </details>
          <div className="overflow-x-auto">
            <p className="mb-1 text-sm font-medium">Pierwsze 10 rekordów</p>
            <table className="w-full text-left text-[11px]" data-testid="import-table">
              <thead>
                <tr>
                  {["row_type", "asset_id", "concept_id", "aspect_ratio", "headline", "ad_text", "screen_text"].map((c) => (
                    <th key={c} className="border-b border-line px-1.5 py-1 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dry.preview.map((r, i) => {
                  const col = (c: string) => {
                    const h = Object.entries(mapping).find(([, v]) => v === c)?.[0];
                    return h ? (r[h] ?? "") : "";
                  };
                  return (
                    <tr key={i} className="border-b border-line/60">
                      {["row_type", "asset_id", "concept_id", "aspect_ratio", "headline", "ad_text", "screen_text"].map((c) => (
                        <td key={c} className="max-w-[220px] truncate px-1.5 py-1" title={col(c)}>
                          {col(c)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.length || warnings.length ? (
            <div className="space-y-1" data-testid="import-issues">
              <p className="text-sm font-medium">
                Raport: {errors.length} błędów, {warnings.length} ostrzeżeń
              </p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                {[...errors, ...warnings].map((i, k) => (
                  <li key={k} className={i.level === "error" ? "text-red-700" : "text-amber-800"}>
                    Wiersz {i.row}
                    {i.column ? ` (${i.column})` : ""}: {i.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-emerald-700">Bez błędów.</p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy || errors.length > 0 || !data.canEdit}
              data-testid="import-confirm"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api<DryRun>(`${base}/import`, { method: "POST", json: { text, dryRun: false, mapping } });
                  toast(`Zaimportowano: ${r.created} nowych, ${r.updated} zaktualizowanych, ${r.unchanged} bez zmian${r.campaignsCreated ? `, ${r.campaignsCreated} kampanie` : ""}`);
                  setDry(null);
                  setText(null);
                  await reload();
                  onDone("creatives");
                } catch (e) {
                  toast((e as Error).message, "err");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Importuj {dry.total} rekordów
            </Button>
            <Button variant="ghost" onClick={() => (setDry(null), setText(null))}>
              Anuluj
            </Button>
          </div>
          {errors.length ? <p className="text-xs text-red-700">Popraw błędy w pliku albo w mapowaniu — import nie zapisze niczego, dopóki są błędy.</p> : null}
        </Card>
      ) : null}
      <p className={cn("text-xs text-muted")}>Kolumny: {ADWORDS_COLUMNS.join(";")}</p>
    </div>
  );
}
