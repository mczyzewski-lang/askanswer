"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, Film, Loader2, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, NativeSelect, Progress, useToast } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { DropZone } from "@/components/drop-zone";
import { sendChunks } from "@/lib/client/chunked-upload";

interface FilmRow {
  id: string;
  cover: { view: string; download: string } | null;
  code: string;
  version: string;
  title: string;
  subject: string | null;
  note: string | null;
  review: "TODO" | "OK" | "FIX";
  parts: number;
  labels: string[];
  missing: string[];
  compositionId: string | null;
  durationSec: number | null;
  exported: boolean;
  updatedAt: string;
  explainers: { planned: number; inEdit: number; on: number; waiting: string[] };
  outro: boolean;
}
interface Data {
  project: { id: string; name: string };
  clips: number;
  outros: Array<{ name: string; durationSec: number; width: number | null; height: number | null }>;
  explainers: { planned: number; uploaded: string[] };
  films: FilmRow[];
}
type Job = { id: string; filmId: string; code: string; status: string; progress: number; downloadUrl: string | null };

const clock = (s: number | null) => (s == null ? "-" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const REVIEW: Record<FilmRow["review"], string> = { TODO: "Do przejrzenia", OK: "OK", FIX: "Do poprawy" };

/** Sekwencja: the films of an e-mail sequence, each in one or more versions, reviewed and exported from here. */
export function SequenceView({ id, kind = "sequence" }: { id: string; kind?: "sequence" | "testimonial" }) {
  const testi = kind === "testimonial";
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const outroRef = useRef<HTMLInputElement>(null);
  const [outroBusy, setOutroBusy] = useState(false);
  const [up, setUp] = useState<{ done: number; total: number; current: string; log: Array<{ ok: boolean; text: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/admin/sequence/${id}?kind=${kind}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id, kind]);
  useEffect(() => void load(), [load]);

  // the package: every clip first, then manifest.json that lays out the films
  const send = async (files: File[]) => {
    const manifest = files.find((f) => f.name.toLowerCase() === "manifest.json");
    const clips = files.filter((f) => /\.(mp4|mov|webm)$/i.test(f.name));
    const covers = files.filter((f) => /\.(jpe?g|png)$/i.test(f.name));
    if (!manifest && !clips.length && !covers.length) return toast("Wybierz klipy wideo i plik manifest.json z paczki", "err");
    setBusy(true);
    const log: Array<{ ok: boolean; text: string }> = [];
    const total = clips.length + covers.length + (manifest ? 1 : 0);
    let done = 0;
    setUp({ done, total, current: clips[0]?.name ?? "manifest.json", log });
    let next = 0;
    const worker = async () => {
      while (next < clips.length) {
        const f = clips[next++];
        // a server hiccup (a restart, a busy moment) costs one more try of this clip, not a hole in the film
        for (let attempt = 0; ; attempt++) {
          let problem: string | null = null;
          let retry = false;
          try {
            // in slices: one request carries a few MB at most
            const upload = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
            const totalChunks = await sendChunks(f, (i) => `/api/admin/sequence/${id}/clips/${upload}/${i}`, () => {}, { parallel: 2 });
            const res = await fetch(`/api/admin/sequence/${id}/clips/${upload}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, totalChunks }) });
            const d = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
              problem = d.error?.includes(f.name) ? d.error : `${f.name}: ${d.error ?? `błąd ${res.status}`}`;
              retry = res.status >= 500 || res.status === 409;
            }
          } catch (e) {
            problem = `${f.name}: ${(e as Error).message}`;
            retry = true;
          }
          if (!problem) break;
          if (!retry || attempt >= 2) {
            log.push({ ok: false, text: problem });
            break;
          }
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        }
        done++;
        setUp({ done, total, current: clips[Math.min(next, clips.length - 1)]?.name ?? "manifest.json", log: [...log] });
      }
    };
    await Promise.all([worker(), worker()]);
    // cover images are small: one request each
    for (const f of covers) {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch(`/api/admin/sequence/${id}/covers`, { method: "POST", body: fd }).catch(() => null);
      if (!res?.ok) log.push({ ok: false, text: ((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? `${f.name}: nie udało się wgrać okładki` });
      done++;
      setUp({ done, total, current: f.name, log: [...log] });
    }
    if (manifest) {
      try {
        const body = JSON.parse(await manifest.text());
        const r = await api<{ films: number; created: number; updated: number; kept: number; explainers?: { added: number }; missing: Array<{ film: string; missing: string[] }> }>(`/api/admin/sequence/${id}/manifest`, { method: "POST", json: body });
        log.push({ ok: true, text: `Filmy: ${r.films} wersji - ${r.created} nowych, ${r.updated} zaktualizowanych, ${r.kept} bez zmian` });
        if (r.explainers?.added) log.push({ ok: true, text: `Explainery: dodano ${r.explainers.added} warstw do filmów` });
        for (const m of r.missing) log.push({ ok: false, text: `Film ${m.film}: brakuje klipów ${m.missing.join(", ")}` });
      } catch (e) {
        log.push({ ok: false, text: `manifest.json: ${(e as Error).message}` });
      }
      done++;
    } else {
      // clips alone (e.g. the explainers sent later): the ones the films wait for go into them now
      const r = await api<{ added: number }>(`/api/admin/sequence/${id}/explainers`, { method: "POST" }).catch(() => ({ added: 0 }));
      log.push({ ok: true, text: `Wgrano ${clips.length} klipów.${r.added ? ` Explainery: dodano ${r.added} warstw do filmów.` : data?.films.length ? " Żaden z nich nie jest explainerem, na który czekają filmy (sprawdź nazwy plików, np. E0a.mp4, i czy wgrany jest aktualny manifest.json)." : " Filmy powstają po wgraniu manifest.json."}` });
    }
    setUp({ done, total, current: "", log: [...log] });
    setBusy(false);
    toast(log.some((l) => !l.ok) ? "Paczka wgrana z uwagami - zobacz listę" : "Paczka wgrana", log.some((l) => !l.ok) ? "err" : "ok");
    await load();
  };

  // the outro: one ready clip per format (1:1, 9:16...), kept in the library under its own prefix
  const sendOutro = async (files: File[]) => {
    setOutroBusy(true);
    try {
      for (const f of files) {
        const upload = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        const totalChunks = await sendChunks(f, (i) => `/api/admin/sequence/${id}/clips/${upload}/${i}`, () => {}, { parallel: 2 });
        const res = await fetch(`/api/admin/sequence/${id}/clips/${upload}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `outro__${f.name}`, totalChunks }) });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${f.name}: błąd ${res.status}`);
      }
      toast("Outro wgrane - włącz je przy filmach albo we wszystkich naraz");
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setOutroBusy(false);
    await load();
  };
  const outroAll = async (on: boolean) => {
    setOutroBusy(true);
    try {
      const r = await api<{ changed: number }>(`/api/admin/sequence/${id}/outro`, { method: "POST", json: { on, kind } });
      toast(on ? `Outro dodane do ${r.changed} filmów` : `Outro usunięte z ${r.changed} filmów`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setOutroBusy(false);
    await load();
  };

  // exports: one render per film version, then one ZIP
  useEffect(() => {
    if (!jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING")) return;
    const t = setInterval(async () => {
      setJobs(
        await Promise.all(
          jobs.map(async (j) => {
            if (j.status === "SUCCEEDED" || j.status === "FAILED") return j;
            const r = await fetch(`/api/admin/render-jobs/${j.id}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
            return r ? { ...j, status: r.status, progress: r.progress ?? 0, downloadUrl: r.downloadUrl ?? null } : j;
          }),
        ),
      );
    }, 2500);
    return () => clearInterval(t);
  }, [jobs]);
  const render = async (filmIds?: string[]) => {
    try {
      const r = await api<{ jobs: Array<{ id: string; filmId: string; code: string }> }>(`/api/admin/sequence/${id}/render`, { method: "POST", json: { filmIds, kind } });
      setJobs((old) => [...old.filter((o) => !r.jobs.some((n) => n.filmId === o.filmId)), ...r.jobs.map((j) => ({ ...j, status: "QUEUED", progress: 0, downloadUrl: null }))]);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (err) return <p className="p-8 text-sm text-red-600">{err}</p>;
  if (!data) return <p className="p-8 text-sm text-muted">Wczytywanie…</p>;
  const codes = [...new Set(data.films.map((f) => f.code))];
  const running = jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const ready = jobs.filter((j) => j.status === "SUCCEEDED");
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8" data-testid="sequence">
      <div>
        <p className="text-sm text-muted">{data.project.name}</p>
        <h1 className="font-display text-3xl font-semibold">{testi ? "Testimoniale" : "Sekwencja"}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {testi
            ? "Filmy klientów na stronę główną: każdy to jeden temat i kilka krótkich wypowiedzi, w formacie 1:1, z podpisem klienta i napisami. Przy każdym filmie jest okładka do pobrania."
            : "Filmy sekwencji (strona z podziękowaniem i kolejne dni), zmontowane z gotowych fragmentów w formacie 1:1. Gdy ujęcie było nagrane kilka razy, film ma kilka wersji - obejrzyj je, oznacz właściwą i wyeksportuj."}
        </p>
      </div>

      <DropZone accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.json,application/json,image/jpeg,image/png,.jpg,.jpeg,.png" multiple={true} label="Upuść wszystkie pliki z paczki (klipy + manifest.json)" onFiles={(fs) => void send(fs)} className="rounded-2xl" data-testid="sequence-drop">
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Upload className="h-4 w-4" /> Paczka z fragmentami
          </h2>
          <p className="text-sm text-muted">
            Zaznacz wszystkie pliki z folderu paczki: klipy wideo i <code className="rounded bg-black/5 px-1">manifest.json</code>. Klipy trafiają do biblioteki sekwencji ({data.clips} w bibliotece), a manifest układa z nich filmy. Ponowne wgranie klipu o tej samej nazwie podmienia go.
          </p>
          {testi ? <p className="text-sm text-muted">Okładki (pliki <code className="rounded bg-black/5 px-1">F1_okladka.jpg</code>…) wgrywasz razem z klipami - trafiają do swojego filmu.</p> : null}
          <p className={testi ? "hidden" : "text-sm text-muted"}>
            <b>Explainery</b> (pliki <code className="rounded bg-black/5 px-1">E0a.mp4</code>, <code className="rounded bg-black/5 px-1">E1b.mp4</code>…) wgrywasz tym samym przyciskiem, także później. Każdy trafia jako warstwa w miejsce, w którym Kamil mówi dany fragment. Włączasz i wyłączasz je przy wersji filmu albo pojedynczo w Studiu.
          </p>
          {!testi && data.explainers.planned ? (
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="sequence-explainer-files">
              <span className={data.explainers.uploaded.length ? "text-emerald-700" : "text-muted"}>
                Explainery w bibliotece: {data.explainers.uploaded.length} z {data.explainers.planned}
                {data.explainers.uploaded.length ? ` (${data.explainers.uploaded.join(", ")})` : " - wgraj pliki o nazwach jak E0a.mp4"}
              </span>
              {data.explainers.uploaded.length ? (
                <button
                  type="button"
                  className="rounded-md border border-line px-2 py-0.5 text-xs font-medium hover:bg-black/[.04]"
                  data-testid="sequence-explainers-apply"
                  onClick={async () => {
                    const r = await api<{ added: number }>(`/api/admin/sequence/${id}/explainers`, { method: "POST" }).catch(() => ({ added: 0 }));
                    toast(r.added ? `Dodano ${r.added} warstw z explainerami` : "Wszystkie wgrane explainery są już w filmach");
                    await load();
                  }}
                >
                  Nałóż na filmy
                </button>
              ) : null}
            </p>
          ) : null}
          <div>
            <Button onClick={() => fileRef.current?.click()} disabled={busy} data-testid="sequence-upload">
              {busy ? <Loader2 className="animate-spin" /> : <Upload />} {busy ? "Wgrywam…" : "Wgraj paczkę"}
            </Button>
            <input ref={fileRef} type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.json,application/json,image/jpeg,image/png,.jpg,.jpeg,.png" className="hidden" data-testid="sequence-input" onChange={(e) => (void send([...(e.target.files ?? [])]), (e.target.value = ""))} />
          </div>
          {up ? (
            <div className="space-y-1.5" data-testid="sequence-upload-status">
              <Progress value={up.total ? (up.done / up.total) * 100 : 0} />
              <p className="text-xs text-muted">
                {up.done}/{up.total} {busy && up.current ? `· ${up.current}` : ""}
              </p>
              <ul className="space-y-0.5 text-sm">
                {up.log.map((l, i) => (
                  <li key={i} data-ok={l.ok} className={l.ok ? "text-emerald-700" : "text-red-600"}>
                    {l.ok ? "✓" : "✕"} {l.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </DropZone>

      <Card className="space-y-3" data-testid="sequence-outro">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Film className="h-4 w-4" /> Outro
        </h2>
        <p className="text-sm text-muted">Gotowy klip na koniec filmu. Możesz wgrać kilka formatów (1:1, 9:16, 16:9) - do każdego filmu trafi ten najbliższy jego formatowi. Outro jest zwykłym klipem na końcu montażu: w Studiu można je przesunąć, skrócić albo usunąć.</p>
        {data.outros.length ? (
          <ul className="space-y-1 text-sm">
            {data.outros.map((o) => (
              <li key={o.name} className="flex items-center gap-2" data-testid="sequence-outro-file">
                <span className="font-medium">{o.name}</span>
                <span className="text-xs text-muted tabular">
                  {o.width && o.height ? `${o.width}×${o.height} · ` : ""}
                  {o.durationSec.toFixed(1)} s
                </span>
                <button
                  type="button"
                  aria-label={`Usuń outro ${o.name}`}
                  className="rounded p-1 text-muted hover:bg-black/5 hover:text-red-600"
                  onClick={async () => {
                    await fetch(`/api/admin/sequence/${id}/outro?name=${encodeURIComponent(o.name)}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => outroRef.current?.click()} disabled={outroBusy} data-testid="sequence-outro-upload">
            {outroBusy ? <Loader2 className="animate-spin" /> : <Upload />} Wgraj outro
          </Button>
          <input ref={outroRef} type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="hidden" data-testid="sequence-outro-input" onChange={(e) => (void sendOutro([...(e.target.files ?? [])]), (e.target.value = ""))} />
          {data.outros.length && data.films.length ? (
            <>
              <Button size="sm" onClick={() => void outroAll(true)} disabled={outroBusy} data-testid="sequence-outro-all">
                Dodaj do wszystkich filmów
              </Button>
              <Button size="sm" variant="outline" onClick={() => void outroAll(false)} disabled={outroBusy || !data.films.some((f) => f.outro)}>
                Usuń ze wszystkich
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      {data.films.length ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              Filmy: {codes.length} · wersji: {data.films.length}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void render(data.films.filter((f) => f.review === "OK").map((f) => f.id))} disabled={running || !data.films.some((f) => f.review === "OK")}>
                <Download /> Eksportuj oznaczone OK
              </Button>
              <Button size="sm" onClick={() => void render()} disabled={running} data-testid="sequence-render-all">
                {running ? <Loader2 className="animate-spin" /> : <Download />} Eksportuj wszystkie (1:1)
              </Button>
            </div>
          </div>
          {jobs.length ? (
            <div className="rounded-xl border border-line p-3 text-sm" data-testid="sequence-renders">
              <p className="mb-1 text-muted">
                Eksport: gotowe {ready.length}/{jobs.length}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {jobs.map((j) => (
                  <span key={j.id} className="tabular">
                    {j.code}: {j.status === "SUCCEEDED" && j.downloadUrl ? <a href={j.downloadUrl} className="font-medium text-brand hover:underline">MP4</a> : j.status === "FAILED" ? <span className="text-red-600">błąd</span> : `${Math.round(j.progress * 100)}%`}
                  </span>
                ))}
              </div>
              {!running && ready.length > 1 ? (
                <a href={`/api/admin/render-jobs/zip?ids=${ready.map((j) => j.id).join(",")}`} className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3 text-sm font-medium text-white" data-testid="sequence-zip">
                  <Download className="h-4 w-4" /> Pobierz wszystkie ({ready.length}) w jednej paczce ZIP
                </a>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-4">
            {codes.map((code) => {
              const versions = data.films.filter((f) => f.code === code);
              const f0 = versions[0];
              return (
                <section key={code} className="rounded-xl border border-line" data-testid="sequence-film" data-code={code}>
                  <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                    {f0.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f0.cover.view} alt={`Okładka: ${f0.title}`} className="h-20 w-20 shrink-0 rounded-lg border border-line object-cover" data-testid="sequence-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">
                        {testi ? `Film ${code.replace(/^F/i, "")}` : code === "0" ? "Film 0" : `Odcinek ${code}`} · {f0.title}
                      </h3>
                      {f0.subject ? <p className="text-xs text-muted">{testi ? f0.subject : `Temat e-maila: ${f0.subject}`}</p> : null}
                    </div>
                    {f0.cover ? (
                      <a href={f0.cover.download} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium hover:bg-black/[.03]" data-testid="sequence-cover-download">
                        <Download className="h-3.5 w-3.5" /> Pobierz okładkę (JPG)
                      </a>
                    ) : null}
                  </header>
                  <ul>
                    {versions.map((f) => (
                      <li key={f.id} className={cn("flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 last:border-b-0", f.review === "OK" && "bg-emerald-50/60")} data-testid="sequence-version" data-review={f.review}>
                        <div className="w-16 shrink-0">
                          <span className="font-display text-lg font-semibold">{f.version}</span>
                          <span className="block text-xs text-muted tabular">{clock(f.durationSec)}</span>
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-xs text-muted">
                            {f.parts} fragmentów: {summary(f.labels)}
                          </p>
                          {f.note ? <p className="text-sm">{f.note}</p> : null}
                          {f.missing.length ? <p className="text-sm text-red-600">Brakuje klipów: {f.missing.join(", ")}</p> : null}
                          {f.explainers.planned ? (
                            <p className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="sequence-explainers">
                              <span>
                                Explainery: {f.explainers.inEdit ? `${f.explainers.on} z ${f.explainers.inEdit} włączonych` : "jeszcze nie wgrane"}
                                {f.explainers.waiting.length ? ` · czekają na pliki: ${f.explainers.waiting.join(", ")}` : ""}
                              </span>
                              {f.explainers.inEdit ? (
                                <button
                                  type="button"
                                  className="rounded-md border border-line px-2 py-0.5 font-medium text-ink hover:bg-black/[.04]"
                                  data-testid="sequence-explainers-toggle"
                                  onClick={async () => {
                                    await api(`/api/admin/sequence/films/${f.id}`, { method: "PATCH", json: { explainers: f.explainers.on === 0 } });
                                    await load();
                                  }}
                                >
                                  {f.explainers.on === 0 ? "Włącz wszystkie" : "Wyłącz wszystkie"}
                                </button>
                              ) : null}
                            </p>
                          ) : null}
                          {data.outros.length || f.outro ? (
                            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span>Outro: {f.outro ? "jest na końcu" : "brak"}</span>
                              <button
                                type="button"
                                className="rounded-md border border-line px-2 py-0.5 font-medium text-ink hover:bg-black/[.04]"
                                data-testid="sequence-outro-toggle"
                                onClick={async () => {
                                  try {
                                    await api(`/api/admin/sequence/films/${f.id}`, { method: "PATCH", json: { outro: !f.outro } });
                                  } catch (e) {
                                    toast((e as Error).message, "err");
                                  }
                                  await load();
                                }}
                              >
                                {f.outro ? "Usuń outro" : "Dodaj outro"}
                              </button>
                            </p>
                          ) : null}
                          {f.exported ? <Badge tone="green">wyeksportowany</Badge> : null}
                        </div>
                        <NativeSelect
                          aria-label={`Ocena wersji ${f.code}${f.version}`}
                          value={f.review}
                          className="h-8 w-40 text-xs"
                          onChange={async (e) => {
                            await api(`/api/admin/sequence/films/${f.id}`, { method: "PATCH", json: { review: e.target.value } });
                            await load();
                          }}
                        >
                          {Object.entries(REVIEW).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </NativeSelect>
                        {f.compositionId ? (
                          <Link href={`/studio/${f.compositionId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-white hover:bg-ink/85" data-testid="sequence-open">
                            <Film className="h-3.5 w-3.5" /> Otwórz w Studiu <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Usuń wersję ${f.code}${f.version}`}
                          className="rounded-lg p-2 text-muted hover:bg-black/5 hover:text-red-600"
                          onClick={async () => {
                            if (!confirm(`Usunąć wersję ${f.code}${f.version}? Jej montaż zniknie, klipy zostaną.`)) return;
                            await api(`/api/admin/sequence/films/${f.id}`, { method: "DELETE" });
                            await load();
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </Card>
      ) : (
        <EmptyState icon={<Film className="h-6 w-6" />} title="Nie ma jeszcze filmów">
          <p className="text-sm text-muted">Wgraj paczkę z fragmentami i plikiem manifest.json - filmy ułożą się same.</p>
        </EmptyState>
      )}
      {toastNode}
    </div>
  );
}

/** "KAMIL ×6, KLIENT ×4, PLANSZA ×3" */
function summary(labels: string[]) {
  const n = new Map<string, number>();
  for (const l of labels) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n.entries()].map(([l, c]) => `${l} ×${c}`).join(", ");
}
