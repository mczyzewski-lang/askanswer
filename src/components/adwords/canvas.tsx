"use client";
import { useEffect, useRef, useState } from "react";
import { drawCreative, drawSceneFrame, type CreativeInput, type SceneFrameInput } from "@/lib/adwords/draw";
import type { Measure } from "@/lib/adwords/score";
import { ensureFontsLoaded } from "@/lib/client/fonts";

const cache = new Map<string, Promise<HTMLImageElement | null>>();
/** an image for the canvas (cached per URL); null while loading or when it fails */
export function useImage(url: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let live = true;
    setImg(null);
    if (!url) return;
    const key = url.split("?")[0];
    if (!cache.has(key))
      cache.set(
        key,
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => res(null);
          i.src = url;
        }),
      );
    void cache.get(key)!.then((i) => live && setImg(i));
    return () => {
      live = false;
    };
  }, [url]);
  return img;
}

/**
 * The creative drawn by the same function as the exported PNG, at its real pixel size and scaled by
 * CSS. Reports what the renderer measured (overflow, safe area, smallest text, contrast).
 */
export function CreativeCanvas({ input, className, onMeasure, testId }: { input: Omit<CreativeInput, "logo" | "photo"> & { logoUrl?: string | null; photo?: (Omit<NonNullable<CreativeInput["photo"]>, "image"> & { url: string | null }) | null }; className?: string; onMeasure?: (m: Measure) => void; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const logo = useImage(input.logoUrl);
  const photo = useImage(input.photo?.url ?? null);
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    void ensureFontsLoaded().then(() => setFonts(true));
  }, []);
  const key = JSON.stringify({ ...input, fonts, logo: !!logo, photo: !!photo });
  useEffect(() => {
    const c = ref.current;
    if (!c || !fonts) return;
    c.width = input.width;
    c.height = input.height;
    const m = drawCreative(c.getContext("2d") as never, {
      ...input,
      logo: logo ?? null,
      photo: photo && input.photo ? { ...input.photo, image: photo } : null,
    });
    onMeasure?.(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className={className} style={{ aspectRatio: `${input.width} / ${input.height}` }} data-testid={testId} />;
}

export function SceneCanvas({ input, className }: { input: Omit<SceneFrameInput, "logo" | "photo"> & { logoUrl?: string | null; photo?: { url: string | null; focalX: number; focalY: number } | null }; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const logo = useImage(input.logoUrl);
  const photo = useImage(input.photo?.url ?? null);
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    void ensureFontsLoaded().then(() => setFonts(true));
  }, []);
  const key = JSON.stringify({ ...input, fonts, logo: !!logo, photo: !!photo });
  useEffect(() => {
    const c = ref.current;
    if (!c || !fonts) return;
    c.width = input.width;
    c.height = input.height;
    drawSceneFrame(c.getContext("2d") as never, { ...input, logo: logo ?? null, photo: photo && input.photo ? { image: photo, focalX: input.photo.focalX, focalY: input.photo.focalY } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className={className} style={{ aspectRatio: `${input.width} / ${input.height}` }} />;
}
