"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Copy, Download, Package, Printer, Trash2, Upload, X } from "lucide-react";
import { DropZone } from "@/components/drop-zone";
import { Button, Card, EmptyState, Input, Label, NativeSelect, Textarea, useToast } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { imageSetChecks, SCORING_B_CRITERIA, textSetChecks } from "@/lib/adwords/score";
import { FORMAT_LABEL } from "@/lib/adwords/spec";
import { videoConcepts } from "@/lib/adwords/video";
import { ImagesTab } from "./images";
import { VideoTab, download } from "./video";
import { TextsTab } from "./texts";
import { ImportTab } from "./import";
import { HistoryTab } from "./history";
import { ExperimentsTab } from "./experiments";
import { AssistantTab } from "./assistant";
import { LandingContentTab } from "./landing-content";
import { ShareButton } from "./share";
import { MetaTab } from "./meta";
import type { AwData, Toast } from "./types";

const TABS = [
  ["kampanie", "Kampanie"],
  ["grafiki", "Kreacje graficzne"],
  ["wideo", "Wideo"],
  ["teksty", "Teksty reklam"],
  ["eksperymenty", "Eksperymenty A/B"],
  ["historia", "Historia PMax"],
  ["asystent", "Asystent kreacji"],
  ["landing", "Treść Landing Page"],
  ["meta", "Meta (FB/IG)"],
  ["import", "Import CSV"],
  ["raport", "Raport dla agencji"],
  ["eksperci", "Zdjęcia ekspertów"],
  ["wytyczne", "Wytyczne PMax"],
] as const;
type Tab = (typeof TABS)[number][0];

/** "Google Adwords" — the PMax creative set of one project. */
export function AdwordsProject({ projectId }: { projectId: string }) {
  const [data, setData] = useState<AwData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "kampanie") as Tab;
  const setTab = (t: Tab) => router.replace(`${path}?tab=${t}`, { scroll: false });
  const { toast, toastNode } = useToast();
  const load = useCallback(async () => setData(await api<AwData>(`/api/admin/adwords/${projectId}`)), [projectId]);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);
  if (!data) return <p className={cn("text-sm", error ? "text-red-600" : "text-muted")}>{error ?? "Wczytuję…"}</p>;
  const base = `/api/admin/adwords/${projectId}`;
  return (
    <div className="space-y-5" data-testid="adwords">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/adwords" className="text-sm text-muted hover:text-ink">
            ← Google Adwords
          </Link>
          <h1 className="mt-1 font-display text-[28px] font-semibold">{data.project.name}</h1>
          <p className="text-sm text-muted">Komponenty Performance Max: grafiki, wideo, teksty, ocena i paczka dla agencji. To narzędzie do przygotowania kreacji — nie publikuje reklam.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ShareButton projectId={projectId} canEdit={data.canEdit} toast={toast} />
          <a href={`${base}/zip?fmt=png`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white" data-testid="export-zip">
            <Package className="h-4 w-4" /> ZIP (PNG)
          </a>
          <a href={`${base}/zip?fmt=jpg`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-black/[.03]">
            ZIP (JPG)
          </a>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-line" data-testid="adwords-tabs">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 py-2.5 text-sm transition", tab === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
            {l}
          </button>
        ))}
      </nav>
      {data.assets.length === 0 && !["import", "wytyczne", "eksperci", "historia", "asystent", "landing", "meta"].includes(tab) ? (
        <EmptyState title="Brak komponentów">
          <button type="button" className="underline" onClick={() => setTab("import")}>
            Zaimportuj plik CSV
          </button>{" "}
          z konceptami, scenami i tekstami.
        </EmptyState>
      ) : null}
      {tab === "kampanie" && data.assets.length ? <CampaignsTab data={data} reload={load} toast={toast} /> : null}
      {tab === "grafiki" && data.assets.length ? <ImagesTab data={data} reload={load} toast={toast} /> : null}
      {tab === "wideo" && data.assets.length ? <VideoTab data={data} reload={load} toast={toast} /> : null}
      {tab === "teksty" && data.assets.length ? <TextsTab data={data} reload={load} toast={toast} /> : null}
      {tab === "import" ? <ImportTab data={data} reload={load} toast={toast} onDone={(kind) => setTab(kind === "history" ? "historia" : "kampanie")} /> : null}
      {tab === "eksperymenty" && data.assets.length ? <ExperimentsTab data={data} reload={load} toast={toast} /> : null}
      {tab === "historia" ? <HistoryTab data={data} reload={load} toast={toast} /> : null}
      {tab === "asystent" ? <AssistantTab data={data} reload={load} toast={toast} onAdded={(k) => setTab(k === "image" ? "grafiki" : "wideo")} /> : null}
      {tab === "landing" ? <LandingContentTab data={data} reload={load} toast={toast} /> : null}
      {tab === "meta" ? <MetaTab data={data} toast={toast} /> : null}
      {tab === "raport" && data.assets.length ? <ReportTab data={data} reload={load} toast={toast} /> : null}
      {tab === "eksperci" ? <PhotosTab data={data} reload={load} toast={toast} /> : null}
      {tab === "wytyczne" ? <SpecTab data={data} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------- campaigns

function CampaignsTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const save = async (id: string, patch: Record<string, unknown>) => {
    try {
      await api(`/api/admin/adwords/${data.project.id}/campaigns/${id}`, { method: "PATCH", json: patch });
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const missingKeys = [...new Set(data.assets.filter((a) => a.expertPhotoKey && !a.expertPhotoId && !data.photos.some((p) => p.key === a.expertPhotoKey)).map((a) => a.expertPhotoKey!))];
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="policy-note">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <b>Zasady Google — „trudności w związkach” (np. rozwody):</b> to kategoria wrażliwa — bez reklam spersonalizowanych (remarketing, listy klientów / Customer Match). Nie obiecuj gwarantowanego, bezkonfliktowego rozwodu ani skuteczności bez danych; nie naciskaj na mediację przy przemocy.{" "}
          <a href="https://support.google.com/adspolicy/answer/143465?hl=pl" target="_blank" rel="noreferrer" className="underline">
            Zasady
          </a>
        </p>
      </div>
      {missingKeys.length ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="missing-photos">
          Klucze zdjęć bez przypisania: {missingKeys.join(", ")} — przypisz je w zakładce „Zdjęcia ekspertów”.
        </p>
      ) : null}
      {data.campaigns.map((c) => {
        // a scene has no campaign of its own: it belongs where its concept's video variant is
        const variantOf = (cid: string | null) => data.assets.find((x) => x.rowType === "video" && x.conceptId === cid);
        const codeOf = (a: AwData["assets"][number]) => a.campaignCode ?? (a.rowType === "video_scene" ? variantOf(a.conceptId)?.campaignCode : null) ?? null;
        const groupOf = (a: AwData["assets"][number]) => a.assetGroup ?? (a.rowType === "video_scene" ? variantOf(a.conceptId)?.assetGroup : null) ?? "—";
        const assets = data.assets.filter((a) => codeOf(a) === c.code || (!codeOf(a) && c === data.campaigns[0]));
        const groups = [...new Set(assets.map(groupOf))];
        return (
          <Card key={c.id} className="space-y-4 p-5" data-testid="campaign">
            <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_1.6fr_1fr]">
              <div className="space-y-1">
                <Label>Nazwa kampanii ({c.code})</Label>
                <Input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && void save(c.id, { name: e.target.value })} aria-label="Nazwa kampanii" />
              </div>
              <div className="space-y-1">
                <Label>Cel konwersji</Label>
                <NativeSelect value={c.goal} onChange={(e) => void save(c.id, { goal: e.target.value })} aria-label="Cel konwersji">
                  <option value="sprzedaz">Sprzedaż (konsultacja)</option>
                  <option value="poradnik">Poradnik (edukacja)</option>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label>Docelowy URL</Label>
                <Input defaultValue={c.landingUrl ?? ""} placeholder="https://… — do uzupełnienia przed publikacją" onBlur={(e) => e.target.value !== (c.landingUrl ?? "") && void save(c.id, { landingUrl: e.target.value })} aria-label="Docelowy URL" className={!c.landingUrl ? "border-amber-400" : ""} />
              </div>
              <div className="space-y-1">
                <Label>Nazwa firmy (≤25)</Label>
                <Input defaultValue={c.businessName ?? ""} maxLength={25} onBlur={(e) => e.target.value !== (c.businessName ?? "") && void save(c.id, { businessName: e.target.value || null })} aria-label="Nazwa firmy" />
              </div>
            </div>
            {groups.map((g) => {
              const ga = assets.filter((a) => groupOf(a) === g);
              const imgs = imageSetChecks(ga.filter((a) => a.rowType === "image" || a.rowType === "image_clean"));
              const txt = textSetChecks(ga.filter((a) => ["headline", "long_headline", "description"].includes(a.rowType)));
              const vids = videoConcepts(ga);
              const ok = !!data.logoUrl && !!c.landingUrl && imgs.every((i) => i.level !== "blokada") && txt.every((t) => t.level !== "blokada");
              return (
                <div key={g} className="rounded-xl border border-line p-3" data-testid="group-checklist">
                  <p className="mb-2 text-sm font-medium">
                    Grupa komponentów {g} — {ok ? <span className="text-emerald-700">kompletna (wymagane)</span> : <span className="text-red-700">niekompletna</span>}
                  </p>
                  <ul className="grid gap-1 text-sm sm:grid-cols-2">
                    {imgs.map((i) => (
                      <li key={i.format} className={i.level === "blokada" ? "text-red-700" : i.level === "do_poprawy" ? "text-amber-800" : "text-emerald-700"}>
                        {i.level === "ok" ? "✓" : i.level === "blokada" ? "⛔" : "⚠"} {FORMAT_LABEL[i.format]}: {i.count} (wymagane {i.required}, zalecane {i.recommended}+)
                      </li>
                    ))}
                    {txt.map((t, k) => (
                      <li key={k} className={t.level === "blokada" ? "text-red-700" : t.level === "do_poprawy" ? "text-amber-800" : "text-emerald-700"}>
                        {t.level === "ok" ? "✓" : t.level === "blokada" ? "⛔" : "⚠"} {t.message}
                      </li>
                    ))}
                    <li className={data.logoUrl ? "text-emerald-700" : "text-red-700"}>{data.logoUrl ? "✓ Logo z motywu projektu" : "⛔ Brak logo w motywie (wymagane kwadratowe 1:1)"}</li>
                    <li className={c.landingUrl ? "text-emerald-700" : "text-amber-800"}>{c.landingUrl ? `✓ URL: ${c.landingUrl}` : "⚠ Brak docelowego URL"}</li>
                    <li className={vids.length ? "text-emerald-700" : "text-amber-800"}>
                      {vids.length ? "✓" : "⚠"} Wideo: {vids.length} koncept(y) — {vids.reduce((n, v) => n + v.variants.length, 0)} wariantów (maks. 15)
                    </li>
                  </ul>
                </div>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------- report

function ReportTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const [text, setText] = useState(data.project.brief ?? data.project.defaultBrief);
  const saved = data.project.brief ?? data.project.defaultBrief;
  const save = async (v: string | null, msg: string) => {
    try {
      await api(`/api/admin/adwords/${data.project.id}/brief`, { method: "PUT", json: { text: v } });
      toast(msg);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const texts = (t: string) => data.assets.filter((a) => a.rowType === t).map((a) => a.adText ?? "");
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5 print:border-0 print:shadow-none" data-testid="brief">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="font-medium">Brief dla agencji — edytuj przed eksportem</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save(text, "Zapisano brief")} disabled={text === saved || !data.canEdit} data-testid="brief-save">
              Zapisz
            </Button>
            {data.project.brief ? (
              <Button size="sm" variant="ghost" onClick={() => (setText(data.project.defaultBrief), void save(null, "Przywrócono wygenerowany brief"))}>
                Przywróć wygenerowany
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Skopiowano brief"))}>
              <Copy /> Kopiuj
            </Button>
            <Button size="sm" variant="outline" onClick={() => download(`${data.project.slug}_brief.md`, text, "text/markdown;charset=utf-8")} data-testid="brief-md">
              <Download /> .md
            </Button>
            <Button size="sm" variant="outline" onClick={() => download(`${data.project.slug}_brief.txt`, text)}>
              .txt
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer /> Drukuj / PDF
            </Button>
          </div>
        </div>
        <Textarea rows={22} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-[12.5px] leading-relaxed print:hidden" aria-label="Brief" />
        <pre className="hidden whitespace-pre-wrap font-sans text-[11pt] leading-snug print:block">{text}</pre>
      </Card>
      <div className="grid gap-3 md:grid-cols-3 print:hidden">
        {(["headline", "long_headline", "description"] as const).map((k) => (
          <Card key={k} className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{k === "headline" ? "Krótkie nagłówki" : k === "long_headline" ? "Długie nagłówki" : "Opisy"}</p>
              <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(texts(k).join("\n")).then(() => toast("Skopiowano"))}>
                <Copy /> Kopiuj
              </Button>
            </div>
            <ul className="space-y-0.5 text-xs">
              {texts(k).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------- expert photos

function PhotosTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ key: "", name: "", role: "", altText: "", consentConfirmed: false, consentNote: "" });
  // several photos at once: each with its own key (and name, if different) — sent one by one
  const [files, setFiles] = useState<Array<{ file: File; key: string; name: string; state: "new" | "sending" | "error"; error?: string }>>([]);
  const [sending, setSending] = useState(false);
  const taken = new Set(data.photos.map((p) => p.key));
  const slugKey = (n: string) =>
    n
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "zdjecie";
  const addFiles = (list: File[]) => {
    const ok = list.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    if (ok.length < list.length) toast(`Pominięto ${list.length - ok.length} plików — tylko JPG, PNG, WEBP`, "err");
    setFiles((cur) => {
      const used = new Set([...taken, ...cur.map((x) => x.key)]);
      const next = [...cur];
      for (const f of ok) {
        // the typed key for a single photo; with several: key_1, key_2… (or the file name)
        let k = form.key.trim() ? (ok.length === 1 && !cur.length ? form.key.trim() : `${form.key.trim()}_${next.length + 1}`) : slugKey(f.name);
        for (let i = 2; used.has(k); i++) k = `${k.replace(/_\d+$/, "")}_${i}`;
        used.add(k);
        next.push({ file: f, key: k, name: "", state: "new" });
      }
      return next;
    });
  };
  const upload = async () => {
    setSending(true);
    let done = 0;
    const rest: typeof files = [];
    for (const r of files) {
      setFiles((cur) => cur.map((x) => (x === r ? { ...x, state: "sending" } : x)));
      const fd = new FormData();
      fd.append("file", r.file);
      for (const [k, v] of Object.entries({ ...form, key: r.key, name: r.name.trim() || form.name })) fd.append(k, String(v));
      const res = await fetch(base, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok) done++;
      else rest.push({ ...r, state: "error", error: j.error ?? "Nie udało się" });
    }
    setFiles(rest);
    setSending(false);
    if (done) {
      toast(done === 1 ? "Dodano zdjęcie" : `Dodano ${done} zdjęć`);
      if (!rest.length) setForm({ key: "", name: "", role: "", altText: "", consentConfirmed: false, consentNote: "" });
      await reload();
    }
    if (rest.length) toast(`${rest.length} ${rest.length === 1 ? "zdjęcie nie zostało dodane" : "zdjęć nie zostało dodanych"}: ${rest[0].error}`, "err");
  };
  // consent shown at once (saved in the background)
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const keys = [...new Set(data.assets.map((a) => a.expertPhotoKey).filter((k): k is string => !!k))];
  const base = `/api/admin/adwords/${data.project.id}/photos`;
  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`${base}/${id}`, { method: "PATCH", json: body });
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Prawdziwe zdjęcia ekspertów są zapisane w motywie projektu (biblioteka marki). Pliki są prywatne — wyświetlane tylko przez podpisane, wygasające linki. Zdjęcie bez potwierdzonej zgody blokuje publikację komponentu.</p>
      {keys.length ? (
        <Card className="space-y-2 p-4" data-testid="photo-keys">
          <p className="text-sm font-medium">Klucze zdjęć z CSV</p>
          {keys.map((k) => {
            const n = data.assets.filter((a) => a.expertPhotoKey === k).length;
            const cur = data.assets.find((a) => a.expertPhotoKey === k)?.expertPhotoId ?? "";
            return (
              <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-40 font-mono">{k}</span>
                <span className="text-muted">{n} komponentów</span>
                <NativeSelect
                  className="h-8 w-64"
                  value={cur}
                  aria-label={`Zdjęcie dla ${k}`}
                  onChange={async (e) => {
                    await api(base, { method: "PUT", json: { key: k, photoId: e.target.value || null } });
                    toast("Przypisano zdjęcie");
                    await reload();
                  }}
                >
                  <option value="">— nie przypisano —</option>
                  {data.photos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            );
          })}
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.photos.map((p) => (
          <Card key={p.id} className="space-y-2 p-3" data-testid="expert-photo">
            {p.url ? (
              <div className="relative cursor-crosshair overflow-hidden rounded-lg" title="Kliknij, aby ustawić punkt ogniskowy (twarz)" onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                void patch(p.id, { focalX: Math.round(((e.clientX - r.left) / r.width) * 100) / 100, focalY: Math.round(((e.clientY - r.top) / r.height) * 100) / 100 });
              }}>
                <img src={p.url} alt={p.altText ?? p.name} className="w-full" />
                <span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-pink-500/70" style={{ left: `${p.focalX * 100}%`, top: `${p.focalY * 100}%` }} />
              </div>
            ) : null}
            <p className="text-sm font-medium">
              {p.name} <span className="font-mono text-xs text-muted">{p.key}</span>
            </p>
            <Input defaultValue={p.role ?? ""} placeholder="Rola, np. mediator" onBlur={(e) => e.target.value !== (p.role ?? "") && void patch(p.id, { role: e.target.value || null })} aria-label="Rola" />
            <Input defaultValue={p.altText ?? ""} placeholder="Tekst alternatywny" onBlur={(e) => e.target.value !== (p.altText ?? "") && void patch(p.id, { altText: e.target.value || null })} aria-label="Tekst alternatywny" />
            <label className={cn("flex items-center gap-2 text-sm", (consent[p.id] ?? p.consentConfirmed) ? "text-emerald-700" : "text-red-700")}>
              <input
                type="checkbox"
                checked={consent[p.id] ?? p.consentConfirmed}
                onChange={(e) => {
                  const v = e.target.checked;
                  setConsent((c) => ({ ...c, [p.id]: v }));
                  void patch(p.id, { consentConfirmed: v });
                }}
                className="h-4 w-4"
                data-testid="photo-consent"
              /> Zgoda na komercyjne użycie
              {p.consentAt ? <span className="text-xs text-muted">({new Date(p.consentAt).toLocaleDateString("pl-PL")})</span> : null}
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={async () => {
                if (!confirm(`Usunąć zdjęcie ${p.name}?`)) return;
                await api(`${base}/${p.id}`, { method: "DELETE" });
                await reload();
              }}
            >
              <Trash2 /> Usuń
            </Button>
          </Card>
        ))}
      </div>
      <Card className="space-y-3 p-4" data-testid="photo-upload">
        <p className="font-medium">Dodaj zdjęcia eksperta</p>
        <p className="text-xs text-muted">Możesz wybrać lub przeciągnąć kilka plików naraz. Imię, rola, opis i zgoda poniżej dotyczą wszystkich — klucz (i w razie potrzeby imię) ustawisz osobno przy każdym zdjęciu.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Klucz (jak w CSV; przy kilku: klucz_1, klucz_2…)</Label>
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="ekspert_marek" list="aw-keys" aria-label="Klucz zdjęcia" />
            <datalist id="aw-keys">
              {keys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label>Imię i nazwisko</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Imię i nazwisko" />
          </div>
          <div className="space-y-1">
            <Label>Rola</Label>
            <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Rola eksperta" />
          </div>
          <div className="space-y-1">
            <Label>Tekst alternatywny</Label>
            <Input value={form.altText} onChange={(e) => setForm({ ...form, altText: e.target.value })} aria-label="Alt" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.consentConfirmed} onChange={(e) => setForm({ ...form, consentConfirmed: e.target.checked })} className="h-4 w-4" /> Potwierdzam zgodę osoby na komercyjne użycie zdjęć w reklamach
        </label>
        <DropZone onFiles={addFiles} accept="image/jpeg,image/png,image/webp" label="Upuść zdjęcia tutaj" className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted" data-testid="photo-drop">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!data.canEdit}>
              <Upload /> Wybierz zdjęcia (JPG/PNG/WEBP, ≤15 MB każde)
            </Button>
            <span>albo przeciągnij kilka plików</span>
          </div>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" data-testid="photo-file" onChange={(e) => (addFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
        </DropZone>
        {files.length ? (
          <ul className="space-y-1.5" data-testid="photo-queue">
            {files.map((r, i) => (
              <li key={`${r.file.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm" data-testid="photo-queue-row">
                <span className="w-44 truncate text-xs text-muted" title={r.file.name}>
                  {r.file.name} · {(r.file.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <Input className="h-8 w-44 font-mono text-xs" value={r.key} onChange={(e) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} aria-label={`Klucz ${r.file.name}`} />
                <Input className="h-8 w-44 text-xs" value={r.name} placeholder={form.name || "imię i nazwisko"} onChange={(e) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Imię ${r.file.name}`} />
                {r.state === "sending" ? <span className="text-xs text-muted">wysyłam…</span> : null}
                {r.state === "error" ? <span className="text-xs text-red-700">{r.error}</span> : null}
                <Button size="iconSm" variant="ghost" aria-label={`Usuń ${r.file.name} z listy`} disabled={sending} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={sending || !files.length || files.some((r) => !r.key.trim() || !(r.name.trim() || form.name.trim())) || new Set(files.map((r) => r.key.trim())).size < files.length || !data.canEdit}
            data-testid="photo-add"
            onClick={() => void upload()}
          >
            {sending ? "Wysyłam…" : files.length > 1 ? `Dodaj ${files.length} zdjęcia` : "Dodaj"}
          </Button>
          {files.length && new Set(files.map((r) => r.key.trim())).size < files.length ? <span className="text-xs text-red-700">Klucze muszą być różne.</span> : null}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------- guidelines

function SpecTab({ data }: { data: AwData }) {
  const s = data.spec;
  return (
    <div className="space-y-4" data-testid="spec">
      <Card className="space-y-3 p-5">
        <p className="font-medium">Parametry komponentów PMax — stan na {s.verifiedAt}</p>
        <p className="text-xs text-muted">{s.verification}</p>
        <table className="w-full text-left text-sm">
          <tbody>
            {s.images.formats.map((f) => (
              <tr key={f.key} className="border-b border-line/60">
                <td className="py-1.5">Obraz {FORMAT_LABEL[f.key]}</td>
                <td>
                  zalecane {f.width}×{f.height}, min. {f.minWidth}×{f.minHeight}; zalecane {f.recommendedCount}+ na grupę
                </td>
              </tr>
            ))}
            <tr className="border-b border-line/60">
              <td className="py-1.5">Pliki obrazów</td>
              <td>PNG / JPG, maks. 5120 KB; treść w środkowych 80% kadru; do {s.images.maxPerGroup} obrazów na grupę</td>
            </tr>
            {s.logos.map((l) => (
              <tr key={l.key} className="border-b border-line/60">
                <td className="py-1.5">Logo {l.ratio}</td>
                <td>
                  {l.width}×{l.height}, min. {l.minWidth}×{l.minHeight}
                  {l.required ? " — wymagane" : ""}
                </td>
              </tr>
            ))}
            {Object.values(s.texts).map((t) => (
              <tr key={t.label} className="border-b border-line/60">
                <td className="py-1.5">{t.label}</td>
                <td>
                  maks. {t.maxChars} znaków, {t.minCount}–{t.maxCount} szt., zalecane {t.recommendedCount}
                  {"shortOneMaxChars" in t ? `; min. jeden ≤${t.shortOneMaxChars} znaków` : ""}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5">Wideo</td>
              <td>
                {s.videos.formats.map((f) => `${f.ratio} (${f.width}×${f.height})`).join(", ")}; min. {s.videos.minSeconds} s, praktycznie do {s.videos.practicalMaxSeconds} s; maks. {s.videos.maxPerGroup} na grupę. {s.videos.note}
              </td>
            </tr>
          </tbody>
        </table>
        <div>
          <p className="text-sm font-medium">Różnice względem założeń briefu</p>
          <ul className="list-disc pl-5 text-sm">
            {s.corrections.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium">Źródła</p>
          <ul className="list-disc pl-5 text-sm">
            {s.sources.map((x) => (
              <li key={x.url}>
                <a href={x.url} target="_blank" rel="noreferrer" className="underline">
                  {x.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <Card className="space-y-3 p-5" data-testid="scoring-b-method">
        <p className="font-medium">
          Scoring B — metodyka ({data.scoringB.version}, {data.scoringB.date})
        </p>
        <p className="text-sm text-muted">{data.scoringB.summary}</p>
        <p className="text-xs text-muted">Dostęp do źródeł: {data.scoringB.accessed}</p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="py-1">Typ</th>
              <th>Kryterium</th>
              <th>Waga</th>
              <th>Podstawa</th>
              <th>Uzasadnienie</th>
            </tr>
          </thead>
          <tbody>
            {SCORING_B_CRITERIA.map((c) => (
              <tr key={c.kind + c.label} className="border-b border-line/60 align-top">
                <td className="py-1.5">{c.kind}</td>
                <td>{c.label}</td>
                <td>{c.weight}</td>
                <td>{c.basis}</td>
                <td className="text-xs">
                  {c.why}{" "}
                  {c.sources.map((k) => (
                    <a key={k} href={data.scoringB.sources[k].url} target="_blank" rel="noreferrer" className="underline" title={data.scoringB.sources[k].title}>
                      [{k}]
                    </a>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">Scoring A (operacyjny) to rubryka z briefu. Obie oceny są pokazywane obok siebie, nigdy uśredniane, i nie są prognozą konwersji. Walidacja (gotowe / do poprawy / blokada) nie zależy od żadnej z nich.</p>
      </Card>
    </div>
  );
}
