"use client";
import { useState } from "react";
import { Check, Copy, Link2, Plus, ShieldOff } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Label, NativeSelect } from "@/components/ui";
import { api, formatDate, plural } from "@/lib/utils";
import type { PanelProps } from "./project-view";

export function InvitationsPanel({ data, refresh, toast }: PanelProps) {
  const [expertId, setExpertId] = useState(data.experts[0]?.id ?? "");
  const [ttl, setTtl] = useState("30");
  const [copied, setCopied] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const byExpert = data.experts
    .map((e) => {
      const qs = data.questions.filter((q) => q.expertId === e.id);
      return { expert: e, total: qs.length, recorded: qs.filter((q) => q.takes.length > 0).length, links: data.invitations.filter((i) => i.expertId === e.id) };
    })
    .filter((x) => x.total > 0 || x.links.length > 0);

  const copy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(id);
    toast("Skopiowano link");
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {byExpert.length === 0 ? (
          <EmptyState icon={<Link2 className="h-8 w-8" />} title="Brak przypisanych ekspertów">
            Przypisz pytania do eksperta i wygeneruj dla niego bezpieczny link do nagrywania.
          </EmptyState>
        ) : (
          byExpert.map(({ expert, total, recorded, links }) => (
            <Card key={expert.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{expert.name}</p>
                  <p className="text-xs text-muted">
                    {expert.title ?? expert.email ?? ""} · {recorded}/{total} {plural(total, "pytanie nagrane", "pytania nagrane", "pytań nagranych")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const r = await api<{ url: string; id: string }>(`/api/admin/projects/${data.project.id}/invitations`, { method: "POST", json: { expertId: expert.id, ttlDays: Number(ttl) } });
                      await copy(r.url, r.id);
                      refresh();
                    } catch (err) {
                      toast((err as Error).message, "err");
                    }
                  }}
                >
                  <Plus /> Nowy link
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {links.length === 0 ? <p className="text-sm text-muted">Brak linków.</p> : null}
                {links.map((l) => {
                  const active = !l.revoked && !l.expired;
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[.025] p-2.5">
                      <code className="min-w-0 flex-1 truncate text-xs text-ink/80">{l.url ?? "(link nieczytelny — zmieniono APP_SECRET)"}</code>
                      {l.revoked ? <Badge tone="red">unieważniony</Badge> : l.expired ? <Badge tone="amber">wygasł</Badge> : <Badge tone="green">aktywny do {formatDate(l.expiresAt)}</Badge>}
                      {l.consentAt ? <Badge tone="gray">zgoda {formatDate(l.consentAt)}</Badge> : null}
                      {active && l.url ? (
                        <Button size="sm" onClick={() => copy(l.url!, l.id)}>
                          {copied === l.id ? <Check /> : <Copy />} Kopiuj link
                        </Button>
                      ) : null}
                      {active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm("Unieważnić ten link? Ekspert straci dostęp.")) return;
                            await api(`/api/admin/invitations/${l.id}`, { method: "DELETE" });
                            toast("Link unieważniony");
                            refresh();
                          }}
                        >
                          <ShieldOff /> Unieważnij
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))
        )}
      </div>
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <p className="font-medium">Wygeneruj link nagraniowy</p>
          <p className="text-xs text-muted">Ekspert nie zakłada konta — link otwiera tylko przypisane mu pytania. Linki wygasają i można je unieważnić.</p>
          <div className="space-y-1.5">
            <Label htmlFor="inv-exp">Ekspert</Label>
            <NativeSelect id="inv-exp" value={expertId} onChange={(e) => setExpertId(e.target.value)}>
              {data.experts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-ttl">Ważność</Label>
            <NativeSelect id="inv-ttl" value={ttl} onChange={(e) => setTtl(e.target.value)}>
              <option value="7">7 dni</option>
              <option value="14">14 dni</option>
              <option value="30">30 dni</option>
              <option value="90">90 dni</option>
            </NativeSelect>
          </div>
          <Button
            className="w-full"
            disabled={!expertId}
            onClick={async () => {
              try {
                const r = await api<{ url: string; id: string }>(`/api/admin/projects/${data.project.id}/invitations`, { method: "POST", json: { expertId, ttlDays: Number(ttl) } });
                await copy(r.url, r.id);
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            <Link2 /> Utwórz i kopiuj link
          </Button>
        </Card>
        <Card className="space-y-3 p-4">
          <p className="font-medium">Szybko dodaj eksperta</p>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/api/admin/experts", { method: "POST", json: { name: newName } });
                setNewName("");
                toast("Dodano eksperta");
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            <Input placeholder="Imię i nazwisko" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Imię i nazwisko eksperta" />
            <Button type="submit" variant="subtle" disabled={newName.trim().length < 2}>
              Dodaj
            </Button>
          </form>
          <p className="text-xs text-muted">Następnie przypisz mu pytania w zakładce „Pytania i nagrania”.</p>
        </Card>
      </div>
    </div>
  );
}
