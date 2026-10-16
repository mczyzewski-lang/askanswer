import type { EditorDocument } from "./editor/types";

/** The project's CTA end card is the source of truth: added to / removed from every video on load and export. */
export function applyEndCard(doc: EditorDocument, p: { ctaEnabled: boolean; ctaUrl: string | null; ctaText: string | null; ctaSeconds: number }) {
  const on = p.ctaEnabled && !!(p.ctaUrl?.trim() || p.ctaText?.trim());
  if (on) doc.endCard = { seconds: Math.min(10, Math.max(1, p.ctaSeconds || 3)), url: p.ctaUrl?.trim() ?? "", text: p.ctaText?.trim() || null };
  else delete doc.endCard;
}
