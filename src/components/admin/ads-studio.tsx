"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, FileText, Film, Loader2, RefreshCw, Trash2, Upload, Wand2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Progress, useToast } from "@/components/ui";
import { api, cn, formatDate } from "@/lib/utils";
import { decodeCsv } from "@/lib/csv-import";
import { adsScriptTemplate } from "@/lib/ads-script";

// ---------------------------------------------------------------------------
// List of ad campaigns
// ---------------------------------------------------------------------------

interface AdsProjectRow {
  id: string;
  name: string;
  updatedAt: string;
  _count: { adFootage: number; adReels: number; compositions: number };
}

export function AdsList() {
  const [rows, setRows] = useState<AdsProjectRow[] | null>(null);
  const [name, setName] = useState("");
  const { toast, toastNode } = useToast();
  const load = useCallback(async () => setRows((await api<{ projects: AdsProjectRow[] }>("/api/admin/ads")).projects), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div>
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold">Ads Studio</h1>
          <p className="mt-1 text-sm text-muted">Scenariusze + surowe nagrania → reelsy pocięte z transkrypcji (hook, body, CTA).</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const p = await api<{ id: string }>("/api/admin/ads", { method: "POST", json: { name } });
              window.location.href = `/admin/ads/${p.id}`;
            } catch (err) {
              toast((err as Error).message, "err");
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nazwa kampanii, np. Upadłość — listopad" className="w-72" aria-label="Nazwa kampanii" />
          <Button type="submit" disabled={name.trim().length < 2}>
            Nowa kampania
          </Button>
        </form>
      </div>
      <div className="mt-8 grid gap-3 md:grid-cols-2">
        {rows === null ? <p className="text-sm text-muted">Wczytuję…</p> : null}
        {rows?.length === 0 ? <EmptyState title="Brak kampanii">Utwórz kampanię, wgraj plik scenariuszy i nagrania — reelsy ułożą się same.</EmptyState> : null}
        {rows?.map((p) => (
          <Link key={p.id} href={`/admin/ads/${p.id}`}>
            <Card className="p-5 transition hover:shadow-md" data-testid="ads-project">
              <div className="flex items-start justify-between">
                <p className="font-medium">{p.name}</p>
                <ArrowUpRight className="h-4 w-4 text-muted" />
              </div>
              <p className="mt-2 text-sm text-muted">
                {p._count.adReels} reelsów · {p._count.adFootage} nagrań · {p._count.compositions} ułożonych · {formatDate(p.updatedAt)}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One campaign
// ---------------------------------------------------------------------------

interface Match {
  role: string;
  text: string;
  footageId?: string;
  footageName?: string;
  start?: number;
  end?: number;
  score?: number;
  extra?: string[];
  missing?: boolean;
}
interface AdsData {
  project: { id: string; name: string };
  footage: Array<{ id: string; name: string; status: string; step: string | null; error: string | null; sizeBytes: number; durationSec: number | null; words: number }>;
  reels: Array<{ id: string; code: string; groupCode: string | null; title: string | null; parts: Array<{ role: string; text: string }>; matches: Match[] | null; compositionId: string | null; hookIndex: number | null }>;
}
interface UploadState {
  name: string;
  progress: number;
  error?: string;
}

const CHUNK = 8 * 1024 * 1024;

export function AdsProject({ id }: { id: string }) {
  const [data, setData] = useState<AdsData | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [building, setBuilding] = useState(false);
  const { toast, toastNode } = useToast();
  const scriptRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => setData(await api<AdsData>(`/api/admin/ads/${id}`)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // while files are being processed: refresh
  const busy = !!data?.footage.some((f) => f.status === "PROCESSING" || f.status === "UPLOADING") || building;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  const importScript = async (file: File) => {
    try {
      const text = decodeCsv(await file.arrayBuffer());
      const r = await api<{ created: number; updated: number; removed: number; errors: string[] }>(`/api/admin/ads/${id}/script`, { method: "POST", json: { text } });
      toast(`Scenariusze: ${r.created} nowych, ${r.updated} zaktualizowanych${r.removed ? `, ${r.removed} usuniętych` : ""}${r.errors.length ? ` · ${r.errors.length} uwag` : ""}`);
      if (r.errors.length) console.warn(r.errors);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const uploadOne = async (file: File) => {
    const key = `${file.name}-${file.size}-${Date.now()}`;
    const set = (p: Partial<UploadState>) => setUploads((u) => ({ ...u, [key]: { ...(u[key] ?? { name: file.name, progress: 0 }), ...p } }));
    set({ progress: 0 });
    try {
      const { id: fid } = await api<{ id: string }>(`/api/admin/ads/${id}/footage`, { method: "POST", json: { name: file.name, size: file.size } });
      const total = Math.max(1, Math.ceil(file.size / CHUNK));
      let done = 0;
      const send = async (i: number) => {
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(`/api/admin/ads/footage/${fid}/chunks/${i}`, { method: "PUT", body: file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)) }).catch(() => null);
          if (res?.ok) break;
          if (attempt >= 4) throw new Error("Nie udało się wysłać części pliku — sprawdź połączenie i spróbuj ponownie.");
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
        done++;
        set({ progress: done / total });
      };
      // three slices in parallel
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, total) }, async () => {
        while (next < total) await send(next++);
      }));
      await api(`/api/admin/ads/footage/${fid}/complete`, { method: "POST", json: { totalChunks: total } });
      setUploads((u) => {
        const { [key]: _done, ...rest } = u;
        void _done;
        return rest;
      });
      await load();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  };

  const build = async (rebuild = false, reelIds?: string[]) => {
    setBuilding(true);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/admin/ads/${id}/build`, { method: "POST", json: { rebuild, reelIds } });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const job = await api<{ status: string; error: string | null; result: { reels: number; built: number } | null }>(`/api/admin/jobs/${jobId}`);
        if (job.status === "FAILED") throw new Error(job.error ?? "Nie udało się ułożyć reelsów");
        if (job.status === "SUCCEEDED") {
          toast(`Ułożono ${job.result?.built ?? 0} z ${job.result?.reels ?? 0} reelsów`);
          break;
        }
      }
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBuilding(false);
    }
  };

  if (!data) return <p className="text-sm text-muted">Wczytuję…</p>;
  const ready = data.footage.filter((f) => f.status === "READY").length;
  const laid = data.reels.filter((r) => r.compositionId).length;
  const missingParts = data.reels.reduce((n, r) => n + (r.matches ?? []).filter((m) => m.missing).length, 0);
  // reels that differ only in the hook share one edit
  const groupSize = new Map<string, number>();
  for (const r of data.reels) if (r.compositionId) groupSize.set(r.compositionId, (groupSize.get(r.compositionId) ?? 0) + 1);
  const edits = groupSize.size;

  return (
    <div className="space-y-6" data-testid="ads-studio">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/ads" className="text-sm text-muted hover:text-ink">
            ← Ads Studio
          </Link>
          <h1 className="mt-1 font-display text-[28px] font-semibold">{data.project.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/admin/projects/${id}`} className="text-sm text-muted underline hover:text-ink">
            Motyw i ustawienia montażu →
          </Link>
          <Button
            variant="outline"
            className="text-red-600"
            data-testid="ads-delete"
            onClick={async () => {
              if (!confirm(`Usunąć kampanię „${data.project.name}” razem z nagraniami, reelsami i montażami? Tej operacji nie można cofnąć.`)) return;
              try {
                await api(`/api/admin/ads/${id}`, { method: "DELETE" });
                window.location.href = "/admin/ads";
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
          >
            <Trash2 /> Usuń kampanię
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-5">
          <p className="flex items-center gap-2 font-medium">
            <FileText className="h-4 w-4" /> 1. Scenariusze
          </p>
          <p className="text-sm text-muted">
            Plik CSV: <code className="rounded bg-black/[.05] px-1">reel;hook-number;tytuł;hook;body;cta</code> — jeden wiersz na wersję hooka (P01;h01…, P01;h02…). Hooki jednego reelsa to jeden montaż: body + CTA edytujesz raz.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => scriptRef.current?.click()} data-testid="ads-script-button">
              <Upload /> Wgraj scenariusze (CSV)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([adsScriptTemplate()], { type: "text/csv;charset=utf-8" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = "scenariusze-reels.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download /> Wzór pliku
            </Button>
          </div>
          <input ref={scriptRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="ads-script-input" onChange={(e) => (e.target.files?.[0] ? void importScript(e.target.files[0]) : null, (e.target.value = ""))} />
          <p className="text-sm">{data.reels.length ? `${data.reels.length} reelsów w scenariuszu` : "Brak scenariuszy"}</p>
        </Card>

        <Card className="space-y-3 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Film className="h-4 w-4" /> 2. Nagrania
          </p>
          <p className="text-sm text-muted">Surowe pliki z kamery lub telefonu (MP4, MOV, WEBM), także długie, z powtórkami. Każdy jest transkrybowany ze znacznikami czasu słów.</p>
          <Button onClick={() => videoRef.current?.click()} data-testid="ads-video-button">
            <Upload /> Wgraj pliki wideo
          </Button>
          <input
            ref={videoRef}
            type="file"
            multiple
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            className="hidden"
            data-testid="ads-video-input"
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) void uploadOne(f);
              e.target.value = "";
            }}
          />
          <ul className="space-y-1.5" data-testid="ads-footage">
            {Object.entries(uploads).map(([k, u]) => (
              <li key={k} className="rounded-lg border border-line p-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{u.name}</span>
                  <span className="text-muted">{u.error ? "błąd" : `wysyłanie ${Math.round(u.progress * 100)}%`}</span>
                </div>
                {u.error ? <p className="text-xs text-red-600">{u.error}</p> : <Progress value={u.progress * 100} className="mt-1.5" />}
              </li>
            ))}
            {data.footage.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm" data-testid="ads-footage-row" data-status={f.status}>
                <span className="min-w-0">
                  <span className="block truncate">{f.name}</span>
                  <span className={cn("block text-xs", f.status === "FAILED" ? "text-red-600" : "text-muted")}>
                    {f.status === "READY"
                      ? `Gotowe · ${f.durationSec ? `${Math.round(f.durationSec)} s` : ""} · ${f.words} słów`
                      : f.status === "FAILED"
                        ? f.error ?? "Błąd przetwarzania"
                        : f.step ?? "Przetwarzanie…"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {f.status === "PROCESSING" || f.status === "UPLOADING" ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : null}
                  {f.status === "FAILED" ? (
                    <Button size="iconSm" variant="ghost" aria-label="Przetwórz ponownie" onClick={async () => (await api(`/api/admin/ads/footage/${f.id}`, { method: "POST" }), load())}>
                      <RefreshCw />
                    </Button>
                  ) : null}
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label="Usuń nagranie"
                    onClick={async () => {
                      if (!confirm(`Usunąć „${f.name}”?`)) return;
                      await api(`/api/admin/ads/footage/${f.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium">
              <Wand2 className="h-4 w-4" /> 3. Reelsy
            </p>
            <p className="text-sm text-muted">
              {laid}/{data.reels.length} ułożonych{edits && edits < laid ? ` w ${edits} montażach (reelsy różniące się tylko hookiem montujesz raz)` : ""}{missingParts ? ` · ${missingParts} fragmentów nie znaleziono w nagraniach` : ""}. Fragmenty są wycinane z transkrypcji — ze słowami, które ekspert dodał od siebie.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void build(false)} disabled={building || !ready || !data.reels.length} data-testid="ads-build">
              {building ? <Loader2 className="animate-spin" /> : <Wand2 />} {laid ? "Ułóż brakujące" : "Ułóż reelsy"}
            </Button>
            {laid ? (
              <Button variant="outline" disabled={building || !ready} onClick={() => confirm("Ułożyć wszystkie od nowa? Zmiany wprowadzone w Studio w tych reelsach przepadną.") && void build(true)}>
                Ułóż wszystkie od nowa
              </Button>
            ) : null}
          </div>
        </div>
        {data.reels.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="ads-reels">
              <thead className="text-xs uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Reels</th>
                  <th className="py-2 pr-3 font-medium">Fragmenty</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.reels.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top" data-testid="ads-reel">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{r.groupCode ? `${r.groupCode} · ${r.code.slice(r.groupCode.length + 1)}` : r.code}</span>
                      {r.title ? <span className="block text-xs text-muted">{r.title}</span> : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(r.matches ?? r.parts.map((p) => ({ ...p, score: undefined }))).map((m, i) => (
                          <span
                            key={i}
                            title={`${m.text}${"footageName" in m && m.footageName ? `\n\n${m.footageName} · ${m.start?.toFixed(1)}–${m.end?.toFixed(1)} s` : ""}${"extra" in m && m.extra?.length ? `\nDodane przez eksperta: ${m.extra.join(" ")}` : ""}`}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs",
                              !r.matches ? "border-line text-muted" : "missing" in m && m.missing ? "border-red-200 bg-red-50 text-red-700" : (m.score ?? 0) >= 0.8 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900",
                            )}
                            data-testid="ads-part"
                            data-missing={"missing" in m && m.missing ? "true" : "false"}
                          >
                            {m.role}
                            {r.matches ? ("missing" in m && m.missing ? " · brak" : ` · ${Math.round((m.score ?? 0) * 100)}%`) : ""}
                            {"extra" in m && m.extra?.length ? " · +" : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      {r.compositionId ? (
                        <span className="flex justify-end gap-1.5">
                          {(groupSize.get(r.compositionId) ?? 1) > 1 ? (
                            <span className="self-center text-[11px] text-muted" data-testid="ads-hook-version">
                              hook {(r.hookIndex ?? 0) + 1}/{groupSize.get(r.compositionId)}
                            </span>
                          ) : null}
                          <Link href={`/studio/${r.compositionId}${r.hookIndex != null ? `?hook=${r.hookIndex}` : ""}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-black/[.03]" data-testid="ads-open-studio">
                            Studio <ArrowUpRight className="h-3 w-3" />
                          </Link>
                          <button className="rounded-lg px-2 py-1 text-xs text-muted hover:text-ink" disabled={building} onClick={() => confirm((groupSize.get(r.compositionId!) ?? 1) > 1 ? `Ułożyć od nowa montaż z ${groupSize.get(r.compositionId!)} wersjami hooka (razem z ${r.code})? Zmiany w Studio przepadną.` : `Ułożyć ${r.code} od nowa? Zmiany w Studio w tym reelsie przepadną.`) && void build(true, [r.id])}>
                            od nowa
                          </button>
                        </span>
                      ) : (
                        <Badge>nieułożony</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
