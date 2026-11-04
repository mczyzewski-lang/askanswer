"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Download, GraduationCap, Loader2, Play, RefreshCw, Scissors, Trash2, Upload } from "lucide-react";
import { Button, Card, EmptyState, Label, NativeSelect, Progress, Switch, useToast } from "@/components/ui";
import { DropZone } from "@/components/drop-zone";
import { api, cn, formatDate, plural } from "@/lib/utils";
import { formatBytes, sendChunks, uploadQueue } from "@/lib/client/chunked-upload";
import { CUT_LABELS, EDU_QUALITY, EDU_RESOLUTIONS, fmtTime, keepRanges, keptDuration, pauseCuts, type EduCut, type EduCutKind, type EduQuality, type EduResolution } from "@/lib/edu";

const STATUS: Record<string, string> = { UPLOADING: "wysyłanie", PROCESSING: "analiza", READY: "do przeglądu", EXPORTING: "eksport", DONE: "gotowe", FAILED: "błąd" };
const runUpload = uploadQueue(2);
const ACCEPT = "video/*,.mp4,.mov,.webm,.m4v";

interface Row {
  id: string;
  name: string;
  status: string;
  step: string | null;
  error: string | null;
  sizeBytes: number;
  durationSec: number | null;
  cuts: number;
  createdAt: string;
}

/** EduStudio: the list of videos and the upload (drag & drop or a button; large files in slices). */
export function EduList() {
  const { toast, toastNode } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [uploads, setUploads] = useState<Record<string, { name: string; size: number; progress: number; waiting: boolean; error?: string; file: File }>>({});
  const ref = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => setRows((await api<{ videos: Row[] }>("/api/admin/edu")).videos), []);
  useEffect(() => {
    void load();
  }, [load]);
  const busy = rows?.some((r) => r.status === "PROCESSING" || r.status === "EXPORTING" || r.status === "UPLOADING");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [busy, load]);

  const uploadOne = async (f: File) => {
    const key = `${f.name}-${f.size}-${Date.now()}`;
    const set = (p: Partial<(typeof uploads)[string]>) => setUploads((u) => ({ ...u, [key]: { ...(u[key] ?? { name: f.name, size: f.size, progress: 0, waiting: true, file: f }), ...p } }));
    set({});
    try {
      await runUpload(async () => {
        set({ waiting: false });
        const { sessionId } = await api<{ id: string; sessionId: string }>("/api/admin/edu", { method: "POST", json: { name: f.name, size: f.size } });
        await load();
        const total = await sendChunks(f, (i) => `/api/admin/uploads/${sessionId}/chunks/${i}`, (progress) => set({ progress }));
        await api(`/api/admin/uploads/${sessionId}/complete`, { method: "POST", json: { totalChunks: total } });
      });
      setUploads(({ [key]: _gone, ...rest }) => (void _gone, rest));
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      await load();
    }
  };

  return (
    <div className="space-y-6" data-testid="edu-studio">
      {toastNode}
      <div>
        <h1 className="flex items-center gap-2 font-display text-[28px] font-semibold">
          <GraduationCap className="h-7 w-7" /> EduStudio
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Wgraj nagranie edukacyjne (kurs, webinar, szkolenie). AI przesłucha je i zaproponuje wycięcie uwag dla montażysty („to wytnij”, „tu wstaw slajd”), nieudanych podejść i rozmów poza nagraniem; za długie przerwy skróci. Przejrzysz cięcia, a potem pobierzesz jeden, zoptymalizowany plik MP4.
        </p>
      </div>
      <DropZone accept={ACCEPT} label="Upuść nagrania — wyślą się po 2 naraz" onFiles={(fs) => fs.forEach((f) => void uploadOne(f))} onRejected={(n) => toast(`Pominięto (to nie wideo): ${n.join(", ")}`, "err")} className="rounded-2xl" data-testid="edu-drop">
        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed p-5">
          <p className="text-sm text-muted">MP4, MOV, WEBM — także duże pliki (wysyłane w częściach). Przeciągnij tutaj albo wybierz z dysku.</p>
          <Button onClick={() => ref.current?.click()} data-testid="edu-upload">
            <Upload /> Wgraj wideo
          </Button>
          <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden" data-testid="edu-input" onChange={(e) => (Array.from(e.target.files ?? []).forEach((f) => void uploadOne(f)), (e.target.value = ""))} />
        </Card>
      </DropZone>
      {Object.keys(uploads).length ? (
        <ul className="space-y-1.5">
          {Object.entries(uploads).map(([k, u]) => (
            <li key={k} className="rounded-lg border border-line p-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate">{u.name}</span>
                <span className="shrink-0 text-muted">
                  {formatBytes(u.size)} · {u.error ? "błąd" : u.waiting ? "w kolejce" : `wysyłanie ${Math.round(u.progress * 100)}%`}
                </span>
              </div>
              {u.error ? (
                <p className="flex items-center justify-between gap-2 text-xs text-red-600">
                  {u.error}
                  <Button size="sm" variant="outline" onClick={() => (setUploads(({ [k]: _g, ...rest }) => (void _g, rest)), void uploadOne(u.file))}>
                    <RefreshCw /> Wgraj ponownie
                  </Button>
                </p>
              ) : (
                <Progress value={u.progress} className="mt-1.5" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {rows?.length ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/admin/edu/${r.id}`} className="group block" data-testid="edu-row" data-status={r.status}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition group-hover:shadow-md">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="truncate">{r.name}</span> <ArrowUpRight className="h-4 w-4 text-muted opacity-0 group-hover:opacity-100" />
                  </span>
                  <span className={cn("block text-xs", r.status === "FAILED" ? "text-red-600" : "text-muted")}>
                    {STATUS[r.status] ?? r.status}
                    {r.status === "PROCESSING" && r.step ? ` · ${r.step}` : ""}
                    {r.error && r.status === "FAILED" ? ` · ${r.error}` : ""}
                    {r.durationSec ? ` · ${fmtTime(r.durationSec)}` : ""} · {formatBytes(Number(r.sizeBytes))}
                    {r.cuts ? ` · ${r.cuts} propozycji cięć` : ""} · {formatDate(r.createdAt)}
                  </span>
                </span>
                {r.status === "PROCESSING" || r.status === "EXPORTING" ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : null}
              </Card>
            </Link>
          ))}
        </div>
      ) : rows ? (
        <EmptyState icon={<GraduationCap className="h-8 w-8" />} title="Brak nagrań">
          Wgraj pierwsze nagranie edukacyjne.
        </EmptyState>
      ) : null}
    </div>
  );
}

interface Detail {
  id: string;
  name: string;
  status: string;
  step: string | null;
  error: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  words: number;
  pauses: Array<{ start: number; end: number }> | null;
  cuts: EduCut[] | null;
  summary: string | null;
  pauseMin: number;
  exportProgress: number;
  exportSettings: { quality?: EduQuality; resolution?: EduResolution } | null;
  proxyUrl: string | null;
  originalUrl: string | null;
  originalSize: number;
  export: { url: string; size: number; durationSec: number | null } | null;
}

/** One video: the proposed cuts to review (with a preview), the pause threshold, the export and download. */
export function EduDetail({ id }: { id: string }) {
  const { toast, toastNode } = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [quality, setQuality] = useState<EduQuality>("standard");
  const [resolution, setResolution] = useState<EduResolution>("source");
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const load = useCallback(async () => {
    const x = await api<Detail>(`/api/admin/edu/${id}`);
    setD(x);
    if (x.exportSettings?.quality) setQuality(x.exportSettings.quality);
    if (x.exportSettings?.resolution) setResolution(x.exportSettings.resolution);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const busy = d?.status === "PROCESSING" || d?.status === "EXPORTING" || d?.status === "UPLOADING";
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  const cuts = useMemo(() => d?.cuts ?? [], [d]);
  const pauses = useMemo(() => d?.pauses ?? [], [d]);
  const keep = useMemo(() => (d?.durationSec ? keepRanges(d.durationSec, cuts, pauses, d.pauseMin) : []), [d, cuts, pauses]);
  if (!d) return <p className="text-sm text-muted">Wczytuję…</p>;
  const after = keptDuration(keep);
  const longPauses = pauseCuts(pauses, d.pauseMin);
  const ready = d.status === "READY" || d.status === "DONE";

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/admin/edu/${id}`, { method: "PATCH", json: body });
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const preview = (start: number, end: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, start - 1);
    stopAt.current = end + 1;
    void v.play().catch(() => {});
  };
  const exportNow = async () => {
    try {
      await api(`/api/admin/edu/${id}/export`, { method: "POST", json: { quality, resolution } });
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="space-y-6" data-testid="edu-detail">
      {toastNode}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/edu" className="text-sm text-muted hover:text-ink">
            ← EduStudio
          </Link>
          <h1 className="mt-1 truncate font-display text-2xl font-semibold">{d.name}</h1>
          <p className="text-sm text-muted">
            {d.durationSec ? fmtTime(d.durationSec) : "—"} · {formatBytes(d.originalSize)}
            {d.width ? ` · ${d.width}×${d.height}` : ""} · {d.words} słów w transkrypcji
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            if (!confirm(`Usunąć „${d.name}” razem z plikami?`)) return;
            await api(`/api/admin/edu/${id}`, { method: "DELETE" });
            window.location.href = "/admin/edu";
          }}
        >
          <Trash2 /> Usuń
        </Button>
      </div>

      {d.status === "PROCESSING" || d.status === "UPLOADING" ? (
        <Card className="flex items-center gap-3 p-5 text-sm" data-testid="edu-processing">
          <Loader2 className="h-4 w-4 animate-spin" /> {d.step ?? "Przetwarzanie…"} — przy długim nagraniu to może potrwać kilka minut.
        </Card>
      ) : null}
      {d.status === "FAILED" ? <Card className="p-5 text-sm text-red-600">{d.error}</Card> : null}

      {ready || d.status === "EXPORTING" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            {d.summary ? <p className="rounded-xl bg-black/[.03] p-3 text-sm">{d.summary}</p> : null}
            <div className="grid grid-cols-3 gap-2 text-center text-sm" data-testid="edu-stats">
              <Card className="p-3">
                <p className="text-xs text-muted">Było</p>
                <p className="font-semibold tabular">{fmtTime(d.durationSec ?? 0)}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-muted">Wycinam</p>
                <p className="font-semibold tabular text-red-700">−{fmtTime(Math.max(0, (d.durationSec ?? 0) - after))}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-muted">Będzie</p>
                <p className="font-semibold tabular text-emerald-700" data-testid="edu-after">
                  {fmtTime(after)}
                </p>
              </Card>
            </div>

            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Długie przerwy</p>
                <span className="text-xs text-muted">{longPauses.length} {plural(longPauses.length, "przerwa skrócona", "przerwy skrócone", "przerw skróconych")} do 0,5 s</span>
              </div>
              <Label htmlFor="edu-pause">Skracaj przerwy dłuższe niż {d.pauseMin.toFixed(1).replace(".", ",")} s</Label>
              <input id="edu-pause" type="range" min={0.6} max={5} step={0.1} defaultValue={d.pauseMin} onChange={(e) => setD({ ...d, pauseMin: Number(e.target.value) })} onPointerUp={(e) => void patch({ pauseMin: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => void patch({ pauseMin: Number((e.target as HTMLInputElement).value) })} className="w-full" data-testid="edu-pause" />
            </Card>

            {(Object.keys(CUT_LABELS) as EduCutKind[]).map((k) => {
              const list = cuts.filter((c) => c.kind === k);
              if (!list.length) return null;
              const on = list.filter((c) => c.enabled).length;
              return (
                <Card key={k} className="space-y-2 p-4" data-testid={`edu-cuts-${k}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <p className="font-medium">
                        {CUT_LABELS[k].name} <span className="text-sm font-normal text-muted">({on}/{list.length} do wycięcia)</span>
                      </p>
                      <p className="text-xs text-muted">{CUT_LABELS[k].hint}</p>
                    </span>
                    <span className="flex gap-2 text-xs">
                      <button className="underline" onClick={() => void patch({ enabled: Object.fromEntries(list.map((c) => [c.id, true])) })}>
                        wytnij wszystkie
                      </button>
                      <button className="underline" onClick={() => void patch({ enabled: Object.fromEntries(list.map((c) => [c.id, false])) })}>
                        zostaw wszystkie
                      </button>
                    </span>
                  </div>
                  <ul className="divide-y divide-line">
                    {list.map((c) => (
                      <li key={c.id} className="flex items-start gap-3 py-2" data-testid="edu-cut">
                        <Switch checked={c.enabled} onCheckedChange={(v) => void patch({ enabled: { [c.id]: v } })} />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-mono text-xs text-muted">
                            {fmtTime(c.start)}–{fmtTime(c.end)}
                          </span>{" "}
                          <span className={cn(!c.enabled && "text-muted line-through")}>„{c.text}”</span>
                          {c.reason ? <span className="block text-xs text-muted">{c.reason}</span> : null}
                        </span>
                        <Button size="sm" variant="ghost" aria-label="Posłuchaj fragmentu" onClick={() => preview(c.start, c.end)}>
                          <Play />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
            {!cuts.length ? <p className="text-sm text-muted">AI nie znalazło uwag dla montażysty, powtórek ani rozmów poza nagraniem — skrócone zostaną tylko długie przerwy.</p> : null}
          </div>

          <div className="space-y-4">
            <Card className="overflow-hidden p-0">
              {d.proxyUrl ? (
                <video
                  ref={video}
                  src={d.proxyUrl}
                  controls
                  playsInline
                  className="aspect-video w-full bg-black"
                  onTimeUpdate={(e) => {
                    if (stopAt.current != null && e.currentTarget.currentTime >= stopAt.current) {
                      e.currentTarget.pause();
                      stopAt.current = null;
                    }
                  }}
                />
              ) : null}
              <p className="p-3 text-xs text-muted">Podgląd oryginału (zmniejszony). ▶ przy cięciu odtwarza je z sekundą zapasu.</p>
            </Card>
            <Card className="space-y-3 p-4" data-testid="edu-export">
              <p className="flex items-center gap-2 font-medium">
                <Scissors className="h-4 w-4" /> Gotowy plik
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="edu-q">Jakość / rozmiar</Label>
                  <NativeSelect id="edu-q" value={quality} onChange={(e) => setQuality(e.target.value as EduQuality)}>
                    {(Object.keys(EDU_QUALITY) as EduQuality[]).map((k) => (
                      <option key={k} value={k}>
                        {EDU_QUALITY[k].label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edu-r">Rozdzielczość</Label>
                  <NativeSelect id="edu-r" value={resolution} onChange={(e) => setResolution(e.target.value as EduResolution)}>
                    {(Object.keys(EDU_RESOLUTIONS) as EduResolution[]).map((k) => (
                      <option key={k} value={k}>
                        {EDU_RESOLUTIONS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              {d.status === "EXPORTING" ? (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Przygotowuję plik… {Math.round(d.exportProgress * 100)}%
                  </p>
                  <Progress value={d.exportProgress} />
                </div>
              ) : (
                <Button className="w-full" onClick={() => void exportNow()} disabled={!ready || !keep.length} data-testid="edu-export-button">
                  <Scissors /> {d.export ? "Przygotuj ponownie" : "Wytnij i przygotuj do pobrania"}
                </Button>
              )}
              {d.error && d.status !== "FAILED" ? <p className="text-xs text-red-600">{d.error}</p> : null}
              {d.export && d.status !== "EXPORTING" ? (
                <a href={d.export.url} className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="edu-download">
                  <span>
                    <b>Pobierz MP4</b> · {d.export.durationSec ? fmtTime(d.export.durationSec) : ""} · {formatBytes(d.export.size)}
                    <span className="block text-xs">
                      było {formatBytes(d.originalSize)}
                      {d.originalSize ? ` (−${Math.max(0, Math.round((1 - d.export.size / d.originalSize) * 100))}%)` : ""}
                    </span>
                  </span>
                  <Download className="h-4 w-4" />
                </a>
              ) : null}
              <p className="text-xs text-muted">H.264 + AAC, gotowe do kursu / YouTube. „Mały plik” mocniej kompresuje, „720p” dodatkowo zmniejsza obraz.</p>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
