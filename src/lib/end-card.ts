import type { EditorDocument } from "./editor/types";

type CtaProject = { ctaEnabled: boolean; ctaUrl: string | null; ctaText: string | null; ctaSeconds: number; ctaPlacement?: string | null };

/**
 * The project's CTA end card is the source of truth: added to / removed from every video on load and export.
 * Placement and length changed for one video in the Studio (custom) are kept.
 */
export function applyEndCard(doc: EditorDocument, p: CtaProject) {
  const on = p.ctaEnabled && !!(p.ctaUrl?.trim() || p.ctaText?.trim());
  if (!on) {
    delete doc.endCard;
    return;
  }
  const own = doc.endCard?.custom ? doc.endCard : null;
  doc.endCard = {
    seconds: own?.seconds ?? Math.min(10, Math.max(1, p.ctaSeconds || 3)),
    url: p.ctaUrl?.trim() ?? "",
    text: p.ctaText?.trim() || null,
    placement: own?.placement ?? (p.ctaPlacement === "overlay" ? "overlay" : "append"),
    ...(own ? { custom: true } : {}),
  };
}
