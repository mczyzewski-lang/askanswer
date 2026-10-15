"use client";
import { useMemo, useState } from "react";
import { FolderPlus, Pencil, Search, Star, Trash2, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { VoicePreviewButton } from "@/components/voice-preview";
import { useVoiceData, voiceLabel, type AccountVoice } from "@/components/voice-picker";

export function VoicesView() {
  const { voices, collections, reload } = useVoiceData();
  const { toast, toastNode } = useToast();
  const [selected, setSelected] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");
  const byId = useMemo(() => new Map((voices?.voices ?? []).map((v) => [v.id, v])), [voices]);
  const current = collections.find((c) => c.id === selected) ?? null;

  const call = async (url: string, method: string, body?: unknown, ok?: string) => {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error ?? "Błąd", "err");
      return null;
    }
    if (ok) toast(ok);
    await reload();
    return data;
  };

  const newCollection = async () => {
    const name = prompt("Nazwa kolekcji (np. „Lektorki prawnicze”):");
    if (!name?.trim()) return;
    const c = await call("/api/admin/voice-collections", "POST", { name }, "Utworzono kolekcję");
    if (c?.id) setSelected(c.id);
  };

  const list: AccountVoice[] = (voices?.voices ?? []).filter((v) => !query || voiceLabel(v).toLowerCase().includes(query.toLowerCase()) || v.id.includes(query));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold">Głosy</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Twórz własne kolekcje głosów lektora i wybieraj z nich w projektach („Moje kolekcje”). Lista „Wszystkie głosy” to głosy z Twojego konta ElevenLabs — głosy z biblioteki ElevenLabs dodaj najpierw do „My Voices” na elevenlabs.io albo wpisz ich ID poniżej.
          </p>
        </div>
        <Button onClick={newCollection}>
          <FolderPlus /> Nowa kolekcja
        </Button>
      </div>
      {voices && !voices.configured ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Ustaw ELEVENLABS_API_KEY, aby zobaczyć głosy z konta i odsłuchiwać próbki.</div>
      ) : null}
      {voices?.error ? <p className="mt-4 text-sm text-red-600">{voices.error}</p> : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          <button onClick={() => setSelected("all")} className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm", selected === "all" ? "bg-ink text-white" : "hover:bg-black/[.04]")}>
            Wszystkie głosy <span className="tabular text-xs opacity-70">{voices?.voices.length ?? 0}</span>
          </button>
          <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Moje kolekcje</p>
          {collections.length === 0 ? <p className="px-3 text-sm text-muted">Brak kolekcji.</p> : null}
          {collections.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)} className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm", selected === c.id ? "bg-ink text-white" : "hover:bg-black/[.04]")}>
              <span className="truncate">{c.name}</span> <span className="tabular text-xs opacity-70">{c.items.length}</span>
            </button>
          ))}
        </nav>

        <div>
          {current ? (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-semibold">{current.name}</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const n = prompt("Nowa nazwa kolekcji:", current.name);
                    if (n?.trim()) void call(`/api/admin/voice-collections/${current.id}`, "PATCH", { name: n });
                  }}
                >
                  <Pencil /> Zmień nazwę
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={async () => {
                    if (!confirm(`Usunąć kolekcję „${current.name}”? Głosy w ElevenLabs pozostaną bez zmian.`)) return;
                    await call(`/api/admin/voice-collections/${current.id}`, "DELETE", undefined, "Usunięto kolekcję");
                    setSelected("all");
                  }}
                >
                  <Trash2 /> Usuń kolekcję
                </Button>
              </div>
              <form
                className="mb-4 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!manualId.trim()) return;
                  if (await call(`/api/admin/voice-collections/${current.id}/items`, "POST", { voiceId: manualId.trim() }, "Dodano głos")) setManualId("");
                }}
              >
                <Input placeholder="Dodaj po ID głosu ElevenLabs (np. z Voice Library)" value={manualId} onChange={(e) => setManualId(e.target.value)} aria-label="ID głosu" />
                <Button type="submit" variant="outline" disabled={!manualId.trim()}>
                  Dodaj
                </Button>
              </form>
              {current.items.length === 0 ? (
                <EmptyState icon={<Star className="h-8 w-8" />} title="Kolekcja jest pusta">
                  Przejdź do „Wszystkie głosy” i kliknij gwiazdkę przy głosie, albo dodaj głos po ID.
                </EmptyState>
              ) : (
                <div className="space-y-2">
                  {current.items.map((i) => {
                    const v = byId.get(i.voiceId);
                    return (
                      <Card key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{i.label || (v ? v.name : i.voiceId)}</p>
                          <p className="truncate text-xs text-muted">
                            {v ? voiceLabel(v) : "Głos spoza konta ElevenLabs"} · {i.voiceId}
                          </p>
                        </div>
                        <VoicePreviewButton voiceId={i.voiceId} />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const l = prompt("Własna nazwa głosu (puste = nazwa z ElevenLabs):", i.label ?? "");
                            if (l !== null) void call(`/api/admin/voice-collections/${current.id}/items/${i.id}`, "PATCH", { label: l || null });
                          }}
                        >
                          <Pencil /> Nazwa
                        </Button>
                        <Button size="iconSm" variant="ghost" aria-label="Usuń z kolekcji" onClick={() => call(`/api/admin/voice-collections/${current.id}/items/${i.id}`, "DELETE", undefined, "Usunięto z kolekcji")}>
                          <X />
                        </Button>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input className="pl-9" placeholder="Szukaj głosu (nazwa, akcent, płeć)…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Szukaj głosu" />
              </div>
              {list.length === 0 ? (
                <EmptyState title="Brak głosów">{voices?.configured ? "Nie znaleziono głosów pasujących do wyszukiwania." : "Skonfiguruj ElevenLabs, aby zobaczyć głosy."}</EmptyState>
              ) : (
                <div className="space-y-2">
                  {list.map((v) => {
                    const member = collections.filter((c) => c.items.some((i) => i.voiceId === v.id));
                    return (
                      <Card key={v.id} className="flex flex-wrap items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{v.name}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {Object.entries(v.labels ?? {})
                              .slice(0, 4)
                              .map(([k, val]) => (
                                <Badge key={k}>{val}</Badge>
                              ))}
                            {member.map((c) => (
                              <Badge key={c.id} tone="violet">
                                <Star className="h-3 w-3" /> {c.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <VoicePreviewButton voiceId={v.id} />
                        <AddToCollection
                          collections={collections.map((c) => ({ id: c.id, name: c.name, has: c.items.some((i) => i.voiceId === v.id) }))}
                          onAdd={async (cid) => {
                            let id = cid;
                            if (!id) {
                              const name = prompt("Nazwa nowej kolekcji:", "Moja kolekcja");
                              if (!name?.trim()) return;
                              const c = await call("/api/admin/voice-collections", "POST", { name });
                              id = c?.id;
                              if (!id) return;
                            }
                            await call(`/api/admin/voice-collections/${id}/items`, "POST", { voiceId: v.id }, "Dodano do kolekcji");
                          }}
                        />
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {toastNode}
    </div>
  );
}

function AddToCollection({ collections, onAdd }: { collections: Array<{ id: string; name: string; has: boolean }>; onAdd: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const any = collections.some((c) => c.has);
  return (
    <div className="relative">
      <Button size="default" variant="outline" onClick={() => setOpen(!open)} aria-label="Dodaj do kolekcji">
        <Star className={cn(any && "fill-amber-400 text-amber-400")} /> Do kolekcji
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-56 rounded-xl border border-line bg-white p-1 shadow-xl">
          {collections.map((c) => (
            <button
              key={c.id}
              disabled={c.has}
              onClick={() => {
                setOpen(false);
                onAdd(c.id);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-black/[.04] disabled:opacity-50"
            >
              {c.name} {c.has ? <span className="text-xs">✓</span> : null}
            </button>
          ))}
          <button
            onClick={() => {
              setOpen(false);
              onAdd(null);
            }}
            className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-brand hover:bg-black/[.04]"
          >
            + Nowa kolekcja…
          </button>
        </div>
      ) : null}
    </div>
  );
}
