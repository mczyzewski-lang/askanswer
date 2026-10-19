"use client";
import { useState } from "react";
import { Card } from "@/components/ui";

interface PromptsData {
  items: Array<{ key: string; title: string; when: string; prompt: string }>;
  styles: Array<{ scope: string; style: string | null }>;
}

/** What exactly the image AI gets for this project — with the theme colours and styles filled in. */
export function AiPromptsCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PromptsData | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const load = async () => {
    setOpen((o) => !o);
    if (data) return;
    const res = await fetch(`/api/admin/projects/${projectId}/ai-prompts`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  };
  const copy = async (key: string, text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <Card className="space-y-3 p-5" data-testid="ai-prompts">
      <button type="button" onClick={() => void load()} className="flex w-full items-center justify-between text-left" aria-expanded={open}>
        <span>
          <span className="block font-medium">Prompty AI do grafik</span>
          <span className="block text-xs text-muted">Co dokładnie dostaje OpenAI — z kolorami motywu i stylem projektu. [W nawiasach] części, które dochodzą z każdego filmu.</span>
        </span>
        <span className="text-sm text-muted">{open ? "Zwiń" : "Pokaż"}</span>
      </button>
      {open ? (
        data ? (
          <div className="space-y-4">
            {data.items.map((it) => (
              <div key={it.key} className="space-y-1.5" data-testid={`ai-prompt-${it.key}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{it.title}</p>
                    <p className="text-xs text-muted">{it.when}</p>
                  </div>
                  <button type="button" className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs hover:bg-black/[.03]" onClick={() => void copy(it.key, it.prompt)}>
                    {copied === it.key ? "Skopiowano" : "Kopiuj"}
                  </button>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/[.04] p-3 font-mono text-[11.5px] leading-relaxed text-ink/85">{it.prompt}</pre>
              </div>
            ))}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Styl wizualny</p>
              <p className="text-xs text-muted">Dodawany do promptów jako „Visual style”. Zmienisz go w Motywie (domyślny) i w kategoriach.</p>
              {data.styles.map((s) => (
                <div key={s.scope} className="rounded-lg border border-line p-2.5 text-xs">
                  <p className="font-medium">{s.scope}</p>
                  <p className="mt-1 text-muted">{s.style ?? "— brak (domyślny styl: nowoczesna ilustracja edytorska)"}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Wczytuję…</p>
        )
      ) : null}
    </Card>
  );
}
