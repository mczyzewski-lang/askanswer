"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, Loader2, Package, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Card, Input, Label, NativeSelect, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { META_CTAS, META_FORMATS, META_LIMITS, metaChecks, metaCreative, metaStatus, metaVersions, webinarBadge, warsawToIso, isoToWarsaw, DEFAULT_WEBINAR_BADGE, eventDateLine, type MetaAdData, type MetaFormatKey } from "@/lib/adwords/meta";
import type { Measure } from "@/lib/adwords/score";
import { CreativeCanvas } from "./canvas";
import { BestPractices } from "./best-practices";
import type { AwData, Toast } from "./types";

type Ad = MetaAdData & { id: string; infographicUrls?: Partial<Record<MetaFormatKey, string | null>> };
const EMPTY = (data: AwData): MetaAdData => {
  const c = data.assets.find((a) => a.rowType === "image" && a.headline);
  return {
    name: "Nowa reklama",
    primaryText: "",
    metaHeadline: "",
    description: "",
    ctaButton: "LEARN_MORE",
    headline: c?.headline ?? "",
    ctaImage: "",
    destination: "website",
    url: data.campaigns.find((x) => x.landingUrl)?.landingUrl ?? c?.landingUrl ?? null,
    webinarTitle: null,
    webinarAt: null,
    layout: "typographic",
    body: null,
    withoutExpert: true,
    photoIds: data.photos.filter((p) => p.consentConfirmed).slice(0, 1).map((p) => p.id),
  };
};
const TONE = { gotowe: "bg-emerald-50 text-emerald-700", do_poprawy: "bg-amber-50 text-amber-800", blokada: "bg-red-50 text-red-700" } as const;

/** Meta (Facebook / Instagram): Ads Manager texts + banners in the PMax style, with / without the expert, to a website or a webinar */
export function MetaTab({ data, toast }: { data: AwData; toast: Toast }) {
  const base = `/api/admin/adwords/${data.project.id}/meta`;
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [edit, setEdit] = useState<(MetaAdData & { id?: string }) | null>(null);
  const [gen, setGen] = useState<Record<string, string>>({});
  // infographic jobs: reload every 5 s until the ad has its new pictures
  useEffect(() => {
    if (!Object.keys(gen).length) return;
    const t = setInterval(async () => {
      const list = await api<Ad[]>(base).catch(() => null);
      if (!list) return;
      setAds(list);
      setGen((g) => Object.fromEntries(Object.entries(g).filter(([id, before]) => JSON.stringify(list.find((x) => x.id === id)?.infographic ?? null) === before)));
    }, 5000);
    return () => clearInterval(t);
  }, [gen, base]);
  const load = useCallback(async () => setAds(await api<Ad[]>(base)), [base]);
  useEffect(() => {
    load().catch((e: Error) => toast(e.message, "err"));
  }, [load, toast]);
  const save = async (a: MetaAdData & { id?: string }) => {
    const json = { ...a, webinarAt: a.webinarAt ? new Date(a.webinarAt).toISOString() : null };
    try {
      if (a.id) await api(`${base}/${a.id}`, { method: "PATCH", json });
      else await api(base, { method: "POST", json });
      setEdit(null);
      await load();
      toast("Zapisano reklamę");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  if (!ads) return <p className="text-sm text-muted">Wczytuję…</p>;
  return (
    <div className="space-y-4" data-testid="meta">
      <BestPractices platform="meta" />
      <Card className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="max-w-3xl">
          <p className="font-medium">Reklamy Meta (Facebook / Instagram)</p>
          <p className="text-sm text-muted">Wpisz teksty — grafiki w stylu kreacji Google (złota ramka, duże hasło, wyraźne CTA) generują się w formatach Feed 1:1, Feed 4:5 i Stories/Reels 9:16, w wersji bez eksperta i z każdym wybranym zdjęciem. Reklama może prowadzić na stronę albo na webinar — wtedy data jest na grafice.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEdit(EMPTY(data))} disabled={!data.canEdit} data-testid="meta-new">
            <Plus /> Nowa reklama
          </Button>
          {ads.length ? (
            <a href={`${base}/zip?fmt=png`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-black/[.03]" data-testid="meta-zip">
              <Package className="h-4 w-4" /> Wszystkie (ZIP + teksty CSV)
            </a>
          ) : null}
        </div>
      </Card>
      {edit ? <MetaEditor key={edit.id ?? "new"} ad={edit} data={data} onCancel={() => setEdit(null)} onSave={save} /> : null}
      {!ads.length && !edit ? <Card className="p-6 text-sm text-muted">Brak reklam Meta — kliknij „Nowa reklama”.</Card> : null}
      {ads.map((a) =>
        edit?.id === a.id ? null : (
          <MetaCard
            key={a.id}
            ad={a}
            data={data}
            base={base}
            onEdit={() => setEdit(a)}
            generating={!!gen[a.id]}
            onInfographic={async () => {
              try {
                await api(`${base}/${a.id}`, { method: "POST" });
                setGen((g) => ({ ...g, [a.id]: JSON.stringify(a.infographic ?? null) }));
                toast("Generuję infografikę w 3 formatach — pojawi się jako wersja „Infografika AI” za 1–3 min");
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
            onCopy={() => setEdit({ ...a, id: undefined, name: `${a.name} (kopia)` })}
            onDelete={async () => {
              if (!confirm(`Usunąć reklamę „${a.name}”?`)) return;
              await api(`${base}/${a.id}`, { method: "DELETE" });
              await load();
            }}
          />
        ),
      )}
    </div>
  );
}

function photoOf(data: AwData, v: string, ad?: { infographicUrls?: Partial<Record<MetaFormatKey, string | null>> }, f?: MetaFormatKey) {
  if (v === "info") {
    const url = f ? ad?.infographicUrls?.[f] : null;
    return url ? { url, focalX: 0.5, focalY: 0.5 } : null;
  }
  const p = v === "none" ? null : data.photos.find((x) => x.id === v);
  return p ? { url: p.url, focalX: p.focalX, focalY: p.focalY } : null;
}
const versionLabel = (data: AwData, v: string) => (v === "none" ? "Bez eksperta" : v === "info" ? "Infografika AI" : (data.photos.find((p) => p.id === v)?.name ?? "zdjęcie"));

/** the versions × formats of one ad (the same drawing as the PNG) */
function Previews({ ad, data, base, onMeasure, small }: { ad: MetaAdData & { id?: string; infographicUrls?: Partial<Record<MetaFormatKey, string | null>> }; data: AwData; base?: string; onMeasure?: (k: string, m: Measure) => void; small?: boolean }) {
  return (
    <div className="space-y-3">
      {metaVersions(ad).map((v) => (
        <div key={v} className="space-y-1" data-testid="meta-version">
          <p className="text-xs font-medium text-muted">{versionLabel(data, v)}</p>
          <div className="flex items-end gap-2">
            {META_FORMATS.map((f) => (
              <figure key={f.key} className={cn(small ? (f.key === "story" ? "w-[18%]" : f.key === "feed" ? "w-[24%]" : "w-[30%]") : f.key === "story" ? "w-[22%]" : f.key === "feed" ? "w-[30%]" : "w-[37%]")}>
                <CreativeCanvas input={{ ...metaCreative(ad as MetaAdData, f.key as MetaFormatKey, v === "info" ? "info" : v !== "none" && !!photoOf(data, v)), theme: data.theme, logoUrl: data.logoUrl, photo: photoOf(data, v, ad, f.key as MetaFormatKey) }} className="w-full rounded border border-line" onMeasure={onMeasure ? (m) => onMeasure(`${v}|${f.key}`, m) : undefined} />
                <figcaption className="mt-0.5 flex justify-between text-[10px] text-muted">
                  <span>{f.label}</span>
                  {base && ad.id ? (
                    <a href={`${base}/${ad.id}/render?format=${f.key}&version=${v}&download=1`} className="underline" data-testid="meta-png">
                      PNG
                    </a>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetaCard({ ad, data, base, onEdit, onCopy, onDelete, onInfographic, generating }: { ad: Ad; data: AwData; base: string; onEdit: () => void; onCopy: () => void; onDelete: () => void; onInfographic: () => void; generating: boolean }) {
  const checks = metaChecks(ad, { photos: data.photos, lp: data.gateLp });
  const st = metaStatus(checks);
  return (
    <Card className="space-y-3 p-4" data-testid="meta-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{ad.name}</p>
          <p className="text-xs text-muted">
            {ad.destination === "webinar" ? `Webinar: ${ad.webinarTitle ?? ""} · ${eventDateLine(ad.webinarAt) ?? "bez daty"}` : "Strona"} · {ad.url ?? "brak URL"} · przycisk „{META_CTAS[ad.ctaButton] ?? ad.ctaButton}”
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[st])}>{st === "do_poprawy" ? "do poprawy" : st}</span>
          <a href={`${base}/zip?ads=${ad.id}`} className="text-xs underline" data-testid="meta-ad-zip">
            zestaw
          </a>
          <Button size="sm" variant="outline" onClick={onInfographic} disabled={!data.canEdit || generating} data-testid="meta-infographic" title="OpenAI rysuje infografikę w 3 formatach (jak w reelsach) — dodatkowa wersja reklamy">
            {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} {generating ? "Generuję…" : ad.infographic ? "Nowa infografika AI" : "Wersja z infografiką AI"}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} disabled={!data.canEdit} data-testid="meta-edit">
            Edytuj
          </Button>
          <Button size="iconSm" variant="ghost" aria-label="Kopia" onClick={onCopy} disabled={!data.canEdit}>
            <Copy />
          </Button>
          <Button size="iconSm" variant="ghost" aria-label={`Usuń ${ad.name}`} onClick={onDelete} disabled={!data.canEdit}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Previews ad={ad} data={data} base={base} small />
        <div className="space-y-2 text-sm">
          <p className="whitespace-pre-wrap rounded-lg bg-black/[.03] p-2 text-xs">{ad.primaryText || <span className="text-muted">— brak tekstu głównego —</span>}</p>
          <p className="text-xs">
            <b>{ad.metaHeadline || "—"}</b> · {ad.description || "—"}
          </p>
          <ul className="space-y-0.5 text-xs">
            {checks.map((c, i) => (
              <li key={i} className={c.level === "blokada" ? "text-red-700" : c.level === "do_poprawy" ? "text-amber-800" : "text-emerald-700"}>
                {c.level === "ok" ? "✓" : c.level === "blokada" ? "⛔" : "⚠"} {c.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Counter({ v, max }: { v: string; max: number }) {
  const n = [...(v ?? "")].length;
  return <span className={cn("text-[11px] tabular-nums", n > max ? "font-semibold text-amber-700" : "text-muted")}>{n}/{max}</span>;
}

function MetaEditor({ ad, data, onCancel, onSave }: { ad: MetaAdData & { id?: string }; data: AwData; onCancel: () => void; onSave: (a: MetaAdData & { id?: string }) => void }) {
  const [a, setA] = useState(ad);
  const [measures, setMeasures] = useState<Record<string, Measure>>({});
  const set = (p: Partial<MetaAdData>) => setA((x) => ({ ...x, ...p }));
  const checks = useMemo(() => {
    const c = metaChecks(a, { photos: data.photos, lp: data.gateLp }).filter((x) => x.level !== "ok");
    const over = Object.entries(measures).filter(([, m]) => m.overflow).map(([k]) => k);
    if (over.length) c.push({ level: "blokada", message: `Tekst nie mieści się w: ${over.map((k) => `${versionLabel(data, k.split("|")[0])} ${META_FORMATS.find((f) => f.key === k.split("|")[1])?.label}`).join(", ")} — skróć hasło lub CTA.` });
    return c;
  }, [a, measures, data]);
  const concepts = [...new Map(data.assets.filter((x) => x.rowType === "image" && x.headline).map((x) => [x.conceptId, x])).values()];
  return (
    <Card className="space-y-4 border-ink p-5" data-testid="meta-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{a.id ? `Edycja: ${ad.name}` : "Nowa reklama Meta"}</p>
        {concepts.length ? (
          <NativeSelect
            className="h-8 w-64 text-xs"
            value=""
            aria-label="Wypełnij z konceptu Google"
            onChange={(e) => {
              const c = concepts.find((x) => x.conceptId === e.target.value);
              if (c) set({ headline: c.headline ?? "", ctaImage: c.cta ?? "", url: c.landingUrl ?? a.url, name: a.name === "Nowa reklama" ? `Meta — ${c.conceptId}` : a.name });
            }}
          >
            <option value="">Wypełnij z konceptu Google…</option>
            {concepts.map((c) => (
              <option key={c.id} value={c.conceptId ?? ""}>
                {c.conceptId}: {c.headline}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nazwa reklamy</Label>
            <Input value={a.name} onChange={(e) => set({ name: e.target.value })} aria-label="Nazwa reklamy" />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <Label>Tekst główny (nad grafiką)</Label>
              <Counter v={a.primaryText} max={META_LIMITS.primaryText} />
            </div>
            <Textarea rows={4} value={a.primaryText} onChange={(e) => set({ primaryText: e.target.value })} aria-label="Tekst główny" placeholder="Pierwsze zdanie decyduje — Meta pokaże ok. 125 znaków, resztę po „Więcej”." />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex justify-between">
                <Label>Nagłówek (pod grafiką)</Label>
                <Counter v={a.metaHeadline} max={META_LIMITS.metaHeadline} />
              </div>
              <Input value={a.metaHeadline} onChange={(e) => set({ metaHeadline: e.target.value })} aria-label="Nagłówek Meta" />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <Label>Opis</Label>
                <Counter v={a.description} max={META_LIMITS.description} />
              </div>
              <Input value={a.description} onChange={(e) => set({ description: e.target.value })} aria-label="Opis Meta" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Hasło na grafice</Label>
              <Input value={a.headline} onChange={(e) => set({ headline: e.target.value })} aria-label="Hasło na grafice" data-testid="meta-headline" />
            </div>
            <div className="space-y-1">
              <Label>CTA na grafice</Label>
              <Input value={a.ctaImage} onChange={(e) => set({ ctaImage: e.target.value })} placeholder={META_CTAS[a.ctaButton]} aria-label="CTA na grafice" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Przycisk w Ads Managerze</Label>
            <NativeSelect value={a.ctaButton} onChange={(e) => set({ ctaButton: e.target.value })} aria-label="Przycisk CTA">
              {Object.entries(META_CTAS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l} ({k})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2 rounded-lg border border-line p-3">
            <div className="flex gap-4 text-sm">
              {(["website", "webinar"] as const).map((d) => (
                <label key={d} className="flex items-center gap-1.5">
                  <input type="radio" name="dest" checked={a.destination === d} onChange={() => set({ destination: d, ...(d === "webinar" && a.ctaButton === "LEARN_MORE" ? { ctaButton: "SIGN_UP" } : {}), ...(d === "webinar" && !a.badgeText ? { badgeText: DEFAULT_WEBINAR_BADGE } : {}) })} aria-label={d === "website" ? "Cel: strona" : "Cel: webinar"} />
                  {d === "website" ? "Strona" : "Webinar"}
                </label>
              ))}
            </div>
            <div className="space-y-1">
              <Label>{a.destination === "webinar" ? "Adres strony webinaru (zapisy)" : "Adres strony"}</Label>
              <Input value={a.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" aria-label="Adres docelowy" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {a.destination === "webinar" ? (
                <div className="space-y-1">
                  <Label>Tytuł webinaru</Label>
                  <Input value={a.webinarTitle ?? ""} onChange={(e) => set({ webinarTitle: e.target.value })} aria-label="Tytuł webinaru" />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label>{a.destination === "webinar" ? "Data i godzina (czas polski)" : "Data wydarzenia (opcjonalnie, czas polski)"}</Label>
                <Input type="datetime-local" value={isoToWarsaw(a.webinarAt)} onChange={(e) => set({ webinarAt: e.target.value ? warsawToIso(e.target.value) : null })} aria-label="Data webinaru" />
              </div>
              <div className="space-y-1">
                <Label>Plakietka na górze grafiki (opcjonalnie)</Label>
                <Input value={a.badgeText ?? ""} onChange={(e) => set({ badgeText: e.target.value })} placeholder={DEFAULT_WEBINAR_BADGE} aria-label="Plakietka na górze" />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={a.showDate !== false} onChange={(e) => set({ showDate: e.target.checked })} aria-label="Pokaż datę na grafice" /> Pokaż dzień i datę na grafice
              </label>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-line p-3">
            <p className="text-sm font-medium">Ekspert</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={a.withoutExpert} onChange={(e) => set({ withoutExpert: e.target.checked })} /> Wersja bez eksperta
            </label>
            {data.photos.length ? (
              <div className="flex flex-wrap gap-2">
                {data.photos.map((p) => {
                  const on = a.photoIds.includes(p.id);
                  return (
                    <label key={p.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-xs", on ? "border-ink bg-white" : "border-line text-muted")}>
                      <input type="checkbox" className="h-3.5 w-3.5" checked={on} onChange={(e) => set({ photoIds: e.target.checked ? [...a.photoIds, p.id] : a.photoIds.filter((x) => x !== p.id) })} aria-label={`Ekspert ${p.key}`} />
                      {p.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.url} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : null}
                      {p.name}
                      {p.consentConfirmed ? "" : " (brak zgody)"}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted">Brak zdjęć — dodaj je w zakładce „Zdjęcia ekspertów”.</p>
            )}
            {a.withoutExpert || !a.photoIds.length ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Układ wersji bez eksperta</Label>
                  <NativeSelect value={a.layout} onChange={(e) => set({ layout: e.target.value })} aria-label="Układ Meta">
                    <option value="typographic">Typograficzny</option>
                    <option value="process_steps">Kroki</option>
                    <option value="comparison">Porównanie (A vs B)</option>
                  </NativeSelect>
                </div>
                {a.layout === "comparison" ? (
                  <div className="col-span-2 grid grid-cols-2 gap-2" data-testid="meta-comparison">
                    {(
                      [
                        ["comparison_left_label", "Lewa — etykieta", "Tradycyjnie"],
                        ["comparison_right_label", "Prawa — etykieta", "Z planem"],
                        ["comparison_left", "Lewa — treść", "Najpierw pozew, potem spór"],
                        ["comparison_right", "Prawa — treść", "Najpierw plan, potem pozew"],
                      ] as const
                    ).map(([k, l, ph]) => (
                      <div key={k} className="space-y-1">
                        <Label>{l}</Label>
                        <Input value={a.extra?.[k] ?? ""} placeholder={ph} onChange={(e) => set({ extra: { ...(a.extra ?? {}), [k]: e.target.value } })} aria-label={`Meta ${l}`} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {a.layout === "process_steps" ? (
                  <div className="space-y-1">
                    <Label>Kroki (rozdziel |)</Label>
                    <Input value={a.body ?? ""} onChange={(e) => set({ body: e.target.value })} aria-label="Kroki Meta" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {checks.length ? (
            <ul className="space-y-0.5 text-xs" data-testid="meta-checks">
              {checks.map((c, i) => (
                <li key={i} className={c.level === "blokada" ? "text-red-700" : "text-amber-800"}>
                  {c.level === "blokada" ? "⛔" : "⚠"} {c.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-emerald-700">✓ Gotowe do Ads Managera.</p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => onSave(a)} disabled={!a.name.trim()} data-testid="meta-save">
              Zapisz
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Anuluj
            </Button>
          </div>
        </div>
        <Previews ad={a} data={data} onMeasure={(k, m) => setMeasures((x) => (x[k]?.overflow === m.overflow ? x : { ...x, [k]: m }))} />
      </div>
      <p className="flex items-center gap-1 text-xs text-muted">
        <Download className="h-3 w-3" /> Po zapisaniu: PNG każdego formatu, zestaw reklamy (ZIP) i teksty do Ads Managera (CSV). Format 9:16 trzyma tekst poza strefami interfejsu Reels (góra 14%, dół 35%).
      </p>
    </Card>
  );
}
