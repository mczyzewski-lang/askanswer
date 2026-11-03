"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clapperboard, Download, FileText, Film, Loader2, RefreshCw, Scissors, Star, Trash2, Upload, Wand2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Label, NativeSelect, Progress, Switch, Textarea, useToast } from "@/components/ui";
import { api, cn, formatDate } from "@/lib/utils";
import { decodeCsv } from "@/lib/csv-import";
import { adsScriptTemplate } from "@/lib/ads-script";
import { QUESTION_POSITIONS, QUESTION_STYLES } from "@/lib/question-styles";
import { SUBTITLE_PRESETS } from "@/lib/editor/subtitles";
import { THEME_PRESETS } from "@/lib/themes";
import { type Review, ReviewDialog, ScoreBadge, ScoringCounts, scoreTone } from "./content-review";
import { LeadMagnetsEditor } from "./lead-magnets-editor";
import { formatBytes, sendChunks, uploadQueue } from "@/lib/client/chunked-upload";
/** a cutaway of the basket (a clip of the B-roll edit in the Studio) */
interface Fragment {
  id: string;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
}
import { DropZone } from "@/components/drop-zone";
import type { LeadMagnet } from "@/lib/lead-magnets";

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
interface AdsLook {
  themeId: string;
  theme: { id: string; name: string; questionStyle: string; questionPosition: string; primaryColor: string; accentColor: string; highlightColor: string; backgroundColor: string; textColor: string };
  subtitlePreset: string | null;
  ctaEnabled: boolean;
  ctaUrl: string | null;
  ctaText: string | null;
  ctaSeconds: number;
  ctaPlacement: string;
  autoBlur: boolean;
  blurStrength: number;
  adsBrief: string | null;
  leadMagnets: LeadMagnet[] | null;
  adsFormat: string;
}
interface AdsData {
  project: { id: string; name: string } & AdsLook;
  footage: Array<{ id: string; name: string; status: string; step: string | null; error: string | null; sizeBytes: number; durationSec: number | null; words: number }>;
  reels: Array<{ id: string; code: string; groupCode: string | null; title: string | null; parts: Array<{ role: string; text: string }>; matches: Match[] | null; compositionId: string | null; hookIndex: number | null; review: Review | { error: string } | null; reviewedAt: string | null }>;
}
interface UploadState {
  name: string;
  progress: number;
  size?: number;
  /** waiting for its turn in the queue */
  waiting?: boolean;
  error?: string;
  /** kept for "Wgraj ponownie" */
  file?: File;
}

/** one queue for the page: footage and B-roll files go two at a time */
const runUpload = uploadQueue(2);

export function AdsProject({ id }: { id: string }) {
  const [data, setData] = useState<AdsData | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [building, setBuilding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [openReview, setOpenReview] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  const scriptRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => setData(await api<AdsData>(`/api/admin/ads/${id}`)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // while files are being processed: refresh
  const busy = !!data?.footage.some((f) => f.status === "PROCESSING" || f.status === "UPLOADING") || building || reviewing;
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
    set({ progress: 0, waiting: true, size: file.size, file });
    try {
      await runUpload(async () => {
      set({ waiting: false });
      const { id: fid } = await api<{ id: string }>(`/api/admin/ads/${id}/footage`, { method: "POST", json: { name: file.name, size: file.size } });
      const total = await sendChunks(file, (i) => `/api/admin/ads/footage/${fid}/chunks/${i}`, (progress) => set({ progress }));
      await api(`/api/admin/ads/footage/${fid}/complete`, { method: "POST", json: { totalChunks: total } });
      });
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

  const review = async (body: { reelIds?: string[]; onlyMissing?: boolean }) => {
    setReviewing(true);
    try {
      const { jobId, reels } = await api<{ jobId: string | null; reels: number }>(`/api/admin/ads/${id}/review`, { method: "POST", json: body });
      if (!jobId) return toast("Wszystkie reelsy mają już ocenę");
      toast(`Oceniam ${reels} ${reels === 1 ? "reels" : "reelsów"}…`);
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const job = await api<{ status: string; error: string | null; result: { reviewed: number; failed: number; error?: string | null } | null }>(`/api/admin/jobs/${jobId}`);
        if (job.status === "FAILED") throw new Error(job.error ?? "Ocena nie powiodła się");
        if (job.status === "SUCCEEDED") {
          toast(`Ocenione: ${job.result?.reviewed ?? 0}${job.result?.failed ? ` · błędy: ${job.result.failed}${job.result.error ? ` — ${job.result.error}` : ""}` : ""}`, job.result?.failed ? "err" : "ok");
          break;
        }
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setReviewing(false);
      await load();
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
  // before laying out everything: one test reel (with its hook versions) to check the look
  const plannedEdits = new Set(data.reels.map((r) => r.groupCode ?? r.code)).size;
  const extraHooks = data.reels.length - plannedEdits;
  const testReel = data.reels.find((r) => r.compositionId) ?? null;
  const allLabel = `${plannedEdits} ${plannedEdits === 1 ? "reels" : "reelsów"}${extraHooks ? ` z ${extraHooks} dodatkowymi hookami` : ""}`;

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
        <DropZone accept=".csv,text/csv" multiple={false} label="Upuść plik CSV ze scenariuszami" onFiles={(files) => void importScript(files[0])} onRejected={(n) => toast(`Pominięto (zły typ pliku): ${n.join(", ")}`, "err")} className="rounded-2xl [&>*:first-child]:h-full" data-testid="ads-script-drop">
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
        </DropZone>

        <DropZone accept="video/*,.mp4,.mov,.webm,.m4v" multiple={true} label="Upuść pliki wideo — wyślą się po 2 naraz" onFiles={(files) => files.forEach((f) => void uploadOne(f))} onRejected={(n) => toast(`Pominięto (zły typ pliku): ${n.join(", ")}`, "err")} className="rounded-2xl [&>*:first-child]:h-full" data-testid="ads-video-drop">
          <Card className="space-y-3 p-5">
            <p className="flex items-center gap-2 font-medium">
              <Film className="h-4 w-4" /> 2. Nagrania
            </p>
            <p className="text-sm text-muted">Surowe pliki z kamery lub telefonu (MP4, MOV, WEBM), także długie, z powtórkami. Każdy jest transkrybowany ze znacznikami czasu słów.</p>
            <Button onClick={() => videoRef.current?.click()} data-testid="ads-video-button">
              <Upload /> Wgraj pliki wideo (albo przeciągnij tutaj)
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
                    <span className="shrink-0 text-muted">
                      {u.size ? `${formatBytes(u.size)} · ` : ""}
                      {u.error ? "błąd" : u.waiting ? "w kolejce" : u.progress >= 1 ? "składanie pliku…" : `wysyłanie ${Math.round(u.progress * 100)}%`}
                    </span>
                  </div>
                  {u.error ? (
                    <p className="flex items-center justify-between gap-2 text-xs text-red-600">
                      {u.error}
                      {u.file ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          data-testid="upload-retry"
                          onClick={() => {
                            setUploads(({ [k]: _gone, ...rest }) => (void _gone, rest));
                            void uploadOne(u.file!);
                          }}
                        >
                          <RefreshCw /> Wgraj ponownie
                        </Button>
                      ) : null}
                    </p>
                  ) : (
                    <Progress value={u.progress} className="mt-1.5" />
                  )}
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
        </DropZone>
      </div>

      {openReview ? (
        <ReelReviewDialog
          reel={data.reels.find((x) => x.id === openReview)!}
          siblings={data.reels.filter((x) => { const me = data.reels.find((y) => y.id === openReview); return !!me?.groupCode && x.groupCode === me.groupCode; }).length}
          onClose={() => setOpenReview(null)}
          onReview={() => void review({ reelIds: [openReview] })}
          reviewing={reviewing}
          reload={load}
          toast={toast}
        />
      ) : null}

      <AdsLookCard project={data.project} reload={load} toast={toast} />

      <BrollCard projectId={id} toast={toast} />

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
          <div className="flex flex-wrap gap-2">
            {!laid ? (
              <Button onClick={() => void build(false, [data.reels[0].id])} disabled={building || !ready || !data.reels.length} data-testid="ads-build-test">
                {building ? <Loader2 className="animate-spin" /> : <Wand2 />} Ułóż reels testowy
              </Button>
            ) : null}
            <Button
              variant={laid ? undefined : "outline"}
              onClick={() => (laid || confirm(`Ułożyć od razu wszystkie ${allLabel}, bez sprawdzenia reelsa testowego?`)) && void build(false)}
              disabled={building || !ready || !data.reels.length || (laid > 0 && laid === data.reels.length)}
              data-testid="ads-build"
            >
              {building && laid ? <Loader2 className="animate-spin" /> : laid ? <Wand2 /> : null} {laid ? (laid === data.reels.length ? "Wszystkie ułożone" : `Generuj wszystkie: ${allLabel}`) : `Od razu wszystkie (${allLabel})`}
            </Button>
            {laid ? (
              <Button variant="outline" disabled={building || !ready} onClick={() => confirm("Ułożyć wszystkie od nowa? Zmiany wprowadzone w Studio w tych reelsach przepadną.") && void build(true)}>
                Ułóż wszystkie od nowa
              </Button>
            ) : null}
          </div>
        </div>
        {testReel && laid < data.reels.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="ads-test-reel">
            <span>
              <b>Reels testowy gotowy: {testReel.groupCode ?? testReel.code}</b> — sprawdź w Studio wygląd, napisy, przebitki i ekran końcowy. Jeśli jest dobrze, wygeneruj wszystkie; jeśli nie — popraw ustawienia wyglądu i ułóż go „od nowa”.
            </span>
            <Link href={`/studio/${testReel.compositionId}${testReel.hookIndex != null ? `?hook=${testReel.hookIndex}` : ""}`} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white">
              Otwórz w Studio <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        ) : null}
        {data.reels.length ? <ScoringBar project={data.project} reels={data.reels} reviewing={reviewing} review={review} reload={load} toast={toast} /> : null}
        {data.reels.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="ads-reels">
              <thead className="text-xs uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Reels</th>
                  <th className="py-2 pr-3 font-medium">Fragmenty</th>
                  <th className="py-2 pr-3 font-medium">Ocena</th>
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
                    <td className="py-2.5 pr-3">
                      <ScoreBadge review={r.review} onOpen={() => setOpenReview(r.id)} onReview={() => void review({ reelIds: [r.id] })} disabled={reviewing} />
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

/**
 * The look of every reel of the campaign: theme (own, or copied from another project), the title at
 * the top, subtitles, background blur and the CTA end screen. Applied to all reels (also laid out ones).
 */
function AdsLookCard({ project, reload, toast }: { project: AdsData["project"]; reload: () => Promise<void>; toast: (t: string, tone?: "ok" | "err") => void }) {
  const [themes, setThemes] = useState<Array<{ id: string; name: string; isPreset: boolean }>>([]);
  const [cta, setCta] = useState({ ctaEnabled: project.ctaEnabled, ctaUrl: project.ctaUrl ?? "", ctaText: project.ctaText ?? "", ctaSeconds: project.ctaSeconds, ctaPlacement: project.ctaPlacement });
  useEffect(() => {
    void api<Array<{ id: string; name: string; isPreset: boolean }>>("/api/admin/themes").then(setThemes).catch(() => {});
  }, []);
  const saveProject = async (data: Record<string, unknown>, msg = "Zapisano — obejmuje wszystkie reelsy kampanii") => {
    try {
      await api(`/api/admin/projects/${project.id}`, { method: "PATCH", json: data });
      toast(msg);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const saveTheme = async (data: Record<string, unknown>) => {
    try {
      await api(`/api/admin/themes/${project.themeId}`, { method: "PATCH", json: data });
      toast("Zapisano styl tytułu");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const useTheme = async (body: { themeId?: string; preset?: string }) => {
    try {
      await api(`/api/admin/ads/${project.id}/theme`, { method: "POST", json: body });
      toast("Motyw kampanii zmieniony");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const t = project.theme;
  return (
    <Card className="space-y-5 p-5" data-testid="ads-look">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Wygląd reelsów</p>
          <p className="text-sm text-muted">Motyw, tytuł nad reelsem, napisy i ekran końcowy — dla wszystkich reelsów kampanii, także już ułożonych.</p>
        </div>
        <Link href={`/admin/themes?theme=${project.themeId}`} className="text-sm text-muted underline hover:text-ink">
          Kolory, czcionki i logo motywu →
        </Link>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Motyw</Label>
          <div className="flex items-center gap-2">
            {[t.backgroundColor, t.primaryColor, t.accentColor, t.highlightColor, t.textColor].map((c, i) => (
              <span key={i} className="h-6 w-6 rounded-md border border-line" style={{ background: c }} />
            ))}
            <span className="text-sm text-muted">{t.name}</span>
          </div>
          <NativeSelect
            value=""
            aria-label="Użyj motywu"
            data-testid="ads-theme-from"
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              void useTheme(v.startsWith("preset:") ? { preset: v.slice(7) } : { themeId: v });
            }}
          >
            <option value="">Użyj innego motywu…</option>
            <optgroup label="Motywy projektów (kopia — oryginał bez zmian)">
              {themes
                .filter((x) => !x.isPreset && x.id !== project.themeId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Gotowe palety">
              {THEME_PRESETS.map((p) => (
                <option key={p.key} value={`preset:${p.key}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label>Tytuł nad reelsem</Label>
          <div className="flex flex-wrap gap-1.5" data-testid="ads-title-style">
            {QUESTION_STYLES.map((q) => (
              <button key={q.id} type="button" aria-pressed={t.questionStyle === q.id} onClick={() => void saveTheme({ questionStyle: q.id })} className={cn("rounded-lg border px-2.5 py-1 text-xs", t.questionStyle === q.id ? "border-ink bg-ink text-white" : "border-line hover:border-black/20")} title={q.hint}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUESTION_POSITIONS.map((q) => (
              <button key={q.id} type="button" aria-pressed={t.questionPosition === q.id} onClick={() => void saveTheme({ questionPosition: q.id })} className={cn("rounded-lg border px-2.5 py-1 text-xs", t.questionPosition === q.id ? "border-ink bg-ink text-white" : "border-line hover:border-black/20")}>
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ads-subs">Napisy</Label>
          <NativeSelect id="ads-subs" value={project.subtitlePreset ?? ""} onChange={(e) => void saveProject({ subtitlePreset: e.target.value || null })} data-testid="ads-subtitles">
            <option value="">Domyślne edytora</option>
            {Object.entries(SUBTITLE_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted">Kolory napisów i podświetlenia biorą się z motywu. Pozycję i rozmiar zmienisz w Studio.</p>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Rozmyte tło za ekspertem
              <span className="block text-xs text-muted">Siła: {project.blurStrength}</span>
            </span>
            <Switch checked={project.autoBlur} onCheckedChange={(v) => void saveProject({ autoBlur: v })} />
          </label>
          {project.autoBlur ? <input type="range" min={5} max={100} step={5} defaultValue={project.blurStrength} onMouseUp={(e) => void saveProject({ blurStrength: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void saveProject({ blurStrength: Number((e.target as HTMLInputElement).value) })} aria-label="Siła rozmycia" className="w-full" /> : null}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-line p-3" data-testid="ads-end-screen">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Ekran końcowy (CTA)
            <span className="block text-xs text-muted">Adres strony z podpisem, w kolorach motywu — na końcu każdego reelsa.</span>
          </span>
          <Switch checked={cta.ctaEnabled} onCheckedChange={(v) => setCta({ ...cta, ctaEnabled: v })} />
        </label>
        {cta.ctaEnabled ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
            <div className="space-y-1">
              <Label htmlFor="ads-cta-url">Adres strony</Label>
              <Input id="ads-cta-url" value={cta.ctaUrl} placeholder="np. kancelaria.pl" onChange={(e) => setCta({ ...cta, ctaUrl: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ads-cta-text">Podpis</Label>
              <Input id="ads-cta-text" value={cta.ctaText} placeholder="np. Zrób bezpłatny test" onChange={(e) => setCta({ ...cta, ctaText: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ads-cta-sec">Czas (s)</Label>
              <Input id="ads-cta-sec" type="number" min={1} max={10} value={cta.ctaSeconds} onChange={(e) => setCta({ ...cta, ctaSeconds: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 3))) })} />
            </div>
            <div className="flex gap-2 sm:col-span-3">
              {(
                [
                  ["append", "Dodaj po filmie"],
                  ["overlay", "Nałóż na końcówkę"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={cta.ctaPlacement === v} onClick={() => setCta({ ...cta, ctaPlacement: v })} className={cn("rounded-lg border px-2.5 py-1 text-xs", cta.ctaPlacement === v ? "border-ink bg-ink text-white" : "border-line hover:border-black/20")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Button size="sm" onClick={() => void saveProject({ ...cta, ctaUrl: cta.ctaUrl.trim() || null, ctaText: cta.ctaText.trim() || null })} data-testid="ads-end-screen-save">
          Zapisz ekran końcowy
        </Button>
      </div>
    </Card>
  );
}

interface BrollItem {
  id: string;
  url: string;
  proxyUrl?: string | null;
  name: string;
  picked: boolean;
  isVideo: boolean;
  durationSec: number | null;
}

/** B-roll (cutaways): upload clips, pick the ones to use — they are offered in the Studio of every reel. */
function BrollCard({ projectId, toast }: { projectId: string; toast: (t: string, tone?: "ok" | "err") => void }) {
  const [items, setItems] = useState<BrollItem[] | null>(null);
  const [pending, setPending] = useState<Array<{ id: string; name: string; status: string; error: string | null; sizeBytes: number }>>([]);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  // failed conversions the user chose to upload again (hidden from the list)
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [perReel, setPerReel] = useState(2);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const d = await api<{ items: BrollItem[]; pending?: typeof pending; fragments?: Fragment[]; perReel?: number; studioId?: string | null }>(`/api/admin/ads/${projectId}/broll`);
    setStudioId(d.studioId ?? null);
    setItems(d.items);
    setPending(d.pending ?? []);
    setFragments(d.fragments ?? []);
    if (d.perReel != null) setPerReel(d.perReel);
  }, [projectId]);
  /** all B-roll videos in one Studio edit: cut there, every clip left on the timeline is a cutaway */
  const openStudio = async () => {
    setOpening(true);
    try {
      const { compositionId } = await api<{ compositionId: string }>(`/api/admin/ads/${projectId}/broll/studio`, { method: "POST" });
      window.location.href = `/studio/${compositionId}`;
    } catch (e) {
      toast((e as Error).message, "err");
      setOpening(false);
    }
  };
  const savePerReel = async (n: number) => {
    setPerReel(n);
    await api(`/api/admin/projects/${projectId}`, { method: "PATCH", json: { adsBrollPerReel: n } }).catch((e) => toast((e as Error).message, "err"));
  };
  useEffect(() => {
    void load();
  }, [load]);
  // converting on the server: refresh until done
  const converting = pending.some((p) => p.status === "PROCESSING");
  useEffect(() => {
    if (!converting) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [converting, load]);
  const uploadOne = async (f: File) => {
    const key = `${f.name}-${f.size}-${Date.now()}`;
    const set = (p: Partial<UploadState>) => setUploads((u) => ({ ...u, [key]: { ...(u[key] ?? { name: f.name, progress: 0 }), ...p } }));
    const drop = () => setUploads(({ [key]: _gone, ...rest }) => (void _gone, rest));
    set({ progress: 0, waiting: true, size: f.size, file: f });
    try {
      await runUpload(async () => {
        set({ waiting: false });
        if (!f.type.startsWith("video/")) {
          // a still image: one request
          const fd = new FormData();
          fd.set("file", f);
          const res = await fetch(`/api/admin/ads/${projectId}/broll`, { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? `Błąd HTTP ${res.status}`);
          return;
        }
        // a video of any size: in slices, converted by the worker afterwards
        const { id: sid } = await api<{ id: string }>(`/api/admin/ads/${projectId}/broll/uploads`, { method: "POST", json: { name: f.name, size: f.size } });
        const total = await sendChunks(f, (i) => `/api/admin/uploads/${sid}/chunks/${i}`, (progress) => set({ progress }));
        await api(`/api/admin/uploads/${sid}/complete`, { method: "POST", json: { totalChunks: total } });
      });
      drop();
    } catch (e) {
      set({ error: (e as Error).message });
      toast(`${f.name}: ${(e as Error).message}`, "err");
    } finally {
      await load();
    }
  };
  const upload = async (files: File[]) => {
    await Promise.all(files.map((f) => uploadOne(f)));
  };
  const pick = async (it: BrollItem) => {
    setItems((xs) => xs?.map((x) => (x.id === it.id ? { ...x, picked: !x.picked } : x)) ?? null);
    await api(`/api/admin/ads/broll/${it.id}`, { method: "PATCH", json: { picked: !it.picked } }).catch((e) => toast((e as Error).message, "err"));
  };
  const picked = items?.filter((i) => i.picked).length ?? 0;
  return (
    <DropZone accept="video/*,image/png,image/jpeg,image/webp,.mp4,.mov,.webm" multiple={true} label="Upuść przebitki (wideo lub zdjęcia)" onFiles={(files) => void upload(files)} onRejected={(n) => toast(`Pominięto (zły typ pliku): ${n.join(", ")}`, "err")} className="rounded-2xl" data-testid="ads-broll-drop">
      <Card className="space-y-3 p-5" data-testid="ads-broll">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium">
              <Clapperboard className="h-4 w-4" /> B-roll (przebitki)
            </p>
            <p className="text-sm text-muted">Wgraj przebitki (MP4, MOV, WEBM do 10 min — także duże pliki z aparatu, wysyłane w częściach — lub zdjęcia) i zaznacz gwiazdką te do montażu — w Studio każdego reelsa są w Grafika → B-roll, do wstawienia jednym kliknięciem.</p>
          </div>
          <Button onClick={() => ref.current?.click()} data-testid="ads-broll-button">
            {Object.keys(uploads).length || converting ? <Loader2 className="animate-spin" /> : <Upload />} Wgraj przebitki
          </Button>
          <input
            ref={ref}
            type="file"
            multiple
            accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
            className="hidden"
            data-testid="ads-broll-input"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        {Object.keys(uploads).length || pending.some((p) => !dismissed.includes(p.id)) ? (
          <ul className="space-y-1.5" data-testid="ads-broll-uploads">
            {Object.entries(uploads).map(([k, u]) => (
              <li key={k} className="rounded-lg border border-line p-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{u.name}</span>
                  <span className="shrink-0 text-muted">
                    {u.size ? `${formatBytes(u.size)} · ` : ""}
                    {u.error ? "błąd" : u.waiting ? "w kolejce" : `wysyłanie ${Math.round(u.progress * 100)}%`}
                  </span>
                </div>
                {u.error ? (
                  <p className="flex items-center justify-between gap-2 text-xs text-red-600">
                    {u.error}
                    {u.file ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        data-testid="upload-retry"
                        onClick={() => {
                          setUploads(({ [k]: _gone, ...rest }) => (void _gone, rest));
                          void uploadOne(u.file!);
                        }}
                      >
                        <RefreshCw /> Wgraj ponownie
                      </Button>
                    ) : null}
                  </p>
                ) : (
                  <Progress value={u.progress} className="mt-1.5" />
                )}
              </li>
            ))}
            {pending
              .filter((p) => p.status !== "UPLOADING" && !dismissed.includes(p.id))
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm" data-testid="ads-broll-pending" data-status={p.status}>
                  <span className="truncate">{p.name}</span>
                  <span className={cn("flex shrink-0 items-center gap-2 text-xs", p.status === "FAILED" ? "text-red-600" : "text-muted")}>
                    {p.status === "FAILED" ? (
                      <>
                        {p.error ?? "Błąd przetwarzania"}
                        <Button size="sm" variant="outline" data-testid="upload-retry" onClick={() => {
                          setDismissed((d) => [...d, p.id]);
                          ref.current?.click();
                        }}>
                          <RefreshCw /> Wgraj ponownie
                        </Button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> konwersja na serwerze · {formatBytes(p.sizeBytes)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
        {items?.length ? (
          <>
            <p className="text-xs text-muted">
              {items.length} przebitek · {picked} wybranych do montażu
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-black/[.015] p-3 text-sm" data-testid="broll-basket">
              <span>
                <b>Koszyk przebitek: {fragments.length}</b> z {new Set(fragments.map((f) => f.assetId)).size} wideo
              </span>
              {items.some((i) => i.isVideo) ? (
                <Button size="sm" onClick={() => void openStudio()} disabled={opening} data-testid="broll-open-studio">
                  {opening ? <Loader2 className="animate-spin" /> : <Scissors />} {studioId ? "Potnij w Studio" : "Potnij w Studio (wszystkie wideo w jednym ciągu)"}
                </Button>
              ) : null}
              <label className="flex items-center gap-2">
                W każdym reelsie losowo
                <NativeSelect value={String(perReel)} onChange={(e) => void savePerReel(Number(e.target.value))} aria-label="Przebitek na reels" className="h-8 w-16">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
                przebitek
              </label>
              <span className="basis-full text-xs text-muted">
                W Studio wszystkie wideo B-roll leżą w jednym ciągu — tnij je jak reels (dziel, usuwaj zbędne kawałki). <b>Każdy klip, który zostanie na osi czasu, to osobna przebitka.</b> Nowo wgrane wideo dopisują się na końcu. Przebitki trafiają losowo w treść reelsów (nie na hook i nie na CTA), wyciszone, do 3,5 s; już ułożone reelsy zmienia „od nowa”.
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
              {items.map((it) => (
                <div key={it.id} className={cn("group relative overflow-hidden rounded-lg border-2 bg-black", it.picked ? "border-amber-400" : "border-transparent")} data-testid="ads-broll-item" data-picked={it.picked}>
                  {it.isVideo ? (
                    <video src={it.proxyUrl ?? it.url} className="aspect-[9/16] w-full object-cover" muted loop playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.url} alt="" className="aspect-[9/16] w-full object-cover" />
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[10.5px] text-white">
                    {it.name}
                    {it.durationSec ? ` · ${it.durationSec.toFixed(1)} s` : ""}
                  </span>
                  {it.isVideo && fragments.some((f) => f.assetId === it.id) ? (
                  <span className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-ink shadow" data-testid="broll-cut-count">
                    {fragments.filter((f) => f.assetId === it.id).length} w koszyku
                  </span>
                ) : null}
                  <button type="button" onClick={() => void pick(it)} aria-pressed={it.picked} aria-label={it.picked ? "Odznacz" : "Wybierz do montażu"} className={cn("absolute left-1 top-1 rounded-full p-1", it.picked ? "bg-amber-400 text-black" : "bg-black/50 text-white")} data-testid="ads-broll-pick">
                    <Star className="h-3.5 w-3.5" fill={it.picked ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    aria-label="Usuń przebitkę"
                    className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    onClick={async () => {
                      if (!confirm(`Usunąć „${it.name}” z biblioteki?`)) return;
                      await api(`/api/admin/ads/broll/${it.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : items && !Object.keys(uploads).length && !pending.filter((p) => !dismissed.includes(p.id)).length ? (
          <p className="text-sm text-muted">Brak przebitek.</p>
        ) : null}
        
      </Card>
    </DropZone>
  );
}

type ReelRow = AdsData["reels"][number];

/** Scoring of the scripts: format, target group / service (context for the editor), score buttons, script export. */
function ScoringBar({ project, reels, reviewing, review, reload, toast }: { project: AdsData["project"]; reels: ReelRow[]; reviewing: boolean; review: (b: { onlyMissing?: boolean }) => Promise<void>; reload: () => Promise<void>; toast: (t: string, tone?: "ok" | "err") => void }) {
  const [brief, setBrief] = useState(project.adsBrief ?? "");
  const scored = reels.filter((r) => r.review && "score" in r.review);
  const avg = scored.length ? Math.round(scored.reduce((n, r) => n + ((r.review as Review).score ?? 0), 0) / scored.length) : null;
  const missing = reels.filter((r) => !r.reviewedAt || (r.review && "score" in r.review && r.review.applied)).length;
  const save = async (data: Record<string, unknown>) => {
    try {
      await api(`/api/admin/projects/${project.id}`, { method: "PATCH", json: data });
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-line bg-black/[.015] p-3" data-testid="ads-scoring">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Scoring treści {avg != null ? <span className={cn("ml-1 rounded-full border px-2 py-0.5 text-xs", scoreTone(avg))}>średnio {avg}/100</span> : null}
          <ScoringCounts reviews={reels.map((r) => r.review)} />
          <span className="block text-xs font-normal text-muted">Ocena według wytycznych redaktora rolek (hook, napięcie, tempo, payoff, udostępnienia, CTA…) i nowa wersja do podmiany — OpenAI.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void review({ onlyMissing: true })} disabled={reviewing || !missing} data-testid="ads-review-missing">
            {reviewing ? <Loader2 className="animate-spin" /> : <Wand2 />} {missing ? `Oceń nieocenione (${missing})` : "Wszystkie ocenione"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => confirm(`Ocenić od nowa wszystkie ${reels.length} reelsów? To ${reels.length} zapytań do OpenAI.`) && void review({})} disabled={reviewing}>
            Oceń wszystkie od nowa
          </Button>
          <a href={`/api/admin/ads/${project.id}/script`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium hover:bg-black/[.03]" data-testid="ads-script-export">
            <Download className="h-3.5 w-3.5" /> Scenariusze (CSV)
          </a>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          <Label htmlFor="ads-format">Format rolek</Label>
          <NativeSelect id="ads-format" value={project.adsFormat} onChange={(e) => void save({ adsFormat: e.target.value })}>
            <option value="[EKSPERT]">Ekspert</option>
            <option value="[PYTANIE]">Pytanie</option>
            <option value="[TALKING HEAD KLIENTA]">Talking head klienta</option>
            <option value="[INNY]">Inny</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ads-brief">Grupa docelowa i usługa</Label>
          <Textarea id="ads-brief" rows={2} value={brief} placeholder="np. osoby z długami powyżej 30 tys. zł, które nie dają rady spłacać rat — usługa: upadłość konsumencka" onChange={(e) => setBrief(e.target.value)} onBlur={() => brief !== (project.adsBrief ?? "") && void save({ adsBrief: brief.trim() || null })} />
        </div>
      </div>
      <div className="mt-3">
        <LeadMagnetsEditor value={project.leadMagnets} onSave={(leadMagnets) => save({ leadMagnets })} />
      </div>
    </div>
  );
}


/** The review of one reel; "Podmień treść" changes body / CTA of all hook versions of the reel. */
function ReelReviewDialog({ reel, siblings, onClose, onReview, reviewing, reload, toast }: { reel: ReelRow; siblings: number; onClose: () => void; onReview: () => void; reviewing: boolean; reload: () => Promise<void>; toast: (t: string, tone?: "ok" | "err") => void }) {
  const apply = async (body: { mode: "all" } | { mode: "hook"; text: string }) => {
    const shared = body.mode === "all" && siblings > 1;
    if (!confirm(body.mode === "hook" ? "Podmienić hook w scenariuszu na tę propozycję?" : `Podmienić treść reelsa na nową wersję?${shared ? ` Body i CTA zmienią się we wszystkich ${siblings} wersjach hooka tego reelsa.` : ""} Trzeba ją będzie nagrać i ułożyć ponownie.`)) return;
    try {
      const r = await api<{ changed: number }>(`/api/admin/ads/reels/${reel.id}/apply`, { method: "POST", json: body });
      toast(`Podmieniono treść (${r.changed} ${r.changed === 1 ? "wiersz" : "wiersze"} scenariusza) — pobierz nowe scenariusze i nagraj zmienione fragmenty`);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const title = `Ocena · ${reel.groupCode ? `${reel.groupCode} · ${reel.code.slice(reel.groupCode.length + 1)}` : reel.code}${reel.title ? ` — ${reel.title}` : ""}`;
  const part = (role: string) => reel.parts.filter((p) => p.role === role).map((p) => p.text.trim()).join("\n");
  const current = { hook: part("hook"), rest: [part("body"), part("cta")].filter(Boolean).join("\n\n") };
  return <ReviewDialog title={title} review={reel.review} reviewedAt={reel.reviewedAt} onClose={onClose} onReview={onReview} reviewing={reviewing} onApply={apply} current={current} />;
}
