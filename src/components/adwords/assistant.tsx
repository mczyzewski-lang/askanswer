"use client";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button, Card, Input, Label, NativeSelect, Textarea } from "@/components/ui";
import { api } from "@/lib/utils";
import { PMAX_SPEC } from "@/lib/adwords/spec";
import { LAYOUTS, type LayoutKey } from "@/lib/adwords/draw";
import { CreativeCanvas, SceneCanvas } from "./canvas";
import type { AwData, Toast } from "./types";
import { ProposalsPanel } from "./proposals";

interface Draft {
  kind: "image" | "video";
  conceptId: string;
  rationale: string;
  image?: { layout: "typographic" | "expert_split" | "process_steps"; headline: string; subheadline: string; body: string; cta: string; visualBrief: string; useExpertPhoto: boolean };
  video?: { durationSec: number; scenes: Array<{ startS: number; endS: number; spokenText: string; screenText: string; visualBrief: string }> };
  headlineForAds?: string | null;
  engine: "openai" | "template";
  warning?: string | null;
}

/** Describe the image or video you want — the AI drafts it in the brand; edit, then add it to the set. */
export function AssistantTab({ data, reload, toast, onAdded }: { data: AwData; reload: () => Promise<void>; toast: Toast; onAdded: (kind: "image" | "video") => void }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photoId, setPhotoId] = useState(data.photos.find((p) => p.consentConfirmed)?.id ?? "");
  const [campaign, setCampaign] = useState(data.campaigns[0]?.code ?? "");
  const [addHeadline, setAddHeadline] = useState(true);
  const base = `/api/admin/adwords/${data.project.id}`;
  const ask = async () => {
    setBusy(true);
    try {
      setDraft(await api<Draft>(`${base}/assistant`, { method: "POST", json: { prompt, kind } }));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft) return;
    try {
      const group = data.assets.find((a) => a.campaignCode === campaign && a.assetGroup)?.assetGroup ?? null;
      await api(`${base}/assistant`, { method: "PUT", json: { draft, campaignCode: campaign || null, assetGroup: group, expertPhotoId: photoId || null, headlineForAds: addHeadline } });
      toast(`Dodano koncept ${draft.conceptId}`);
      setDraft(null);
      setPrompt("");
      await reload();
      onAdded(draft.kind);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const photo = data.photos.find((p) => p.id === photoId);
  const im = draft?.image;
  const setIm = (p: Partial<NonNullable<Draft["image"]>>) => setDraft((d) => (d && d.image ? { ...d, image: { ...d.image, ...p } } : d));
  return (
    <div className="space-y-4" data-testid="assistant">
      <ProposalsPanel data={data} reload={reload} toast={toast} />
      <Card className="space-y-3 p-5">
        <p className="font-medium">Asystent kreacji</p>
        <p className="text-sm text-muted">Napisz, jaką kreację chcesz dodać i z jaką treścią — AI przygotuje koncept w motywie projektu (grafika w 3 formatach albo scenariusz wideo do nagrania), z zasadami PMax i redakcyjnymi. Nic się nie zapisze, dopóki nie zaakceptujesz.</p>
        <div className="flex flex-wrap gap-2">
          <NativeSelect className="h-9 w-48" value={kind} onChange={(e) => setKind(e.target.value as "image" | "video")} aria-label="Rodzaj kreacji">
            <option value="image">Grafika (3 formaty)</option>
            <option value="video">Wideo — scenariusz do nagrania</option>
          </NativeSelect>
        </div>
        <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === "image" ? "np. Grafika z mediatorem: hasło o tym, że najpierw ustalamy plan, a dopiero potem składamy pozew; spokojne, ciepłe kolory, CTA do konsultacji" : "np. 25-sekundowy film: ekspert odpowiada na pytanie „czy rozwód musi być wojną?”, potem 3 kroki planu i CTA"} aria-label="Opis kreacji" data-testid="assistant-prompt" />
        <Button onClick={() => void ask()} disabled={busy || prompt.trim().length < 5 || !data.canEdit} data-testid="assistant-ask">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Przygotuj propozycję
        </Button>
      </Card>
      {draft ? (
        <Card className="space-y-4 p-5" data-testid="assistant-draft">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              Propozycja: koncept <Input className="ml-1 inline-flex h-8 w-24" value={draft.conceptId} onChange={(e) => setDraft({ ...draft, conceptId: e.target.value })} aria-label="Kod konceptu" />
            </p>
            <p className="text-xs text-muted">{draft.engine === "openai" ? "AI (OpenAI)" : "szkic bez AI"}</p>
          </div>
          {draft.warning ? <p className="text-sm text-amber-800">{draft.warning}</p> : null}
          {draft.rationale ? <p className="text-sm text-muted">{draft.rationale}</p> : null}
          {im ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Układ</Label>
                    <NativeSelect value={im.layout} onChange={(e) => setIm({ layout: e.target.value as LayoutKey as "typographic" })} aria-label="Układ propozycji">
                      {Object.entries(LAYOUTS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label>CTA</Label>
                    <Input value={im.cta} onChange={(e) => setIm({ cta: e.target.value })} aria-label="CTA propozycji" />
                  </div>
                </div>
                <Label>Hasło</Label>
                <Input value={im.headline} onChange={(e) => setIm({ headline: e.target.value })} aria-label="Hasło propozycji" />
                <Label>Podtytuł</Label>
                <Input value={im.subheadline} onChange={(e) => setIm({ subheadline: e.target.value })} aria-label="Podtytuł propozycji" />
                <Label>{im.layout === "process_steps" ? "Kroki (rozdziel |)" : "Punkt dowodu"}</Label>
                <Input value={im.body} onChange={(e) => setIm({ body: e.target.value })} aria-label="Dowód propozycji" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={im.useExpertPhoto} onChange={(e) => setIm({ useExpertPhoto: e.target.checked, layout: e.target.checked ? "expert_split" : im.layout === "expert_split" ? "typographic" : im.layout })} className="h-4 w-4" /> Ze zdjęciem eksperta
                </label>
                {im.useExpertPhoto ? (
                  <NativeSelect value={photoId} onChange={(e) => setPhotoId(e.target.value)} aria-label="Zdjęcie do propozycji">
                    <option value="">— wybierz —</option>
                    {data.photos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.consentConfirmed ? "" : " (brak zgody)"}
                      </option>
                    ))}
                  </NativeSelect>
                ) : null}
                <p className="text-xs text-muted">Kierunek: {im.visualBrief}</p>
              </div>
              <div className="flex items-end gap-2">
                {PMAX_SPEC.images.formats.map((f) => (
                  <CreativeCanvas
                    key={f.key}
                    className={f.key === "landscape" ? "w-[46%] rounded border border-line" : f.key === "square" ? "w-[26%] rounded border border-line" : "w-[22%] rounded border border-line"}
                    input={{ width: f.width, height: f.height, layout: im.useExpertPhoto && photo ? "expert_split" : im.layout === "expert_split" ? "typographic" : im.layout, copy: { headline: im.headline, subheadline: im.subheadline, body: im.body, cta: im.cta }, theme: data.theme, logoUrl: data.logoUrl, photo: im.useExpertPhoto && photo ? { url: photo.url, focalX: photo.focalX, focalY: photo.focalY } : null }}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {draft.video ? (
            <div className="space-y-2">
              {draft.video.scenes.map((s, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-line p-2 md:grid-cols-[80px_1fr_1fr_1fr_90px]">
                  <span className="text-xs font-medium">
                    {s.startS}–{s.endS} s
                  </span>
                  <Textarea rows={2} className="text-xs" value={s.spokenText} aria-label={`Słowa sceny ${i + 1}`} onChange={(e) => setDraft({ ...draft, video: { ...draft.video!, scenes: draft.video!.scenes.map((x, j) => (j === i ? { ...x, spokenText: e.target.value } : x)) } })} />
                  <Textarea rows={2} className="text-xs" value={s.screenText} aria-label={`Napis sceny ${i + 1}`} onChange={(e) => setDraft({ ...draft, video: { ...draft.video!, scenes: draft.video!.scenes.map((x, j) => (j === i ? { ...x, screenText: e.target.value } : x)) } })} />
                  <Textarea rows={2} className="text-xs" value={s.visualBrief} aria-label={`Kadr sceny ${i + 1}`} onChange={(e) => setDraft({ ...draft, video: { ...draft.video!, scenes: draft.video!.scenes.map((x, j) => (j === i ? { ...x, visualBrief: e.target.value } : x)) } })} />
                  <SceneCanvas className="w-full rounded border border-line" input={{ width: 270, height: 480, theme: data.theme, screenText: s.screenText || s.spokenText, visualBrief: s.visualBrief, sceneLabel: `Scena ${i + 1}`, logoUrl: data.logoUrl, photo: null, isCta: i === draft.video!.scenes.length - 1 }} />
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <NativeSelect className="h-9 w-56" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Kampania propozycji">
              <option value="">— bez kampanii —</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {draft.headlineForAds ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={addHeadline} onChange={(e) => setAddHeadline(e.target.checked)} className="h-4 w-4" /> Dodaj też nagłówek „{draft.headlineForAds}”
              </label>
            ) : null}
            <Button onClick={() => void save()} disabled={!data.canEdit} data-testid="assistant-save">
              Dodaj do zestawu
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Odrzuć
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
