import type { ThemeTokens } from "@/lib/editor/types";
import type { Gate, Score } from "@/lib/adwords/score";
import type { PMAX_SPEC } from "@/lib/adwords/spec";
import type { SCORING_B } from "@/lib/adwords/score";
import type { LayoutKey } from "@/lib/adwords/draw";

export interface AwAsset {
  id: string;
  assetKey: string;
  rowType: string;
  funnel: string | null;
  campaignCode: string | null;
  assetGroup: string | null;
  conceptId: string | null;
  aspectRatio: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sceneIndex: number | null;
  startS: number | null;
  endS: number | null;
  headline: string | null;
  subheadline: string | null;
  body: string | null;
  cta: string | null;
  adText: string | null;
  spokenText: string | null;
  screenText: string | null;
  visualBrief: string | null;
  expertPhotoKey: string | null;
  expertPhotoId: string | null;
  landingUrl: string | null;
  claimSource: string | null;
  approvalRequired: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  status: string | null;
  scoreSeed: number | null;
  scoreNote: string | null;
  layout: string | null;
  effectiveLayout: LayoutKey | null;
  edit: { photoHidden?: boolean; zoom?: number; offsetX?: number; offsetY?: number; cleanPhoto?: boolean; renderAssetId?: string } | null;
}
export interface AwPhoto {
  id: string;
  key: string;
  name: string;
  role: string | null;
  altText: string | null;
  consentConfirmed: boolean;
  consentNote: string | null;
  consentAt: string | null;
  focalX: number;
  focalY: number;
  url: string | null;
}
export interface AwCampaign {
  id: string;
  code: string;
  name: string;
  goal: string;
  landingUrl: string | null;
  businessName: string | null;
  status: string;
}
export interface AwData {
  project: { id: string; name: string; slug: string; themeId: string | null; brief: string | null; defaultBrief: string; description?: string | null };
  canEdit: boolean;
  theme: ThemeTokens;
  logoUrl: string | null;
  campaigns: AwCampaign[];
  assets: AwAsset[];
  photos: AwPhoto[];
  evaluation: {
    images: Array<{ id: string; assetKey: string; conceptId: string | null; scoreA: Score | null; scoreB: Score | null; gate: Gate }>;
    videos: Array<{ conceptId: string; scoreA: Score; scoreB: Score; gate: Gate }>;
    texts: Array<{ id: string; assetKey: string; scoreA: Score; scoreB: Score; gate: Gate }>;
  };
  spec: typeof PMAX_SPEC;
  scoringB: typeof SCORING_B;
}
export type Toast = (t: string, tone?: "ok" | "err") => void;
