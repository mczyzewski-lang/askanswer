import { FONT_FAMILIES, FONT_WEIGHTS } from "../themes";

let loading: Promise<void> | null = null;

/** Make sure every font face used by the compositor is loaded before drawing on canvas. */
export function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  if (!loading) {
    loading = Promise.all(FONT_FAMILIES.flatMap((f) => FONT_WEIGHTS.map((w) => document.fonts.load(`${w} 40px "${f}"`, "AĄęŻź?")))).then(
      () => undefined,
      () => undefined,
    );
  }
  return loading;
}
