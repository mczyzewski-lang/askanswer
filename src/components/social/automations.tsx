"use client";
import * as React from "react";
import { MessageSquareReply, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Input, NativeSelect, Switch, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { fillReply } from "@/lib/social/automation";
import { LEAD_MAGNET_PRESETS, type LeadMagnet } from "@/lib/lead-magnets";
import { useSocial } from "./shell";
import { Empty, Field, Loading, Panel, Pill, PlatformIcon, When, useApi } from "./ui";

interface Automation {
  id: string;
  keyword: string;
  publicReply: string;
  dmReply: string;
  platforms: Platform[];
  enabled: boolean;
  sentCount: number;
  lastSentAt: string | null;
}
type Draft = Omit<Automation, "id" | "sentCount" | "lastSentAt">;
const EMPTY: Draft = { keyword: "", publicReply: "", dmReply: "", platforms: [], enabled: true };

const withLink = (website: string, url?: string | null) => {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  const base = website.trim().replace(/\/+$/, "");
  return base ? `${/^https?:\/\//.test(base) ? base : `https://${base}`}${url.startsWith("/") ? url : `/${url}`}` : url;
};

/** A ready automation from a lead magnet: public reply with the link, and the same as an Instagram DM. */
function fromMagnet(m: LeadMagnet, website: string): Draft {
  const link = withLink(website, m.url);
  return {
    keyword: m.keyword,
    publicReply: `{imię}, dziękuję! Tu znajdziesz „${m.name}”: ${link}`,
    dmReply: `Cześć {imię}! Obiecany materiał „${m.name}” – bezpłatnie tutaj: ${link}`,
    platforms: [],
    enabled: true,
  };
}

/**
 * "Skomentuj PLAN, a wyślę Ci link": a comment with the keyword gets the ready reply automatically —
 * under the comment and/or (Instagram) as a private message. The texts are written here by a person.
 */
export function Automations({ projectId, tz }: { projectId: string; tz: string }) {
  const { toast } = useSocial();
  const { data, reload } = useApi<{ automations: Automation[]; canEdit: boolean; website: string }>(`/api/social/projects/${projectId}/automations`);
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  if (!data) return <Loading />;
  const ro = !data.canEdit;
  const magnets = LEAD_MAGNET_PRESETS.flatMap((p) => p.items.map((m) => ({ preset: p.name, m })));

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await api(`/api/social/automations/${editing.id}`, { method: "PATCH", json: editing.draft });
      else await api(`/api/social/projects/${projectId}/automations`, { method: "POST", json: editing.draft });
      toast(`Zapisano automatyzację „${editing.draft.keyword}”`);
      setEditing(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const patch = async (a: Automation, p: Partial<Draft>) => {
    try {
      await api(`/api/social/automations/${a.id}`, { method: "PATCH", json: p });
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const remove = async (a: Automation) => {
    if (!confirm(`Usunąć automatyzację „${a.keyword}”?`)) return;
    try {
      await api(`/api/social/automations/${a.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]" data-testid="automations">
      <div className="space-y-4">
        <Panel
          title="Automatyczne odpowiedzi na słowo w komentarzu"
          actions={
            ro ? null : (
              <Button size="sm" onClick={() => setEditing({ id: null, draft: EMPTY })} data-testid="automation-new">
                <Plus /> Nowa automatyzacja
              </Button>
            )
          }
        >
          {data.automations.length ? (
            <ul className="divide-y divide-line">
              {data.automations.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 py-3" data-testid="automation-row">
                  <Switch checked={a.enabled} onCheckedChange={(v) => !ro && void patch(a, { enabled: v })} />
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-xs font-semibold text-white">{a.keyword}</span>
                      {a.platforms.length ? a.platforms.map((p) => <PlatformIcon key={p} platform={p} />) : <span className="text-xs text-muted">wszystkie platformy</span>}
                      <span className="text-xs text-muted">
                        wysłano {a.sentCount}
                        {a.lastSentAt ? (
                          <>
                            {" "}
                            · ostatnio <When at={a.lastSentAt} tz={tz} />
                          </>
                        ) : null}
                      </span>
                    </p>
                    {a.publicReply ? <p className="text-muted"><b className="font-medium text-ink">Pod komentarzem:</b> {a.publicReply}</p> : null}
                    {a.dmReply ? <p className="text-muted"><b className="font-medium text-ink">DM (Instagram):</b> {a.dmReply}</p> : null}
                  </div>
                  {ro ? null : (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Edytuj ${a.keyword}`} onClick={() => setEditing({ id: a.id, draft: { keyword: a.keyword, publicReply: a.publicReply, dmReply: a.dmReply, platforms: a.platforms, enabled: a.enabled } })}>
                        <Pencil />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Usuń ${a.keyword}`} onClick={() => void remove(a)}>
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<MessageSquareReply />} title="Brak automatyzacji">
              Np. CTA w rolce „Skomentuj PLAN” → każdy, kto skomentuje „PLAN”, dostaje od razu odpowiedź z linkiem do materiału.
            </Empty>
          )}
        </Panel>

        {editing ? (
          <Panel title={editing.id ? `Edycja: ${editing.draft.keyword}` : "Nowa automatyzacja"} data-testid="automation-form">
            <div className="space-y-4">
              {magnets.length ? (
                <Field label="Szybki start z lead magnetu" hint={data.website ? `Link: ${data.website} + adres materiału.` : "Uzupełnij „Strona internetowa” w Ustawieniach marki, żeby link był pełny."}>
                  <NativeSelect
                    value=""
                    aria-label="Lead magnet"
                    onChange={(e) => {
                      const hit = magnets[Number(e.target.value)];
                      if (hit) setEditing({ ...editing, draft: fromMagnet(hit.m, data.website) });
                    }}
                  >
                    <option value="">Wybierz materiał…</option>
                    {magnets.map((x, i) => (
                      <option key={`${x.preset}-${x.m.keyword}`} value={i}>
                        {x.m.keyword} — {x.m.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              <Field label="Słowo w komentarzu" hint="Wielkość liter i polskie znaki bez znaczenia: „PLAN”, „plan!”, „Plan 🙏” — tak; „planuję” — nie.">
                <Input value={editing.draft.keyword} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, keyword: e.target.value } })} placeholder="PLAN" aria-label="Słowo w komentarzu" />
              </Field>
              <Field label="Odpowiedź pod komentarzem" hint="Publiczna. Może zawierać link. {imię} wstawia imię autora." counter={{ n: editing.draft.publicReply.length, max: 1000 }}>
                <Textarea rows={3} value={editing.draft.publicReply} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, publicReply: e.target.value } })} aria-label="Odpowiedź pod komentarzem" />
              </Field>
              <Field label="Wiadomość prywatna (Instagram)" hint="Wysyłana jako odpowiedź prywatna (DM) do autora komentarza — tylko na Instagramie. Na innych platformach idzie tylko odpowiedź pod komentarzem." counter={{ n: editing.draft.dmReply.length, max: 1000 }}>
                <Textarea rows={3} value={editing.draft.dmReply} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, dmReply: e.target.value } })} aria-label="Wiadomość prywatna" />
              </Field>
              <Field label="Platformy" hint="Bez zaznaczenia — wszystkie konta projektu.">
                <span className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => {
                    const on = editing.draft.platforms.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setEditing({ ...editing, draft: { ...editing.draft, platforms: on ? editing.draft.platforms.filter((x) => x !== p) : [...editing.draft.platforms, p] } })}
                        className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs", on ? "border-ink bg-ink/[.04]" : "border-line")}
                      >
                        <PlatformIcon platform={p} /> {PLATFORM_META[p].name}
                      </button>
                    );
                  })}
                </span>
              </Field>
              {/(^|\s)\/[\p{L}\d]/u.test(`${editing.draft.publicReply} ${editing.draft.dmReply}`) ? (
                <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">Link bez domeny (np. „/wiedza/…”) nie zadziała w komentarzu — uzupełnij „Strona internetowa” w Ustawieniach marki i wybierz materiał ponownie albo wpisz pełny adres https://…</p>
              ) : null}
              {editing.draft.publicReply || editing.draft.dmReply ? (
                <div className="rounded-xl bg-black/[.03] p-3 text-sm" data-testid="automation-preview">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Podgląd — komentarz „{editing.draft.keyword || "SŁOWO"} 🙏” od Anny</p>
                  {editing.draft.publicReply ? <p>↳ {fillReply(editing.draft.publicReply, "Anna")}</p> : null}
                  {editing.draft.dmReply ? <p className="mt-1 text-muted">✉ {fillReply(editing.draft.dmReply, "Anna")}</p> : null}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Anuluj
                </Button>
                <Button onClick={() => void save()} disabled={editing.draft.keyword.trim().length < 2 || (!editing.draft.publicReply.trim() && !editing.draft.dmReply.trim())} data-testid="automation-save">
                  Zapisz
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}
      </div>
      <Panel title="Jak to działa">
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted">
          <li>Nowy komentarz ze słowem dostaje gotową odpowiedź od razu po pobraniu komentarzy (bez AI, tekst piszesz Ty).</li>
          <li>Tylko krótkie komentarze (do 10 słów). Dłuższy, nawet ze słowem, trafia do skrzynki dla człowieka — może zawierać coś wrażliwego.</li>
          <li>Ta sama osoba dostaje odpowiedź na to samo słowo raz na dobę. Limit: 60 automatycznych odpowiedzi na godzinę w projekcie.</li>
          <li>Nigdy na komentarze Twojego konta ani na komentarze, które mają już odpowiedź.</li>
          <li>Wysłane odpowiedzi widać w skrzynce komentarzy (oznaczenie „automatyzacja”). W trybie DEMO nic nie trafia na prawdziwe konta.</li>
          <li>
            Instagram: wiadomość prywatna to „odpowiedź prywatna” na komentarz przez Upload-Post — wymaga uprawnień do wiadomości na koncie. <Pill tone="amber">do sprawdzenia na koncie testowym</Pill>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
