/** Pure helpers shared by the server and the browser (scoring context, the layout of an image row). */
import type { AdAsset, BrandContext, GateOptions } from "./score";
import type { LayoutKey } from "./draw";

/** words of the offer: project name + description + brief, for relevance checks */
export function brandContext(p: { name: string; description?: string | null; adwordsBrief?: string | null }, landingUrl: string | null, hasLogo: boolean): BrandContext {
  const stop = new Set(["oraz", "jest", "dla", "the", "and", "lub", "bez", "nie", "się", "jak", "aby", "czy", "przez", "które", "który"]);
  const text = `${p.name} ${p.description ?? ""} ${p.adwordsBrief ?? ""}`.toLowerCase();
  const keywords = [...new Set(text.split(/[^a-ząćęłńóśźż0-9]+/).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, 40);
  return { brandName: p.name, keywords: [...keywords, "rozwód", "rozstanie", "mediator", "mediacja", "plan", "konsultacja"].filter((v, i, a) => a.indexOf(v) === i), landingUrl, hasLogo };
}

export interface AssetEdit {
  /** the AI infographic of this format (layout "infographic") */
  infographicAssetId?: string;
  photoHidden?: boolean;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  cleanPhoto?: boolean;
}

/** the layout of an image row: chosen in the editor, else from the CSV art direction, else by photo */
export function layoutOf(a: { rowType: string; layout: string | null; visualBrief: string | null; expertPhotoKey: string | null; expertPhotoId: string | null; edit: unknown; lp?: unknown }): LayoutKey {
  const e = (a.edit ?? {}) as AssetEdit;
  if (a.rowType === "image_clean" || e.cleanPhoto) return "clean_photo";
  if (a.layout === "typographic" || a.layout === "expert_split" || a.layout === "process_steps" || a.layout === "comparison" || a.layout === "infographic") return a.layout;
  // CSV v5: layout_id of the file
  const lid = ((a.lp ?? {}) as Record<string, string>).layout_id;
  if (lid === "typographic" || lid === "expert_split" || lid === "process_steps" || lid === "comparison") return lid;
  const m = /^(typographic|expert_split|process_steps)\b/.exec((a.visualBrief ?? "").trim());
  if (m) return m[1] as LayoutKey;
  return a.expertPhotoKey || a.expertPhotoId ? "expert_split" : "typographic";
}

/** texts of the archive marked historical_do_not_publish (they block any component that reuses them) */
export function gateOptionsOf(list: Array<Pick<AdAsset, "rowType" | "status" | "adText" | "headline">>, lp?: GateOptions["lp"], topic?: string | null): GateOptions {
  return { lp: lp ?? null, topic: topic ?? null, doNotPublish: list.filter((a) => a.rowType === "historical_reference" && /do_not_publish/i.test(a.status ?? "")).map((a) => a.adText || a.headline || "").filter(Boolean) };
}

const TOPICS = ["rozwód", "alimenty", "upadłość", "mediacja", "spadek", "znak towarowy", "kredyt frankowy", "odszkodowanie"];
/** the project's topic: set by hand, else the legal topic its texts talk about most (≥3 mentions) */
export function topicOf(set: string | null | undefined, texts: string[]): string | null {
  if (set?.trim()) return set.trim();
  const f = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => ({ ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" })[c]!);
  const all = f(texts.join(" \n "));
  const best = TOPICS.map((t) => {
    const st = f(t).slice(0, Math.max(4, t.length - 2));
    return [t, all.split(st).length - 1] as const;
  }).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : null;
}
