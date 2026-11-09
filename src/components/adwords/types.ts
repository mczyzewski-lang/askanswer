import type { ThemeTokens } from "@/lib/editor/types";
import type { Gate, Score } from "@/lib/adwords/score";
import type { PMAX_SPEC } from "@/lib/adwords/spec";
import type { SCORING_B } from "@/lib/adwords/score";
import type { LayoutKey } from "@/lib/adwords/draw";
import type { ClaimRec, OfferInfo } from "@/lib/adwords/landing-content";

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
  experimentId: string | null;
  variant: string | null;
  pairedAssetId: string | null;
  testAxis: string | null;
  testStage: string | null;
  deployMode: string | null;
  evidenceNote: string | null;
  recordScope: string | null;
  landingVariantId: string | null;
  lp: Record<string, string | undefined> | null;
  testPriority: number | null;
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
    sitelinks: Array<{ id: string; assetKey: string; gate: Gate }>;
  };
  spec: typeof PMAX_SPEC;
  scoringB: typeof SCORING_B;
  history: { imports: AwHistoryImport[]; rows: AwHistoryRow[] };
  landing: {
    offer: OfferInfo | null;
    claims: Array<ClaimRec & { id: string }>;
    variants: Record<string, { url?: string | null; name?: string | null } | undefined>;
    settings: { variants: Record<string, { url?: string | null; name?: string | null }>; urlStrategy?: { finalUrlExpansion?: "on" | "off" | "unknown"; exclusions?: string; checkedBy?: string | null; checkedAt?: string | null } };
  };
  /** v5 projects: rules of the ad gates (offer confirmed, approved claims); null = older project */
  gateLp: { offerValid: boolean; approvedClaims: string[] } | null;
  me: { email: string };
}
export type Toast = (t: string, tone?: "ok" | "err") => void;

export interface AwHistoryRow {
  id: string;
  importId: string;
  rowNumber: number;
  raw: Record<string, string>;
  assetState: string | null;
  component: string;
  level: string | null;
  status: string | null;
  assetType: string | null;
  typeKey: string;
  lastUpdated: string | null;
  conversions: number | null;
  convValue: number | null;
  impressions: number | null;
  clicks: number | null;
  currency: string | null;
  cost: number | null;
  addedBy: string | null;
  angle: string | null;
  conceptId: string | null;
}
export interface AwHistoryImport {
  id: string;
  fileName: string;
  title: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodRaw: string | null;
  rowCount: number;
  importedAt: string;
}
