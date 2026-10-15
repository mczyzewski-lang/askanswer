"use client";
import { useEffect, useRef } from "react";
import type { EditorDocument, ThemeTokens } from "@/lib/editor/types";
import { buildInitialDocument } from "@/lib/editor/factory";
import { drawFrame } from "@/lib/render/compositor";
import { ensureFontsLoaded } from "@/lib/client/fonts";

/** Live theme preview drawn with the real compositor (question, highlighted subtitles, lower third, logo). */
export function ThemePreview({ theme, logoUrl, width = 240 }: { theme: ThemeTokens; logoUrl: string | null; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const logoImg = logoUrl ? new Image() : null;
    const draw = () => {
      const c = ref.current;
      if (!c || cancelled) return;
      const words = "Zastrzeżenie znaku towarowego pozwala skuteczniej chronić markę.".split(" ");
      const base = buildInitialDocument({
        questionText: "Dlaczego warto zastrzec znak towarowy?",
        theme: { ...theme, logoAssetId: logoUrl ? "logo" : null },
        mode: "ANSWER_ONLY",
        recording: { assetId: "rec", duration: 10 },
        narration: null,
        segments: [{ id: "s", assetId: "rec", words: words.map((w, i) => ({ id: `w${i}`, text: w, start: 1 + i * 0.4, end: 1.35 + i * 0.4 })) }],
        pauses: [],
        visibility: "FULL",
        questionSeconds: 4,
        logo: !!logoUrl,
      });
      const doc: EditorDocument = {
        ...base,
        overlays: [
          ...base.overlays,
          { id: "lt", kind: "lowerThird", name: "Belka", title: "Anna Kowalska", subtitle: "Radczyni prawna", fill: "$primary", accent: "$accent", textColor: "$text", fontFamily: "$label", start: 0, end: null, x: 0.06, y: 0.58, w: 0.62, h: 0.075, opacity: 1, animation: "none" },
        ],
      };
      c.width = 1080;
      c.height = 1920;
      drawFrame(c.getContext("2d")!, doc, 1.9, {
        getFrame: () => null,
        getImage: () => (logoImg && logoImg.complete && logoImg.naturalWidth ? { image: logoImg, width: logoImg.naturalWidth, height: logoImg.naturalHeight } : null),
      });
    };
    void ensureFontsLoaded().then(draw);
    if (logoImg && logoUrl) {
      logoImg.onload = draw;
      logoImg.src = logoUrl;
    }
    return () => {
      cancelled = true;
    };
  }, [theme, logoUrl]);
  return <canvas ref={ref} style={{ width, height: (width * 16) / 9 }} className="rounded-2xl shadow-xl" />;
}
