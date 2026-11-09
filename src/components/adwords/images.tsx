"use client";
import { useMemo, useState } from "react";
import { Check, Download, Eye, EyeOff } from "lucide-react";
import { Button, Card, Input, Label, NativeSelect, Switch, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { LAYOUTS, type LayoutKey } from "@/lib/adwords/draw";
import { FORMAT_LABEL, formatKeyOf, imageFormat, PMAX_SPEC } from "@/lib/adwords/spec";
import { brandContext, layoutOf } from "@/lib/adwords/context";
import { gateImage, scoreImageA, scoreImageB, type Measure } from "@/lib/adwords/score";
import { CreativeCanvas } from "./canvas";
import { GateBadge, GateList, ScorePair } from "./scores";
import type { AwAsset, AwData, Toast } from "./types";

const sizeOf = (a: AwAsset) => {
  const k = formatKeyOf(a.aspectRatio, a.width, a.height) ?? "square";
  const f = imageFormat(k);
  const ok = a.width && a.height && Math.abs(a.width / a.height - f.width / f.height) < 0.02;
  return { key: k, w: ok ? a.width! : f.width, h: ok ? a.height! : f.height };
};

export function useCreativeInput(data: AwData) {
  return (a: AwAsset, showSafeArea = false) => {
    const { w, h } = sizeOf(a);
    const photo = a.expertPhotoId ? data.photos.find((p) => p.id === a.expertPhotoId) : a.expertPhotoKey ? data.photos.find((p) => p.key === a.expertPhotoKey) : null;
    const e = a.edit ?? {};
    return {
      width: w,
      height: h,
      layout: (a.effectiveLayout ?? "typographic") as LayoutKey,
      copy: { headline: a.headline ?? "", subheadline: a.subheadline, body: a.body, cta: a.cta },
      theme: data.theme,
      logoUrl: data.logoUrl,
      photo: photo && !e.photoHidden ? { url: photo.url, focalX: photo.focalX, focalY: photo.focalY, zoom: e.zoom, offsetX: e.offsetX, offsetY: e.offsetY } : null,
      showSafeArea,
      safeMargin: PMAX_SPEC.images.safeMargin,
    };
  };
}

export function ImagesTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const images = data.assets.filter((a) => a.rowType === "image" || a.rowType === "image_clean");
  const concepts = useMemo(() => [...new Set(images.map((a) => a.conceptId ?? a.assetKey))], [images]);
  const [type, setType] = useState("all");
  const [funnel, setFunnel] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const toInput = useCreativeInput(data);
  const evalOf = (id: string) => data.evaluation.images.find((e) => e.id === id);
  const shown = concepts.filter((c) => {
    const rows = images.filter((a) => (a.conceptId ?? a.assetKey) === c);
    if (type === "text" && rows.every((r) => r.rowType === "image_clean")) return false;
    if (type === "clean" && rows.some((r) => r.rowType === "image")) return false;
    if (funnel !== "all" && !rows.some((r) => r.funnel === funnel)) return false;
    const avg = rows.reduce((n, r) => n + (evalOf(r.id)?.scoreA?.total ?? 0), 0) / rows.length;
    return !minScore || avg >= minScore;
  });
  if (!images.length) return <Card className="p-6 text-sm text-muted">Brak grafik — zaimportuj CSV (zakładka „Import CSV”).</Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="image-filters">
        <NativeSelect className="h-9 w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label="Typ">
          <option value="all">Wszystkie typy</option>
          <option value="text">Z tekstem</option>
          <option value="clean">Czyste zdjęcia</option>
        </NativeSelect>
        <NativeSelect className="h-9 w-40" value={funnel} onChange={(e) => setFunnel(e.target.value)} aria-label="Lejek">
          <option value="all">Każdy lejek</option>
          {[...new Set(images.map((a) => a.funnel).filter(Boolean))].map((f) => (
            <option key={f} value={f!}>
              {f}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="h-9 w-44" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Scoring">
          <option value={0}>Każdy wynik A</option>
          <option value={60}>A ≥ 60</option>
          <option value={75}>A ≥ 75</option>
        </NativeSelect>
        <span className="text-sm text-muted">
          {shown.length} z {concepts.length} konceptów
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map((c) => {
          const rows = images.filter((a) => (a.conceptId ?? a.assetKey) === c).sort((x, y) => ["landscape", "square", "portrait"].indexOf(sizeOf(x).key) - ["landscape", "square", "portrait"].indexOf(sizeOf(y).key));
          const ev = rows.map((r) => evalOf(r.id)).filter(Boolean);
          const worst = ev.some((e) => e!.gate.status === "blokada") ? "blokada" : ev.some((e) => e!.gate.status === "do_poprawy") ? "do_poprawy" : "gotowe";
          return (
            <Card key={c} className={cn("cursor-pointer p-4 transition hover:shadow-md", open === c && "ring-2 ring-ink")} onClick={() => setOpen(c)} data-testid="concept-card">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c} <span className="text-sm font-normal text-muted">· {rows[0].rowType === "image_clean" ? "czyste zdjęcie" : LAYOUTS[(rows[0].effectiveLayout ?? "typographic") as keyof typeof LAYOUTS] ?? ""}</span>
                  </p>
                  <p className="truncate text-sm text-muted">{rows[0].headline ?? rows[0].visualBrief}</p>
                </div>
                <GateBadge gate={{ status: worst, problems: ev.flatMap((e) => e!.gate.problems) }} />
              </div>
              <div className="flex items-end gap-2">
                {rows.map((r) => (
                  <CreativeCanvas key={r.id} input={toInput(r)} className={cn("rounded border border-line bg-white", sizeOf(r).key === "landscape" ? "w-[46%]" : sizeOf(r).key === "square" ? "w-[26%]" : "w-[22%]")} />
                ))}
              </div>
              {ev[0]?.scoreA ? (
                <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                  <ScorePair a={ev[0].scoreA} b={ev[0].scoreB} seed={rows[0].scoreSeed} compact />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      {open ? <ConceptEditor key={open} conceptId={open} data={data} reload={reload} toast={toast} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** One concept, three formats side by side, edited WYSIWYG (the same drawing as the export). */
function ConceptEditor({ conceptId, data, reload, toast, onClose }: { conceptId: string; data: AwData; reload: () => Promise<void>; toast: Toast; onClose: () => void }) {
  const rows = data.assets.filter((a) => (a.rowType === "image" || a.rowType === "image_clean") && (a.conceptId ?? a.assetKey) === conceptId).sort((x, y) => ["landscape", "square", "portrait"].indexOf(sizeOf(x).key) - ["landscape", "square", "portrait"].indexOf(sizeOf(y).key));
  const [draft, setDraft] = useState<Record<string, AwAsset>>(() => Object.fromEntries(rows.map((r) => [r.id, r])));
  const [sel, setSel] = useState(rows[0].id);
  const [all, setAll] = useState(true);
  const [safe, setSafe] = useState(true);
  const [measures, setMeasures] = useState<Record<string, Measure>>({});
  const [saving, setSaving] = useState(false);
  const toInput = useCreativeInput(data);
  // the draft holds the edits; approval is decided on the server and always taken from the data
  const view = (id: string) => {
    const live = rows.find((r) => r.id === id)!;
    return { ...draft[id], approvedAt: live.approvedAt, approvedBy: live.approvedBy };
  };
  const cur = view(sel);
  const campaign = data.campaigns.find((c) => c.code === cur.campaignCode);
  const ctx = brandContext({ name: data.project.name, adwordsBrief: data.project.brief }, campaign?.landingUrl ?? data.campaigns.find((c) => c.landingUrl)?.landingUrl ?? null, !!data.logoUrl);
  const photoOf = (a: AwAsset) => {
    const p = a.expertPhotoId ? data.photos.find((x) => x.id === a.expertPhotoId) : a.expertPhotoKey ? data.photos.find((x) => x.key === a.expertPhotoKey) : null;
    return p ? { id: p.id, consentConfirmed: p.consentConfirmed } : null;
  };
  // edit: the selected format, or all formats of the concept
  const change = (patch: Partial<AwAsset>) =>
    setDraft((d) => {
      const n = { ...d };
      for (const id of all ? Object.keys(d) : [sel]) {
        const next = { ...n[id], ...patch };
        if (patch.edit) next.edit = { ...(n[id].edit ?? {}), ...patch.edit };
        next.effectiveLayout = layoutOf(next);
        n[id] = next;
      }
      return n;
    });
  const dirty = rows.some((r) => JSON.stringify(r) !== JSON.stringify(draft[r.id]));
  const save = async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        const d = draft[r.id];
        if (JSON.stringify(r) === JSON.stringify(d)) continue;
        await api(`/api/admin/adwords/${data.project.id}/assets/${r.id}`, {
          method: "PATCH",
          json: { headline: d.headline, subheadline: d.subheadline, body: d.body, cta: d.cta, claimSource: d.claimSource, layout: d.layout as never, expertPhotoId: d.expertPhotoId, edit: d.edit ?? undefined },
        });
      }
      toast("Zapisano koncept");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };
  const approve = async (v: boolean) => {
    for (const r of rows) await api(`/api/admin/adwords/${data.project.id}/assets/${r.id}`, { method: "PATCH", json: { approve: v } });
    toast(v ? "Źródło zatwierdzone" : "Cofnięto zatwierdzenie");
    await reload();
  };
  const clean = cur.rowType === "image_clean";
  return (
    <Card className="space-y-4 p-5" data-testid="concept-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold">Koncept {conceptId}</p>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            {safe ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Safe area (80%)
            <Switch checked={safe} onCheckedChange={setSafe} />
          </label>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Zamknij
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {rows.map((r) => {
          const d = view(r.id);
          const m = measures[r.id];
          const g = gateImage(d, ctx, m ?? null, photoOf(d));
          const { key, w, h } = sizeOf(r);
          return (
            <button key={r.id} type="button" onClick={() => setSel(r.id)} className={cn("space-y-1.5 rounded-xl border-2 p-2 text-left", sel === r.id ? "border-ink" : "border-transparent hover:border-line")} style={{ width: key === "landscape" ? 380 : key === "square" ? 240 : 200 }} data-testid={`format-${key}`}>
              <CreativeCanvas input={toInput(d, safe)} className="w-full rounded border border-line bg-white" onMeasure={(mm) => setMeasures((x) => (JSON.stringify(x[r.id]) === JSON.stringify(mm) ? x : { ...x, [r.id]: mm }))} testId={`preview-${key}`} />
              <div className="flex items-center justify-between gap-1 text-xs">
                <span>
                  {FORMAT_LABEL[key]} · {w}×{h}
                </span>
                <GateBadge gate={g} />
              </div>
              <div className="flex gap-2 text-xs">
                <a href={`/api/admin/adwords/${data.project.id}/render/${r.id}?fmt=png&download=1`} className="inline-flex items-center gap-1 text-brand underline" onClick={(e) => e.stopPropagation()} data-testid="download-png">
                  <Download className="h-3 w-3" /> PNG
                </a>
                <a href={`/api/admin/adwords/${data.project.id}/render/${r.id}?fmt=jpg&download=1`} className="text-brand underline" onClick={(e) => e.stopPropagation()}>
                  JPG
                </a>
              </div>
            </button>
          );
        })}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4" /> Zmieniaj we wszystkich formatach (odznacz, aby poprawić tylko wybrany: {FORMAT_LABEL[sizeOf(cur).key]})
          </label>
          {!clean ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Układ</Label>
                  <NativeSelect value={cur.effectiveLayout ?? "typographic"} onChange={(e) => change({ layout: e.target.value })} aria-label="Układ">
                    {Object.entries(LAYOUTS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label>CTA</Label>
                  <Input value={cur.cta ?? ""} onChange={(e) => change({ cta: e.target.value })} aria-label="CTA" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Hasło (headline)</Label>
                <Input value={cur.headline ?? ""} onChange={(e) => change({ headline: e.target.value })} aria-label="Hasło" data-testid="edit-headline" />
              </div>
              <div className="space-y-1">
                <Label>Podtytuł (najwyżej jeden)</Label>
                <Input value={cur.subheadline ?? ""} onChange={(e) => change({ subheadline: e.target.value })} aria-label="Podtytuł" />
              </div>
              <div className="space-y-1">
                <Label>{cur.effectiveLayout === "process_steps" ? "Kroki (rozdziel |)" : "Punkt dowodu (krótko)"}</Label>
                <Textarea rows={2} value={cur.body ?? ""} onChange={(e) => change({ body: e.target.value })} aria-label="Punkt dowodu" />
              </div>
            </>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Ekspert (zdjęcie)</Label>
              <NativeSelect value={cur.expertPhotoId ?? ""} onChange={(e) => change({ expertPhotoId: e.target.value || null })} aria-label="Zdjęcie eksperta">
                <option value="">{cur.expertPhotoKey ? `— brak (klucz „${cur.expertPhotoKey}”) —` : "— bez zdjęcia —"}</option>
                {data.photos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key}){p.consentConfirmed ? "" : " — brak zgody"}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Przybliżenie zdjęcia</Label>
              <input type="range" min={1} max={2.5} step={0.05} value={cur.edit?.zoom ?? 1} onChange={(e) => change({ edit: { zoom: Number(e.target.value) } })} className="w-full" aria-label="Przybliżenie" />
            </div>
            <div className="space-y-1">
              <Label>Przesunięcie poziome</Label>
              <input type="range" min={-0.5} max={0.5} step={0.02} value={cur.edit?.offsetX ?? 0} onChange={(e) => change({ edit: { offsetX: Number(e.target.value) } })} className="w-full" aria-label="Przesunięcie poziome" />
            </div>
            <div className="space-y-1">
              <Label>Przesunięcie pionowe</Label>
              <input type="range" min={-0.5} max={0.5} step={0.02} value={cur.edit?.offsetY ?? 0} onChange={(e) => change({ edit: { offsetY: Number(e.target.value) } })} className="w-full" aria-label="Przesunięcie pionowe" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!cur.edit?.photoHidden} onChange={(e) => change({ edit: { photoHidden: e.target.checked } })} className="h-4 w-4" /> Ukryj zdjęcie
            </label>
            {!clean ? (
              <label className="flex items-center gap-2" title="Grafika bez tekstu — materiał do automatycznego składania przez Google">
                <input type="checkbox" checked={!!cur.edit?.cleanPhoto} onChange={(e) => change({ edit: { cleanPhoto: e.target.checked } })} className="h-4 w-4" /> clean_photo (bez tekstu)
              </label>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Źródło twierdzenia (claim_source)</Label>
            <Input value={cur.claimSource ?? ""} onChange={(e) => change({ claimSource: e.target.value || null })} placeholder="np. CRM 2025, raport…" aria-label="Źródło twierdzenia" />
          </div>
          {cur.approvalRequired || cur.status === "blocked_until_verified" ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="approval">
              <span>{cur.approvedAt ? `Zatwierdzone przez ${cur.approvedBy ?? "?"}` : "Wymaga zatwierdzenia źródła / twierdzenia przed publikacją."}</span>
              <Button size="sm" variant="outline" onClick={() => void approve(!cur.approvedAt)} disabled={!data.canEdit}>
                {cur.approvedAt ? "Cofnij" : (
                  <>
                    <Check /> Zatwierdzam źródło
                  </>
                )}
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={!dirty || saving || !data.canEdit} data-testid="concept-save">
              Zapisz
            </Button>
            {dirty ? (
              <Button variant="ghost" onClick={() => setDraft(Object.fromEntries(rows.map((r) => [r.id, r])))}>
                Cofnij zmiany
              </Button>
            ) : null}
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Ocena — {FORMAT_LABEL[sizeOf(cur).key]} <span className="font-normal text-muted">(z pomiaru podglądu)</span>
          </p>
          {!clean ? <ScorePair a={scoreImageA(cur, ctx, measures[sel] ?? null, photoOf(cur))} b={scoreImageB(cur, ctx, measures[sel] ?? null, photoOf(cur))} seed={cur.scoreSeed} /> : <p className="text-xs text-muted">Czyste zdjęcie — bez oceny treści.</p>}
          <p className="text-sm font-medium">Walidacja (niezależna od oceny)</p>
          <GateList gate={gateImage(cur, ctx, measures[sel] ?? null, photoOf(cur))} />
          {cur.visualBrief ? <p className="text-xs text-muted">Kierunek artystyczny: {cur.visualBrief}</p> : null}
        </div>
      </div>
    </Card>
  );
}
