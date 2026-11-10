"use client";
import { useEffect, useRef, useState } from "react";
import { Columns2, Loader2, Sparkles, UserRound, Wand2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/utils";
import { mentionsTopic } from "@/lib/adwords/score";
import type { AwData, Toast } from "./types";

interface Fix {
  key: string;
  kind: "image" | "headline" | "long_headline";
  ids: string[];
  label: string;
  current: string;
  proposal: string;
  limit: number;
}

/** Grafiki → more creatives: the topic in every headline, versions with the expert's photo, AI infographic versions */
export function MoreCreatives({ data, reload, toast, picked, setPicked }: { data: AwData; reload: () => Promise<void>; toast: Toast; picked: string[]; setPicked: (f: (p: string[]) => string[]) => void }) {
  // the source concepts (not the versions made here) — picked here or with the checkboxes on the cards
  const sources = [...new Map(data.assets.filter((a) => a.rowType === "image" && a.conceptId && !a.edit?.variantOf).map((a) => [a.conceptId!, a])).values()];
  const base = `/api/admin/adwords/${data.project.id}`;
  const [topic, setTopic] = useState(data.project.topicSet ?? data.project.topic ?? "");
  const [fixes, setFixes] = useState<Array<Fix & { on: boolean }> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(0);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const t = data.project.topic;
  const heads = data.assets.filter((a) => (a.rowType === "image" && a.effectiveLayout !== "infographic" && a.headline) || ((a.rowType === "headline" || a.rowType === "long_headline") && a.adText));
  const missing = t ? new Set(heads.filter((a) => !mentionsTopic((a.rowType === "image" ? a.headline : a.adText) ?? "", t)).map((a) => (a.rowType === "image" ? `img:${a.conceptId}` : a.id))).size : 0;
  const photos = data.photos.length;
  // which photos the expert versions use (one version per photo); default: those with consent
  const [photoSel, setPhotoSel] = useState<string[]>(() => {
    const ok = data.photos.filter((p) => p.consentConfirmed).map((p) => p.id);
    return ok.length ? ok : data.photos.map((p) => p.id);
  });

  // infographic jobs: watch until they are done, then reload the gallery
  const watch = () => {
    if (poll.current) return;
    poll.current = setInterval(async () => {
      const jobs = await api<Array<{ status: string; error: string | null; payload: { conceptId: string } }>>(`${base}/variants`).catch(() => []);
      const live = jobs.filter((j) => j.status === "QUEUED" || j.status === "RUNNING").length;
      setRunning(live);
      if (!live) {
        clearInterval(poll.current!);
        poll.current = null;
        const failed = jobs.filter((j) => j.status === "FAILED");
        if (failed.length) toast(`Infografika ${failed[0].payload.conceptId}: ${failed[0].error ?? "nie udało się"}`, "err");
        await reload();
      }
    }, 5000);
  };
  useEffect(() => {
    void api<Array<{ status: string }>>(`${base}/variants`)
      .then((j) => {
        if (j.some((x) => x.status === "QUEUED" || x.status === "RUNNING")) watch();
      })
      .catch(() => null);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="space-y-3 p-4" data-testid="more-creatives">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">Temat reklam</p>
          <Input className="h-9 w-48" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="np. rozwód" aria-label="Temat reklam" disabled={!data.canEdit} />
        </div>
        <Button
          variant="outline"
          disabled={!data.canEdit || topic === (data.project.topicSet ?? data.project.topic ?? "")}
          onClick={() =>
            void run("topic", async () => {
              await api(`${base}/copy-fix`, { method: "PUT", json: { topic: topic || null } });
              await reload();
              toast("Zapisano temat");
            })
          }
        >
          Zapisz
        </Button>
        <p className="min-w-56 flex-1 pb-2 text-xs text-muted">
          {t ? (
            <>
              Każdy nagłówek powinien mówić, czego dotyczy reklama („{t}”). {missing ? <b className="text-amber-800">{missing} bez tematu.</b> : "Wszystkie mają temat."}
            </>
          ) : (
            "Ustaw temat (np. „rozwód”) — nagłówki bez niego dostaną ostrzeżenie."
          )}
        </p>
      </div>
      <div className="space-y-1" data-testid="pick-sources">
        <p className="text-xs text-muted">
          Koncepty do nowych wersji ({picked.length ? `zaznaczone: ${picked.length}` : "nic nie zaznaczono — ekspert i porównanie: wszystkie, infografika: wybierz"}){" "}
          {picked.length ? (
            <button type="button" className="underline" onClick={() => setPicked(() => [])}>
              wyczyść
            </button>
          ) : (
            <button type="button" className="underline" onClick={() => setPicked(() => sources.map((a) => a.conceptId!))}>
              zaznacz wszystkie
            </button>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((a) => {
            const on = picked.includes(a.conceptId!);
            return (
              <button key={a.conceptId} type="button" title={a.headline ?? ""} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== a.conceptId) : [...p, a.conceptId!]))} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink"}`} aria-pressed={on} data-testid="pick-source">
                {a.conceptId}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!data.canEdit || !t || busy !== null}
          onClick={() =>
            void run("fix", async () => {
              const r = await api<{ items: Fix[]; warning: string | null; engine: string }>(`${base}/copy-fix`, { method: "POST" });
              setFixes(r.items.map((i) => ({ ...i, on: true })));
              setNote(r.warning ?? (r.engine === "openai" ? "Propozycje OpenAI — sprawdź i zapisz." : null));
              if (!r.items.length) toast("Wszystkie nagłówki mają temat");
            })
          }
          data-testid="copy-fix"
        >
          {busy === "fix" ? <Loader2 className="animate-spin" /> : <Wand2 />} Popraw nagłówki (dodaj temat)
        </Button>
        <Button
          variant="outline"
          disabled={!data.canEdit || busy !== null || !photoSel.length}
          title={photos ? "" : "Najpierw dodaj zdjęcia ekspertów"}
          onClick={() =>
            void run("expert", async () => {
              const r = await api<{ made: string[]; skipped: string[] }>(`${base}/variants`, { method: "POST", json: { kind: "expert", conceptIds: picked.length ? picked : undefined, photoIds: photoSel } });
              await reload();
              toast(r.made.length ? `Dodano ${r.made.length} koncepty z ekspertem: ${r.made.join(", ")}` : "Nie ma konceptów do powielenia (już mają zdjęcie albo wersję z ekspertem)");
            })
          }
          data-testid="variants-expert"
        >
          {busy === "expert" ? <Loader2 className="animate-spin" /> : <UserRound />} Wersje z ekspertem: {picked.length ? `${picked.length} konc.` : "wszystkie"} × {photoSel.length} zdj.
        </Button>
        <Button
          variant="outline"
          disabled={!data.canEdit || busy !== null}
          onClick={() =>
            void run("cmp", async () => {
              const r = await api<{ made: string[] }>(`${base}/variants`, { method: "POST", json: { kind: "comparison", conceptIds: picked.length ? picked : undefined } });
              await reload();
              toast(r.made.length ? `Dodano ${r.made.length} grafiki porównawcze: ${r.made.join(", ")} — teksty kart poprawisz w edytorze` : "Te koncepty mają już wersję porównawczą");
            })
          }
          data-testid="variants-comparison"
        >
          {busy === "cmp" ? <Loader2 className="animate-spin" /> : <Columns2 />} Wersje porównawcze {picked.length ? `(${picked.length})` : "(wszystkie)"}
        </Button>
        <Button
          variant="outline"
          disabled={!data.canEdit || busy !== null || !picked.length || running > 0}
          title={picked.length ? "" : "Zaznacz koncepty (pole wyboru na karcie)"}
          onClick={() =>
            void run("info", async () => {
              const r = await api<{ jobs: number }>(`${base}/variants`, { method: "POST", json: { kind: "infographic", conceptIds: picked } });
              if (!r.jobs) return toast("Te koncepty mają już wersję z infografiką");
              setRunning(r.jobs);
              toast(`Generuję infografiki (${r.jobs}) — pojawią się jako nowe koncepty za 1–3 min`);
              watch();
            })
          }
          data-testid="variants-infographic"
        >
          {running ? <Loader2 className="animate-spin" /> : <Sparkles />} {running ? `Generuję infografiki (${running})…` : `Wersje z infografiką AI ${picked.length ? `(${picked.length})` : "— wybierz koncepty powyżej"}`}
        </Button>
      </div>
      {photos ? (
        <div className="flex flex-wrap gap-2" data-testid="variant-photos">
          {data.photos.map((p) => {
            const on = photoSel.includes(p.id);
            return (
              <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-xs ${on ? "border-ink bg-white" : "border-line text-muted"}`} title={p.consentConfirmed ? "" : "Brak zgody — kreacja będzie zablokowana"}>
                <input type="checkbox" className="h-3.5 w-3.5" checked={on} onChange={(e) => setPhotoSel((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} aria-label={`Zdjęcie ${p.key}`} />
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" className="h-9 w-9 rounded object-cover" />
                ) : null}
                <span>
                  {p.name}
                  <span className="block font-mono text-[10px] text-muted">
                    {p.key}
                    {p.consentConfirmed ? "" : " · brak zgody"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      <p className="text-xs text-muted">
        Wersje z ekspertem: ta sama treść z każdym zaznaczonym zdjęciem — nowe koncepty G03E, G03E2… (zdjęcie zmienisz też na karcie konceptu przed pobraniem). Porównania: dwie karty „tradycyjnie” vs „z planem” (teksty pisze AI, poprawisz w edytorze) — litera C. Infografiki: OpenAI w kolorach motywu, jak w reelsach — litera I, do zatwierdzenia (tekst na obrazie pisze AI).
      </p>
      {fixes ? (
        <div className="space-y-2 rounded-lg border border-line p-3" data-testid="copy-fixes">
          {note ? <p className="text-xs text-muted">{note}</p> : null}
          {fixes.map((f, i) => (
            <div key={f.key} className="grid items-center gap-2 text-sm md:grid-cols-[24px_150px_1fr_1fr_56px]" data-testid="copy-fix-row">
              <input type="checkbox" className="h-4 w-4" checked={f.on} onChange={(e) => setFixes((x) => x!.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label={`Zastosuj ${f.label}`} />
              <span className="text-xs text-muted">{f.label}</span>
              <span className="text-muted line-through decoration-black/20">{f.current}</span>
              <Input className="h-8" value={f.proposal} onChange={(e) => setFixes((x) => x!.map((y, j) => (j === i ? { ...y, proposal: e.target.value } : y)))} aria-label={`Propozycja ${f.label}`} />
              <span className={`text-right text-xs tabular-nums ${[...f.proposal].length > f.limit ? "font-semibold text-red-600" : "text-muted"}`}>
                {[...f.proposal].length}/{f.limit}
              </span>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              disabled={!fixes.some((f) => f.on) || fixes.some((f) => f.on && (!f.proposal.trim() || [...f.proposal].length > f.limit)) || busy !== null}
              onClick={() =>
                void run("apply", async () => {
                  const on = fixes.filter((f) => f.on);
                  for (const f of on) for (const id of f.ids) await api(`${base}/assets/${id}`, { method: "PATCH", json: f.kind === "image" ? { headline: f.proposal.trim() } : { adText: f.proposal.trim() } });
                  setFixes(null);
                  await reload();
                  toast(`Zapisano ${on.length} nagłówków`);
                })
              }
              data-testid="copy-fix-apply"
            >
              Zapisz zaznaczone ({fixes.filter((f) => f.on).length})
            </Button>
            <Button variant="ghost" onClick={() => setFixes(null)}>
              Zamknij
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
