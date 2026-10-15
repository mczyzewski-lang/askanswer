"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Odsłuchaj" button: plays a Polish sample of the chosen ElevenLabs voice (generated once, then cached). */
export function VoicePreviewButton({ voiceId, modelId, text, dark, className }: { voiceId: string | null; modelId?: string | null; text?: string; dark?: boolean; className?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);
  // stop when the selection changes
  useEffect(() => {
    audio.current?.pause();
    setState("idle");
    setError(null);
  }, [voiceId, modelId]);

  const toggle = async () => {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setError(null);
    setState("loading");
    // create the element inside the tap so mobile browsers allow playback
    const a = audio.current ?? new Audio();
    audio.current = a;
    try {
      const res = await fetch("/api/admin/voices/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voiceId, modelId, text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nie udało się wygenerować próbki");
      a.src = data.url;
      a.onended = () => setState("idle");
      await a.play();
      setState("playing");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  return (
    <span className={cn("inline-flex flex-col", className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={state === "loading"}
        className={cn(
          "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition disabled:opacity-60 [&_svg]:size-4",
          dark ? "h-8 rounded-lg border border-studio-line bg-studio-3 text-[12.5px] text-studio-text hover:bg-studio-line" : "border border-line bg-white hover:bg-black/[.03]",
        )}
        aria-label="Odsłuchaj próbkę głosu"
      >
        {state === "loading" ? <Loader2 className="animate-spin" /> : state === "playing" ? <Square /> : <Volume2 />}
        {state === "playing" ? "Zatrzymaj" : "Odsłuchaj"}
      </button>
      {error ? <span className={cn("mt-1 text-xs", dark ? "text-red-300" : "text-red-600")}>{error}</span> : null}
    </span>
  );
}
