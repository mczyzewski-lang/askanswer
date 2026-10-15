"use client";
import { useEffect, useRef } from "react";
import type { ThemeTokens } from "@/lib/editor/types";
import { buildInitialDocument } from "@/lib/editor/factory";
import { drawFrame } from "@/lib/render/compositor";
import { ensureFontsLoaded } from "@/lib/client/fonts";

/** Renders the question exactly as it will appear in the video (same compositor as preview/export). */
export function QuestionPreview({ text, theme, width = 270 }: { text: string; theme: ThemeTokens; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void ensureFontsLoaded().then(() => {
      const c = ref.current;
      if (!c || cancelled) return;
      const doc = buildInitialDocument({
        questionText: text,
        theme,
        mode: "ANSWER_ONLY",
        recording: { assetId: "none", duration: 5 },
        narration: null,
        segments: [],
        pauses: [],
        visibility: "FULL",
        questionSeconds: 4,
      });
      doc.clips = [];
      doc.narration = [{ id: "n", assetId: "n", kind: "narration", start: 0, sourceIn: 0, sourceOut: 5, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }];
      c.width = 1080;
      c.height = 1920;
      const ctx = c.getContext("2d")!;
      drawFrame(ctx, doc, 1, { getFrame: () => null, getImage: () => null });
    });
    return () => {
      cancelled = true;
    };
  }, [text, theme]);
  return <canvas ref={ref} style={{ width, height: (width * 16) / 9 }} className="rounded-2xl shadow-lg" />;
}
