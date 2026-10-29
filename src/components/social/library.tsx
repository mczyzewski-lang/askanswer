"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clapperboard, FileVideo, Link2, Loader2, Sparkles, Trash2, Upload, Wand2, XCircle } from "lucide-react";
import { Button, Dialog, DialogContent, Input, Textarea, Progress } from "@/components/ui";
import { api, cn, formatDuration } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { useSocial } from "./shell";
import type { AccountView } from "./project";
import { DemoBadge, Empty, ErrorBox, Field, Loading, PageHeader, Pill, PlatformIcon, useApi, waitForJob } from "./ui";

export interface MediaItem {
  id: string;
  title: string;
  description: string;
  originalName: string;
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  error: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  sizeBytes: number;
  checks: Record<Platform, { ok: boolean; errors: string[]; warnings: string[]; conversion: string | null }> | null;
  transcript: string | null;
  transcriptStatus: string | null;
  isDemo: boolean;
  createdAt: string;
  thumbUrl: string | null;
  videoUrl: string | null;
  variants: Array<{ id: string; kind: string; status: string; width: number | null; height: number | null; durationSec: number | null; error: string | null; url: string | null }>;
  content?: Array<{ id: string; title: string; posts: Array<{ status: string; platform: Platform }> }>;
}

const CHUNK = 8 * 1024 * 1024;

export function CheckIcons({ checks }: { checks: MediaItem["checks"] }) {
  if (!checks) return null;
  return (
    <div className="flex gap-1" aria-label="Zgodność z platformami">
      {PLATFORMS.map((p) => {
        const c = checks[p];
        const state = !c ? "?" : c.errors.length ? "err" : c.warnings.length ? "warn" : "ok";
        return (
          <span key={p} className="relative" title={`${PLATFORM_META[p].name}: ${state === "ok" ? "zgodny" : [...(c?.errors ?? []), ...(c?.warnings ?? [])].join(" ")}`}>
            <PlatformIcon platform={p} size={18} className={cn(state === "err" && "opacity-40")} />
            <span className={cn("absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white", state === "ok" ? "bg-emerald-500" : state === "warn" ? "bg-amber-400" : "bg-red-500")} />
          </span>
        );
      })}
    </div>
  );
}

export function Library() {
  const { me, projectId, setProjectId, can } = useSocial();
  const projects = me.projects.filter((p) => p.permissions.includes("project.view"));
  const pid = projectId || (projects.length === 1 ? projects[0].id : "");
  const { data, error, loading, reload } = useApi<{ media: MediaItem[] }>(pid ? `/api/social/projects/${pid}/media` : null, [pid]);
  const [upload, setUpload] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const busy = data?.media.some((m) => m.status === "PROCESSING" || m.status === "UPLOADING" || m.variants.some((v) => v.status === "PROCESSING"));
  React.useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [busy, reload]);
  if (!pid)
    return (
      <>
        <PageHeader title="Biblioteka treści" subtitle="Wybierz projekt, aby zobaczyć jego filmy." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <button key={p.id} onClick={() => setProjectId(p.id)} className="rounded-xl border border-line bg-white p-4 text-left hover:border-ink/25">
              <p className="font-medium">{p.name}</p>
              <p className="text-[12px] text-muted">{p.organizationName}</p>
            </button>
          ))}
        </div>
      </>
    );
  const editable = can("content.edit", pid);
  return (
    <>
      <PageHeader
        title="Biblioteka treści"
        subtitle={`${me.projects.find((p) => p.id === pid)?.name ?? ""} — filmy i ich wersje na platformy`}
        actions={
          editable ? (
            <Button size="sm" onClick={() => setUpload(true)} data-testid="add-media">
              <Upload /> Dodaj film
            </Button>
          ) : undefined
        }
      />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.media.length ? (
        <Empty icon={<FileVideo className="h-6 w-6" />} title="Brak filmów" action={editable ? <Button onClick={() => setUpload(true)}><Upload /> Dodaj pierwszy film</Button> : undefined}>
          Prześlij MP4 / MOV albo wklej adres URL filmu. Sprawdzimy, czy nadaje się na Reels, TikTok, Shorts i LinkedIn.
        </Empty>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data?.media.map((m) => (
          <button key={m.id} onClick={() => setOpen(m.id)} className="group overflow-hidden rounded-2xl border border-line bg-white text-left transition hover:border-ink/25" data-testid="media-card" data-status={m.status}>
            <div className="relative aspect-[9/12] bg-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.thumbUrl ? <img src={m.thumbUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted">{m.status === "FAILED" ? <XCircle className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}</div>}
              <div className="absolute left-2 top-2 flex gap-1">{m.isDemo ? <DemoBadge /> : null}</div>
              {m.durationSec ? <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{formatDuration(m.durationSec)}</span> : null}
            </div>
            <div className="space-y-2 p-3">
              <p className="line-clamp-2 text-[13.5px] font-medium">{m.title || m.originalName}</p>
              {m.status === "READY" ? <CheckIcons checks={m.checks} /> : <p className="text-[12px] text-muted">{m.status === "FAILED" ? m.error : m.status === "UPLOADING" ? "Przesyłanie…" : "Analiza filmu…"}</p>}
              {m.content?.length ? <p className="text-[11.5px] text-muted">{m.content.length} {m.content.length === 1 ? "publikacja" : "publikacje"} · {m.content.reduce((n, c) => n + c.posts.length, 0)} platform</p> : null}
            </div>
          </button>
        ))}
      </div>
      {upload ? <UploadDialog projectId={pid} onClose={() => setUpload(false)} onDone={(id) => (setUpload(false), void reload(), setOpen(id))} /> : null}
      {open ? <MediaDialog mediaId={open} projectId={pid} onClose={() => setOpen(null)} onChange={reload} /> : null}
    </>
  );
}

function UploadDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (id: string) => void }) {
  const { toast, me } = useSocial();
  const [mode, setMode] = React.useState<"file" | "url" | "askby">("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [transcribe, setTranscribe] = React.useState(true);
  const [progress, setProgress] = React.useState<number | null>(null);
  const send = async () => {
    try {
      if (mode === "url") {
        const r = await api<{ id: string }>(`/api/social/projects/${projectId}/media`, { method: "POST", json: { url, title, description, transcribe } });
        toast("Pobieram film z adresu…");
        return onDone(r.id);
      }
      if (!file) return;
      if (!/\.(mp4|mov|m4v|webm)$/i.test(file.name)) return toast("Wybierz plik MP4 lub MOV", "err");
      const r = await api<{ id: string }>(`/api/social/projects/${projectId}/media`, { method: "POST", json: { name: file.name, size: file.size, title: title || file.name.replace(/\.[^.]+$/, ""), description, transcribe } });
      const total = Math.ceil(file.size / CHUNK);
      for (let i = 0; i < total; i++) {
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await fetch(`/api/social/media/${r.id}/chunks/${i}`, { method: "PUT", body: file.slice(i * CHUNK, (i + 1) * CHUNK) });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
            break;
          } catch (e) {
            if (attempt >= 4) throw e;
            await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
          }
        }
        setProgress((i + 1) / total);
      }
      await api(`/api/social/media/${r.id}/complete`, { method: "POST", json: { totalChunks: total } });
      onDone(r.id);
    } catch (e) {
      toast((e as Error).message, "err");
      setProgress(null);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && progress === null && onClose()}>
      <DialogContent title="Dodaj film" description="Oryginał zostaje nienaruszony — konwersje zapisujemy jako osobne wersje.">
        <div className="mb-4 flex gap-1 rounded-lg border border-line p-0.5 text-[13px]">
          {(
            [
              ["file", "Plik z dysku"],
              ["url", "Adres URL"],
              ...(me.user.staff ? ([["askby", "Z AskBy Studio"]] as const) : []),
            ] as Array<[typeof mode, string]>
          ).map(([k, l]) => (
            <button key={k} className={cn("flex-1 rounded-md py-1.5", mode === k ? "bg-ink text-white" : "text-muted")} onClick={() => setMode(k)}>
              {l}
            </button>
          ))}
        </div>
        {mode === "askby" ? (
          <AskbyImport projectId={projectId} onDone={onDone} />
        ) : (
          <div className="space-y-3">
            {mode === "file" ? (
              <Field label="Plik MP4 / MOV">
                <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" data-testid="media-file" />
              </Field>
            ) : (
              <Field label="Adres URL filmu" hint="Publiczny link do pliku (http/https). Adresy sieci wewnętrznych są blokowane.">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/film.mp4" />
              </Field>
            )}
            <Field label="Tytuł (dla Ciebie i dla AI)">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Tytuł filmu" />
            </Field>
            <Field label="Opis / kontekst" hint="O czym jest film — AI wykorzysta to przy opisach.">
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Opis filmu" />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={transcribe} onChange={(e) => setTranscribe(e.target.checked)} /> Zrób transkrypcję mowy (ElevenLabs) — lepsze opisy AI
            </label>
            {progress !== null ? <Progress value={progress} /> : null}
            <Button className="w-full" onClick={() => void send()} disabled={progress !== null || (mode === "file" ? !file : !url)} data-testid="media-send">
              {progress !== null ? <Loader2 className="animate-spin" /> : <Upload />} {progress !== null ? `Przesyłanie ${Math.round(progress * 100)}%` : "Prześlij"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AskbyImport({ projectId, onDone }: { projectId: string; onDone: (id: string) => void }) {
  const { toast } = useSocial();
  const { data, error } = useApi<{ renders: Array<{ id: string; at: string; project: string; title: string; imported: boolean }> }>(`/api/social/projects/${projectId}/askby`);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.renders.length) return <p className="text-sm text-muted">Brak gotowych eksportów w AskBy Studio.</p>;
  return (
    <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
      {data.renders.map((r) => (
        <li key={r.id} className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-[13px]">
          <Clapperboard className="h-4 w-4 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{r.title}</p>
            <p className="text-[11.5px] text-muted">
              {r.project} · {new Date(r.at).toLocaleDateString("pl-PL")}
            </p>
          </div>
          <Button
            size="sm"
            variant={r.imported ? "ghost" : "outline"}
            disabled={!!busy}
            onClick={async () => {
              setBusy(r.id);
              try {
                const x = await api<{ id: string }>(`/api/social/projects/${projectId}/askby`, { method: "POST", json: { renderJobId: r.id } });
                onDone(x.id);
              } catch (e) {
                toast((e as Error).message, "err");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === r.id ? <Loader2 className="animate-spin" /> : null} {r.imported ? "Importuj ponownie" : "Importuj"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function MediaDialog({ mediaId, projectId, onClose, onChange }: { mediaId: string; projectId: string; onClose: () => void; onChange: () => void }) {
  const { toast, can } = useSocial();
  const router = useRouter();
  const { data, reload } = useApi<{ media: MediaItem; content: Array<{ id: string; title: string; createdAt: string; posts: Array<{ id: string; status: string; platform: Platform }> }> }>(`/api/social/media/${mediaId}`);
  const accounts = useApi<{ accounts: AccountView[] }>(`/api/social/projects/${projectId}/accounts`);
  const [chosen, setChosen] = React.useState<string[] | null>(null);
  const [goal, setGoal] = React.useState("");
  const [working, setWorking] = React.useState<string | null>(null);
  const m = data?.media;
  React.useEffect(() => {
    if (!m || (m.status !== "PROCESSING" && !m.variants.some((v) => v.status === "PROCESSING") && m.transcriptStatus !== "W trakcie…" && m.transcriptStatus !== "Zaplanowana")) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [m, reload]);
  const usable = (accounts.data?.accounts ?? []).filter((a) => a.status === "CONNECTED");
  React.useEffect(() => {
    if (chosen === null && accounts.data) setChosen(usable.map((a) => a.id));
  }, [accounts.data, chosen, usable]);
  const editable = can("content.edit", projectId);
  const prepare = async (generate: boolean) => {
    setWorking(generate ? "ai" : "plain");
    try {
      const r = await api<{ id: string; jobId: string | null }>(`/api/social/projects/${projectId}/content`, { method: "POST", json: { mediaId, accountIds: chosen, goal, generate } });
      if (r.jobId) {
        toast("AI przygotowuje osobne wersje na każdą platformę…");
        await waitForJob(r.jobId).catch((e) => toast((e as Error).message, "err"));
      }
      router.push(`/social/content/${r.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
      setWorking(null);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={m?.title || m?.originalName || "Film"} className="max-w-4xl">
        {!m ? (
          <Loading />
        ) : (
          <div className="grid gap-5 md:grid-cols-[260px_1fr]" data-testid="media-detail">
            <div className="space-y-3">
              <div className="aspect-[9/16] overflow-hidden rounded-xl bg-black">{m.videoUrl ? <video src={m.videoUrl} controls playsInline className="h-full w-full object-contain" /> : m.thumbUrl ? <img src={m.thumbUrl} alt="" className="h-full w-full object-cover" /> : null}</div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-muted">Długość</dt>
                <dd>{formatDuration(m.durationSec)}</dd>
                <dt className="text-muted">Rozdzielczość</dt>
                <dd>{m.width && m.height ? `${m.width}×${m.height}` : "—"}</dd>
                <dt className="text-muted">Kodek</dt>
                <dd>
                  {m.videoCodec ?? "—"} / {m.audioCodec ?? "brak dźwięku"}
                </dd>
                <dt className="text-muted">Klatki</dt>
                <dd>{m.fps ? `${Math.round(m.fps)} fps` : "—"}</dd>
                <dt className="text-muted">Rozmiar</dt>
                <dd>{(m.sizeBytes / 1e6).toFixed(1)} MB</dd>
              </dl>
              {editable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={async () => {
                    if (!confirm("Usunąć film z biblioteki (razem z nieopublikowanymi publikacjami)?")) return;
                    try {
                      await api(`/api/social/media/${mediaId}`, { method: "DELETE" });
                      onChange();
                      onClose();
                    } catch (e) {
                      toast((e as Error).message, "err");
                    }
                  }}
                >
                  <Trash2 /> Usuń film
                </Button>
              ) : null}
            </div>
            <div className="space-y-5">
              {m.status === "FAILED" ? <ErrorBox error={m.error ?? "Nie udało się przetworzyć filmu"} /> : null}
              {m.status !== "READY" && m.status !== "FAILED" ? <Loading label="Analizuję film (FFprobe, miniatura, wymagania platform)…" /> : null}
              {m.checks ? (
                <section>
                  <p className="mb-2 text-[13px] font-semibold">Zgodność z platformami</p>
                  <ul className="space-y-1.5" data-testid="media-checks">
                    {PLATFORMS.map((p) => {
                      const c = m.checks![p];
                      return (
                        <li key={p} className="flex items-start gap-2 text-[12.5px]">
                          <PlatformIcon platform={p} size={18} />
                          {c.errors.length ? <XCircle className="mt-0.5 h-3.5 w-3.5 text-red-500" /> : c.warnings.length ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-500" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-500" />}
                          <span className="flex-1">{[...c.errors, ...c.warnings].join(" ") || `Spełnia wymagania ${PLATFORM_META[p].name} ${PLATFORM_META[p].format}.`}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {Object.values(m.checks).some((c) => c.conversion) || m.variants.length ? (
                    <div className="mt-3 rounded-xl border border-line p-3 text-[12.5px]">
                      <p className="font-medium">Wersja pionowa 1080×1920 (H.264)</p>
                      <p className="text-muted">Film dopasowany do 9:16 na rozmytym tle. Oryginał zostaje bez zmian; wersję wybierasz w edytorze publikacji.</p>
                      {m.variants.map((v) => (
                        <p key={v.id} className="mt-1">
                          {v.status === "READY" ? <Pill tone="green">Gotowa {v.width}×{v.height}</Pill> : v.status === "FAILED" ? <Pill tone="red">Błąd: {v.error}</Pill> : <Pill tone="blue">Konwertuję…</Pill>}
                        </p>
                      ))}
                      {editable && !m.variants.some((v) => v.status === "PROCESSING" || v.status === "READY") ? (
                        <Button size="sm" variant="outline" className="mt-2" onClick={async () => (await api(`/api/social/media/${mediaId}/convert`, { method: "POST" }), await reload())} data-testid="convert">
                          <Wand2 /> Konwertuj (FFmpeg)
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
              <section>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[13px] font-semibold">Transkrypcja</p>
                  {editable && m.status === "READY" && !["W trakcie…", "Zaplanowana"].includes(m.transcriptStatus ?? "") ? (
                    <button
                      className="text-[12px] text-muted underline"
                      onClick={async () => {
                        try {
                          await api(`/api/social/media/${mediaId}/transcribe`, { method: "POST" });
                          await reload();
                        } catch (e) {
                          toast((e as Error).message, "err");
                        }
                      }}
                    >
                      {m.transcript ? "Zrób ponownie" : "Zrób transkrypcję"}
                    </button>
                  ) : null}
                </div>
                {m.transcript ? <p className="max-h-32 overflow-y-auto whitespace-pre-line rounded-lg bg-ink/[.04] p-2.5 text-[12.5px]">{m.transcript}</p> : <p className="text-[12.5px] text-muted">{m.transcriptStatus ?? "Brak — AI oprze się na tytule i opisie."}</p>}
              </section>
              {data!.content.length ? (
                <section>
                  <p className="mb-1 text-[13px] font-semibold">Publikacje tego filmu</p>
                  <ul className="space-y-1">
                    {data!.content.map((c) => (
                      <li key={c.id}>
                        <Link href={`/social/content/${c.id}`} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:bg-ink/[.03]">
                          <span className="flex-1 truncate">{c.title}</span>
                          {c.posts.map((p) => (
                            <PlatformIcon key={p.id} platform={p.platform} size={16} />
                          ))}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {editable && m.status === "READY" ? (
                <section className="rounded-2xl border border-line bg-brand-soft/30 p-4" data-testid="prepare">
                  <p className="flex items-center gap-2 text-[14px] font-semibold">
                    <Sparkles className="h-4 w-4" /> Przygotuj publikacje
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">AI napisze osobną wersję na każdą platformę — w tonie marki, bez wymyślania faktów. Wszystko potem edytujesz i zatwierdzasz.</p>
                  {!usable.length ? (
                    <p className="mt-3 text-[13px]">
                      Brak połączonych kont.{" "}
                      <Link className="underline" href={`/social/projects/${projectId}?tab=accounts`}>
                        Połącz konta
                      </Link>
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                        {usable.map((a) => {
                          const c = m.checks?.[a.platform];
                          return (
                            <label key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2 text-[13px]">
                              <input type="checkbox" checked={chosen?.includes(a.id) ?? false} onChange={(e) => setChosen((x) => (e.target.checked ? [...(x ?? []), a.id] : (x ?? []).filter((y) => y !== a.id)))} data-testid="target-account" data-platform={a.platform} />
                              <PlatformIcon platform={a.platform} size={18} />
                              <span className="min-w-0 flex-1 truncate">{a.displayName ?? a.handle}</span>
                              {c?.errors.length ? <XCircle className="h-3.5 w-3.5 text-red-500" aria-label={c.errors.join(" ")} /> : null}
                            </label>
                          );
                        })}
                      </div>
                      <Field label="Cel marketingowy (opcjonalnie)">
                        <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="np. zapisy na bezpłatną konsultację" aria-label="Cel marketingowy" />
                      </Field>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => void prepare(true)} disabled={!chosen?.length || !!working} data-testid="prepare-ai">
                          {working === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />} Przygotuj publikacje z AI
                        </Button>
                        <Button variant="outline" onClick={() => void prepare(false)} disabled={!chosen?.length || !!working}>
                          <Link2 /> Bez AI
                        </Button>
                      </div>
                    </>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
