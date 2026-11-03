"use client";
import { useRef, useState } from "react";
import { Play, Plus, Scissors, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, Input, Label } from "@/components/ui";
import { api, cn } from "@/lib/utils";

export interface Fragment {
  id: string;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
}

const sec = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Cut pieces out of one B-roll video into the campaign's basket: play, mark the start and the end,
 * add — or cut the whole video at a fixed rhythm. Reels draw their cutaways from the basket at random.
 */
export function FragmentEditor({ projectId, item, fragments, onClose, reload, toast }: { projectId: string; item: { id: string; name: string; url: string; proxyUrl?: string | null; durationSec: number | null }; fragments: Fragment[]; onClose: () => void; reload: () => Promise<void>; toast: (t: string, tone?: "ok" | "err") => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(2.5);
  const [every, setEvery] = useState("4");
  const [length, setLength] = useState("2.5");
  const [busy, setBusy] = useState(false);
  const dur = item.durationSec ?? 0;
  const mine = fragments.filter((f) => f.assetId === item.id).sort((a, b) => a.sourceIn - b.sourceIn);

  const add = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await api<{ added: number }>(`/api/admin/ads/${projectId}/broll/fragments`, { method: "POST", json: { assetId: item.id, ...body } });
      toast(`Dodano do koszyka: ${r.added} ${r.added === 1 ? "fragment" : "fragmentów"}`);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const play = (f: Fragment) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = f.sourceIn;
    stopAt.current = f.sourceOut;
    void v.play().catch(() => {});
  };
  const valid = to - from >= 0.5;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Fragmenty: ${item.name}`} description="Wycięte fragmenty trafiają do koszyka — przy układaniu reelsów wybierane są z niego losowo jako przebitki." className="max-w-3xl">
        <div className="grid gap-5 md:grid-cols-[260px_1fr]" data-testid="broll-fragment-editor">
          <div className="space-y-2">
            <video
              ref={video}
              src={item.proxyUrl ?? item.url}
              controls
              playsInline
              muted
              className="aspect-[9/16] w-full rounded-lg bg-black object-contain"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setNow(t);
                if (stopAt.current != null && t >= stopAt.current) {
                  e.currentTarget.pause();
                  stopAt.current = null;
                }
              }}
            />
            <p className="text-center font-mono text-xs text-muted">
              {sec(now)} / {sec(dur)}
            </p>
          </div>
          <div className="space-y-4 text-sm">
            <div className="space-y-2 rounded-xl border border-line p-3">
              <p className="font-medium">Wytnij fragment</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="frag-from">Początek (s)</Label>
                  <Input id="frag-from" type="number" step="0.1" min={0} value={from} onChange={(e) => setFrom(Number(e.target.value))} className="w-24" />
                </div>
                <Button size="sm" variant="outline" onClick={() => (setFrom(Math.round(now * 10) / 10), to <= now && setTo(Math.round((now + 2.5) * 10) / 10))}>
                  Początek tutaj
                </Button>
                <div className="space-y-1">
                  <Label htmlFor="frag-to">Koniec (s)</Label>
                  <Input id="frag-to" type="number" step="0.1" min={0} value={to} onChange={(e) => setTo(Number(e.target.value))} className="w-24" />
                </div>
                <Button size="sm" variant="outline" onClick={() => setTo(Math.round(now * 10) / 10)}>
                  Koniec tutaj
                </Button>
              </div>
              <p className={cn("text-xs", valid ? "text-muted" : "text-red-600")}>{valid ? `Długość ${(to - from).toFixed(1)} s — w reelsie przebitka trwa najwyżej 3,5 s.` : "Koniec musi być co najmniej 0,5 s po początku."}</p>
              <Button size="sm" disabled={busy || !valid} onClick={() => void add({ sourceIn: from, sourceOut: to })} data-testid="fragment-add">
                <Plus /> Dodaj do koszyka
              </Button>
            </div>
            <div className="space-y-2 rounded-xl border border-line p-3">
              <p className="font-medium">Potnij całe wideo automatycznie</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="frag-len">Długość (s)</Label>
                  <Input id="frag-len" type="number" step="0.5" min={1} max={3.5} value={length} onChange={(e) => setLength(e.target.value)} className="w-24" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="frag-every">Co ile (s)</Label>
                  <Input id="frag-every" type="number" step="0.5" min={1} value={every} onChange={(e) => setEvery(e.target.value)} className="w-24" />
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void add({ auto: { length: Math.min(3.5, Math.max(1, Number(length) || 2.5)), every: Math.max(1, Number(every) || 4) } })} data-testid="fragment-auto">
                  <Scissors /> Potnij
                </Button>
              </div>
              <p className="text-xs text-muted">{dur ? `Z ${Math.round(dur)} s wyjdzie ok. ${Math.max(0, Math.floor((dur - (Number(length) || 2.5)) / Math.max(1, Number(every) || 4)) + 1)} fragmentów.` : ""}</p>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium">W koszyku z tego wideo: {mine.length}</p>
              {mine.length ? (
                <ul className="max-h-56 space-y-1 overflow-y-auto" data-testid="fragment-list">
                  {mine.map((f, i) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1">
                      <span className="font-mono text-xs">
                        #{i + 1} · {sec(f.sourceIn)}–{sec(f.sourceOut)} ({(f.sourceOut - f.sourceIn).toFixed(1)} s)
                      </span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" aria-label="Odtwórz fragment" onClick={() => play(f)}>
                          <Play />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Usuń fragment"
                          onClick={async () => {
                            await api(`/api/admin/ads/broll-fragments/${f.id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message, "err"));
                            await reload();
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Jeszcze nic — odtwórz wideo, zaznacz początek i koniec albo potnij automatycznie.</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
