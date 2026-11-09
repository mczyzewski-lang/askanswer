"use client";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTrigger, Input, Label, NativeSelect } from "@/components/ui";
import { api } from "@/lib/utils";
import type { Toast } from "./types";

interface Share {
  id: string;
  token: string;
  label: string;
  createdBy: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  createdAt: string;
}
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("pl-PL") : "—");

/** read-only links for an agency: preview + download of what passed the gates, no login */
export function ShareButton({ projectId, canEdit, toast }: { projectId: string; canEdit: boolean; toast: Toast }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Share[]>([]);
  const [label, setLabel] = useState("Agencja");
  const [days, setDays] = useState("30");
  const [copied, setCopied] = useState<string | null>(null);
  const base = `/api/admin/adwords/${projectId}/shares`;
  const load = () => api<Share[]>(base).then(setList).catch((e: Error) => toast(e.message, "err"));
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const url = (s: Share) => `${window.location.origin}/share/adwords/${s.token}`;
  const copy = (s: Share) =>
    void navigator.clipboard.writeText(url(s)).then(() => {
      setCopied(s.id);
      setTimeout(() => setCopied(null), 1500);
    });
  const live = (s: Share) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt) > new Date());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="share-open">
          <Share2 /> Udostępnij agencji
        </Button>
      </DialogTrigger>
      <DialogContent title="Link dla agencji" description="Podgląd bez logowania i bez edycji: grafiki, teksty, scenariusze wideo, treść landing page i brief. Agencja pobiera tylko komponenty, które przeszły kontrolę (bez blokad).">
        <div className="space-y-4">
          {canEdit ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const s = await api<Share>(base, { method: "POST", json: { label, days: days === "0" ? null : Number(days) } });
                  await load();
                  copy(s);
                  toast("Utworzono link i skopiowano go do schowka");
                } catch (err) {
                  toast((err as Error).message, "err");
                }
              }}
            >
              <div className="min-w-40 flex-1 space-y-1">
                <Label htmlFor="share-label">Dla kogo</Label>
                <Input id="share-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="np. Agencja XYZ" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="share-days">Ważny</Label>
                <NativeSelect id="share-days" className="h-9 w-32" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">7 dni</option>
                  <option value="30">30 dni</option>
                  <option value="90">90 dni</option>
                  <option value="0">bez terminu</option>
                </NativeSelect>
              </div>
              <Button type="submit" disabled={!label.trim()} data-testid="share-create">
                Utwórz link
              </Button>
            </form>
          ) : null}
          <ul className="space-y-2" data-testid="share-list">
            {list.length === 0 ? <li className="text-sm text-muted">Brak linków.</li> : null}
            {list.map((s) => (
              <li key={s.id} className="space-y-1 rounded-lg border border-line p-3 text-sm" data-testid="share-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.label}</span>
                  <span className={live(s) ? "text-xs text-emerald-700" : "text-xs text-muted"}>{s.revokedAt ? `odwołany ${fmt(s.revokedAt)}` : s.expiresAt && new Date(s.expiresAt) <= new Date() ? "wygasł" : `aktywny${s.expiresAt ? ` do ${fmt(s.expiresAt)}` : ""}`}</span>
                </div>
                <p className="text-xs text-muted">
                  Utworzył {s.createdBy ?? "—"} {fmt(s.createdAt)} · otwarcia: {s.accessCount}
                  {s.lastAccessAt ? ` (ostatnio ${new Date(s.lastAccessAt).toLocaleString("pl-PL")})` : ""}
                </p>
                {live(s) ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => copy(s)}>
                      {copied === s.id ? <Check /> : <Copy />} {copied === s.id ? "Skopiowano" : "Kopiuj link"}
                    </Button>
                    <a href={`/share/adwords/${s.token}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted hover:text-ink">
                      <ExternalLink className="h-3.5 w-3.5" /> Otwórz podgląd
                    </a>
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-red-700"
                        onClick={async () => {
                          if (!confirm(`Odwołać link „${s.label}”? Przestanie działać od razu.`)) return;
                          await api(`${base}/${s.id}`, { method: "DELETE" });
                          await load();
                        }}
                        data-testid="share-revoke"
                      >
                        Odwołaj
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
