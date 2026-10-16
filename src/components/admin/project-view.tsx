"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronLeft } from "lucide-react";
import type { ProjectData } from "@/lib/server/project-data";
import { Badge, Progress, useToast } from "@/components/ui";
import { QuestionsPanel } from "./questions-panel";
import { InvitationsPanel } from "./invitations-panel";
import { SettingsPanel } from "./settings-panel";
import { CombinedPanel } from "./combined-panel";
import { terms } from "@/lib/project-terms";

export function ProjectView({ data }: { data: ProjectData }) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [tab, setTab] = useState("questions");
  const total = data.questions.length;
  const recorded = data.questions.filter((q) => q.takes.length > 0).length;
  const processing = data.questions.some((q) => q.takes.some((t) => t.status === "UPLOADED" || t.status === "PROCESSING" || t.status === "UPLOADING"));
  const rendering = data.combined.some((c) => c.status === "QUEUED" || c.status === "RUNNING");

  // live job status: refresh while something is being processed in the background
  useEffect(() => {
    if (!processing && !rendering) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [processing, rendering, router]);

  const ctx = { data, refresh: () => router.refresh(), toast };
  return (
    <div>
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" /> Projekty
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold leading-tight">{data.project.name}</h1>
          {data.project.description ? <p className="mt-1 max-w-2xl text-sm text-muted">{data.project.description}</p> : null}
        </div>
        <div className="w-56">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Postęp nagrań</span>
            <span className="tabular">
              {recorded}/{total}
            </span>
          </div>
          <Progress value={total ? recorded / total : 0} />
        </div>
      </div>
      {!data.elevenLabs ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>ElevenLabs nie jest skonfigurowany.</b> Czytanie pytań przez lektora i automatyczna transkrypcja wymagają ustawienia <code>ELEVENLABS_API_KEY</code> w pliku <code>.env</code>. Nagrywanie działa bez tego.
        </div>
      ) : null}
      <Tabs.Root value={tab} onValueChange={setTab} className="mt-6">
        <Tabs.List className="flex gap-1 border-b border-line">
          {[
            ["questions", terms(data.project.format).tab],
            ["experts", "Eksperci i linki"],
            ["export", "Eksport"],
            ["settings", "Ustawienia"],
          ].map(([v, l]) => (
            <Tabs.Trigger key={v} value={v} className="-mb-px border-b-2 border-transparent px-3 py-2.5 text-sm text-muted transition data-[state=active]:border-ink data-[state=active]:font-medium data-[state=active]:text-ink">
              {l}
              {v === "questions" && processing ? (
                <Badge tone="blue" className="ml-2">
                  przetwarzanie
                </Badge>
              ) : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="questions" className="pt-6">
          <QuestionsPanel {...ctx} />
        </Tabs.Content>
        <Tabs.Content value="experts" className="pt-6">
          <InvitationsPanel {...ctx} />
        </Tabs.Content>
        <Tabs.Content value="export" className="pt-6">
          <CombinedPanel {...ctx} />
        </Tabs.Content>
        <Tabs.Content value="settings" className="pt-6">
          <SettingsPanel {...ctx} />
        </Tabs.Content>
      </Tabs.Root>
      {toastNode}
    </div>
  );
}

export interface PanelProps {
  data: ProjectData;
  refresh: () => void;
  toast: (t: string, tone?: "ok" | "err") => void;
}
