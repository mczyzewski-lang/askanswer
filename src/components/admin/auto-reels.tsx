"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clapperboard, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Label, NativeSelect, Progress, Switch, useToast } from "@/components/ui";
import { api, cn, formatDate } from "@/lib/utils";
import { THEME_PRESETS } from "@/lib/themes";
import { formatBytes, sendChunks, uploadQueue } from "@/lib/client/chunked-upload";
import { DropZone } from "@/components/drop-zone";
import { AdsLookCard, type AdsData } from "./ads-studio";

const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  updatedAt: string;
  autoReelsStatus: string;
  autoReelsStep: string | null;
  autoReelsCount: number;
  _count: { adFootage: number; adReels: number };
}

export function AutoReelsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState({ name: "", preset: THEME_PRESETS[0]?.key ?? "", count: 25, min: 20, max: 120 });
  const [saving, setSaving] = useState(false);
  const { toast, toastNode } = useToast();
  const load = useCallback(async () => setRows((await api<{ projects: Row[] }>("/api/admin/auto-reels")).projects), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div>
      {toastNode}
      <div>
        <h1 className="font-display text-[28px] font-semibold">Auto Reels</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Wgraj jedno długie nagranie (np. godzinny podcast). AI wybierze najmocniejsze hooki, dołoży do każdego kontekst z dalszej części rozmowy i ułoży z tego gotowe reelsy — z tytułem, napisami w stylu
          projektu, dynamicznymi zbliżeniami, wyciętymi przerwami i infografikami.
        </p>
      </div>
      <Card className="mt-6 p-5">
        <form
          className="grid gap-4 md:grid-cols-[2fr_1.2fr_repeat(3,0.8fr)_auto] md:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              const p = await api<{ id: string }>("/api/admin/auto-reels", { method: "POST", json: form });
              window.location.href = `/admin/auto-reels/${p.id}`;
            } catch (err) {
              toast((err as Error).message, "err");
              setSaving(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ar-name">Nazwa</Label>
            <Input id="ar-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="np. Podcast #12 — upadłość konsumencka" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ar-preset">Motyw</Label>
            <NativeSelect id="ar-preset" value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value })}>
              {THEME_PRESETS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <NumberField id="ar-count" label="Ile reelsów" value={form.count} min={1} max={60} onChange={(count) => setForm({ ...form, count })} />
          <NumberField id="ar-min" label="Min. długość (s)" value={form.min} min={10} max={170} onChange={(min) => setForm({ ...form, min })} />
          <NumberField id="ar-max" label="Maks. długość (s)" value={form.max} min={15} max={180} onChange={(max) => setForm({ ...form, max })} />
          <Button type="submit" disabled={form.name.trim().length < 2 || saving} data-testid="ar-create">
            Utwórz
          </Button>
        </form>
      </Card>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {rows === null ? <p className="text-sm text-muted">Wczytuję…</p> : null}
        {rows?.length === 0 ? <EmptyState title="Brak projektów Auto Reels">Utwórz projekt i wgraj długie nagranie — reelsy przygotują się same.</EmptyState> : null}
        {rows?.map((p) => (
          <Link key={p.id} href={`/admin/auto-reels/${p.id}`}>
            <Card className="p-5 transition hover:shadow-md" data-testid="ar-project">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{p.name}</p>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" />
              </div>
              <p className="mt-2 text-sm text-muted">
                {p._count.adReels} reelsów · {p._count.adFootage} nagrań · {formatDate(p.updatedAt)}
              </p>
              {p.autoReelsStatus === "RUNNING" ? <p className="mt-1 text-xs text-brand">{p.autoReelsStep ?? "W toku…"}</p> : null}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One project
// ---------------------------------------------------------------------------

interface ArProject {
  autoReels: boolean;
  autoReelsCount: number;
  autoReelsMin: number;
  autoReelsMax: number;
  autoReelsStatus: string;
  autoReelsStep: string | null;
  autoReelsError: string | null;
  autoZooms: boolean;
}
type ArData = Omit<AdsData, "project" | "reels"> & {
  project: AdsData["project"] & ArProject;
  reels: Array<AdsData["reels"][number] & { autoScore: number | null; autoReason: string | null; durationSec: number | null }>;
};

interface UploadState {
  name: string;
  progress: number;
  size: number;
  waiting?: boolean;
  error?: string;
  file: File;
}

const runUpload = uploadQueue(1);

const fmtLen = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")} min` : `${Math.round(s)} s`);

export function AutoReelsProject({ id }: { id: string }) {
  const [data, setData] = useState<ArData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [settings, setSettings] = useState<{ count: number; min: number; max: number } | null>(null);
  const { toast, toastNode } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const d = await api<ArData>(`/api/admin/ads/${id}`);
    setData(d);
    setSettings((s) => s ?? { count: d.project.autoReelsCount, min: d.project.autoReelsMin, max: d.project.autoReelsMax });
  }, [id]);
  useEffect(() => {
    load().catch((e: Error) => setLoadError(e.message));
  }, [load]);
  const busy = !!data && (data.footage.some((f) => f.status === "PROCESSING" || f.status === "UPLOADING") || data.project.autoReelsStatus === "RUNNING");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  const uploadOne = async (file: File) => {
    const key = `${file.name}-${file.size}-${Date.now()}`;
    const set = (p: Partial<UploadState>) => setUploads((u) => ({ ...u, [key]: { ...(u[key] ?? { name: file.name, progress: 0, size: file.size, file }), ...p } }));
    set({ progress: 0, waiting: true });
    try {
      await runUpload(async () => {
        set({ waiting: false });
        const { id: fid } = await api<{ id: string }>(`/api/admin/ads/${id}/footage`, { method: "POST", json: { name: file.name, size: file.size } });
        const total = await sendChunks(file, (i) => `/api/admin/ads/footage/${fid}/chunks/${i}`, (progress) => set({ progress }));
        await api(`/api/admin/ads/footage/${fid}/complete`, { method: "POST", json: { totalChunks: total } });
      });
      setUploads(({ [key]: _done, ...rest }) => (void _done, rest));
      await load();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await api(`/api/admin/auto-reels/${id}`, { method: "PATCH", json: settings });
      toast("Zapisano — obowiązuje przy następnym generowaniu");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const generate = async () => {
    if (data?.reels.length && !confirm(`Wygenerować reelsy od nowa? Obecne ${data.reels.length} reelsów i ich montaże w Studio zostaną zastąpione.`)) return;
    try {
      if (settings) await api(`/api/admin/auto-reels/${id}`, { method: "PATCH", json: settings });
      await api(`/api/admin/auto-reels/${id}`, { method: "POST" });
      toast("Start — AI szuka hooków");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (!data)
    return loadError ? (
      <p className="text-sm text-red-600">
        Nie udało się wczytać projektu: {loadError}{" "}
        <button className="underline" onClick={() => (setLoadError(null), load().catch((e: Error) => setLoadError(e.message)))}>
          Spróbuj ponownie
        </button>
      </p>
    ) : (
      <p className="text-sm text-muted">Wczytuję…</p>
    );
  const p = data.project;
  const ready = data.footage.filter((f) => f.status === "READY").length;
  const running = p.autoReelsStatus === "RUNNING";
  const reels = [...data.reels].sort((a, b) => a.code.localeCompare(b.code));
  const totalLen = reels.reduce((n, r) => n + (r.durationSec ?? 0), 0);

  return (
    <div className="space-y-6" data-testid="auto-reels">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/auto-reels" className="text-sm text-muted hover:text-ink">
            ← Auto Reels
          </Link>
          <h1 className="mt-1 font-display text-[28px] font-semibold">{p.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/admin/projects/${id}`} className="text-sm text-muted underline hover:text-ink">
            Motyw i ustawienia montażu →
          </Link>
          <Button
            variant="outline"
            className="text-red-600"
            onClick={async () => {
              if (!confirm(`Usunąć „${p.name}” razem z nagraniem, reelsami i montażami? Tej operacji nie można cofnąć.`)) return;
              try {
                await api(`/api/admin/ads/${id}`, { method: "DELETE" });
                window.location.href = "/admin/auto-reels";
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
          >
            <Trash2 /> Usuń
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DropZone onFiles={(fs) => fs.forEach((f) => void uploadOne(f))} accept={VIDEO_ACCEPT} label="Upuść nagranie tutaj" className="rounded-2xl" onRejected={(n) => toast(`Pominięto (to nie wideo): ${n.join(", ")}`, "err")}>
          <Card className="h-full space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">1. Nagranie</p>
                <p className="text-sm text-muted">Cały podcast lub webinar (MP4 / MOV / WEBM). Po transkrypcji reelsy przygotują się same.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} data-testid="ar-upload">
                <Upload /> Wgraj
              </Button>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={VIDEO_ACCEPT}
              className="hidden"
              data-testid="ar-video-input"
              onChange={(e) => {
                for (const f of Array.from(e.target.files ?? [])) void uploadOne(f);
                e.target.value = "";
              }}
            />
            <ul className="space-y-1.5">
              {Object.entries(uploads).map(([k, u]) => (
                <li key={k} className="rounded-lg border border-line p-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{u.name}</span>
                    <span className="shrink-0 text-muted">
                      {formatBytes(u.size)} · {u.error ? "błąd" : u.waiting ? "w kolejce" : u.progress >= 1 ? "składanie pliku…" : `wysyłanie ${Math.round(u.progress * 100)}%`}
                    </span>
                  </div>
                  {u.error ? (
                    <p className="flex items-center justify-between gap-2 text-xs text-red-600">
                      {u.error}
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => {
                          setUploads(({ [k]: _gone, ...rest }) => (void _gone, rest));
                          void uploadOne(u.file);
                        }}
                      >
                        <RefreshCw /> Wgraj ponownie
                      </Button>
                    </p>
                  ) : (
                    <Progress value={u.progress} className="mt-1.5" />
                  )}
                </li>
              ))}
              {data.footage.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm" data-testid="ar-footage-row" data-status={f.status}>
                  <span className="min-w-0">
                    <span className="block truncate">{f.name}</span>
                    <span className={cn("block text-xs", f.status === "FAILED" ? "text-red-600" : "text-muted")}>
                      {f.status === "READY" ? `Gotowe · ${f.durationSec ? fmtLen(f.durationSec) : ""} · ${f.words} słów` : f.status === "FAILED" ? f.error ?? "Błąd przetwarzania" : f.step ?? "Przetwarzanie…"}
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

        <Card className="space-y-4 p-5" data-testid="ar-generate">
          <div>
            <p className="font-medium">2. Reelsy</p>
            <p className="text-sm text-muted">AI ocenia każdy możliwy hook, wybiera najlepsze (różne tematy) i do każdego dokleja kontekst z rozmowy — tak, żeby reels był zamkniętą myślą.</p>
          </div>
          {settings ? (
            <div className="grid grid-cols-3 gap-3">
              <NumberField id="ar-s-count" label="Ile reelsów" value={settings.count} min={1} max={60} onChange={(count) => setSettings({ ...settings, count })} />
              <NumberField id="ar-s-min" label="Min. (s)" value={settings.min} min={10} max={170} onChange={(min) => setSettings({ ...settings, min })} />
              <NumberField id="ar-s-max" label="Maks. (s)" value={settings.max} min={15} max={180} onChange={(max) => setSettings({ ...settings, max })} />
            </div>
          ) : null}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Dynamiczne zbliżenia
              <span className="block text-xs text-muted">Przybliżenia na granicach zdań (przerwy dłuższe niż naturalne są wycinane zawsze).</span>
            </span>
            <Switch
              checked={p.autoZooms}
              onCheckedChange={async (v) => {
                await api(`/api/admin/auto-reels/${id}`, { method: "PATCH", json: { autoZooms: v } }).catch((e: Error) => toast(e.message, "err"));
                await load();
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void generate()} disabled={!ready || running || busy} data-testid="ar-run">
              {running ? <Loader2 className="animate-spin" /> : <Sparkles />} {data.reels.length ? "Wygeneruj od nowa" : "Wygeneruj reelsy"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void saveSettings()} disabled={running}>
              Zapisz ustawienia
            </Button>
          </div>
          {running ? (
            <p className="flex items-center gap-2 text-sm text-brand" data-testid="ar-step">
              <Loader2 className="h-4 w-4 animate-spin" /> {p.autoReelsStep ?? "W toku…"}
            </p>
          ) : p.autoReelsStatus === "FAILED" ? (
            <p className="text-sm text-red-600" data-testid="ar-error">
              {p.autoReelsError ?? "Nie udało się"}
            </p>
          ) : !ready ? (
            <p className="text-sm text-muted">Czeka na nagranie z transkrypcją.</p>
          ) : null}
        </Card>
      </div>

      {reels.length ? (
        <Card className="p-5" data-testid="ar-reels">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {reels.length} reelsów <span className="text-sm font-normal text-muted">· razem {fmtLen(totalLen)}</span>
            </p>
            <p className="text-xs text-muted">Zbliżenia i infografiki dokładają się w tle przez kilka minut po ułożeniu.</p>
          </div>
          <ul className="divide-y divide-line">
            {reels.map((r) => {
              const hook = r.parts.find((x) => x.role === "hook")?.text ?? "";
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-3 py-3" data-testid="ar-reel">
                  <span className="w-10 shrink-0 font-mono text-xs text-muted">{r.code}</span>
                  <div className="min-w-0 flex-1">
                    {r.compositionId ? (
                      <Link href={`/studio/${r.compositionId}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{r.title}</p>
                    )}
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">„{hook}”</p>
                    {r.autoReason ? <p className="mt-0.5 text-xs text-muted">{r.autoReason}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.autoScore != null ? <Badge tone={r.autoScore >= 75 ? "green" : r.autoScore >= 55 ? "amber" : "gray"}>{r.autoScore}</Badge> : null}
                    {r.durationSec ? <span className="w-14 text-right text-xs text-muted">{fmtLen(r.durationSec)}</span> : null}
                    {r.compositionId ? (
                      <Link href={`/studio/${r.compositionId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/85" data-testid="ar-open-studio">
                        <Clapperboard className="h-3.5 w-3.5" /> Otwórz w Studio
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> układanie…
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <AdsLookCard project={p} reload={load} toast={toast} />
    </div>
  );
}
