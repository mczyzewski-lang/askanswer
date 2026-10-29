/**
 * The social media provider as Social Media Studio sees it. Two implementations: the real
 * Upload-Post API (upload-post.ts) and the DEMO mock (mock.ts) used without a key and for every
 * demo account — so demo data can never be published for real.
 */
import type { Platform } from "@/lib/social/platforms";

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number | null,
    /** worth retrying later (rate limit, 5xx, network) */
    public retryable: boolean,
    public code?: string,
    public retryAfterMs?: number,
    /** the request may have reached the provider (timeout after sending) — check before re-sending */
    public uncertain = false,
    public body?: unknown,
  ) {
    super(message);
  }
}

export interface ProviderAccount {
  platform: Platform;
  platformAccountId: string | null;
  handle: string | null;
  displayName: string | null;
  image: string | null;
  reauthRequired: boolean;
  capabilities: string[];
  raw: unknown;
}

export interface ProviderPage {
  id: string;
  name: string;
  /** the account the page belongs to (when the provider says) */
  accountId?: string | null;
}

export interface UploadInput {
  profile: string;
  platform: Platform;
  file: { path: string; name: string; mime: string };
  /** YouTube title / Facebook & LinkedIn video title */
  title: string;
  caption: string;
  firstComment?: string;
  scheduledAt: Date;
  timezone: string;
  idempotencyKey: string;
  externalId: string;
  /** Facebook page / LinkedIn organization page */
  pageId?: string | null;
  options: Record<string, unknown>;
  coverTimestamp?: number | null;
}

export interface UploadResult {
  jobId: string | null;
  requestId: string | null;
  /** what the response says right away */
  state: JobState;
  url?: string | null;
  platformPostId?: string | null;
  error?: string | null;
  warnings?: string[];
  httpStatus: number;
  raw: unknown;
}

export type JobState = "scheduled" | "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "not_found" | "unknown";

export interface JobStatus {
  state: JobState;
  url?: string | null;
  platformPostId?: string | null;
  error?: string | null;
  warnings?: string[];
  raw: unknown;
}

export interface EditInput {
  scheduledAt?: Date;
  timezone?: string;
  title?: string;
  caption?: string;
  fields?: Record<string, unknown>;
}

export interface MetricsResult {
  views: number | null;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  watchTimeSec: number | null;
  avgViewDurationSec: number | null;
  /** names the platform does not report for this post */
  unsupported: string[];
  raw: unknown;
}

export interface ProviderComment {
  id: string;
  parentId: string | null;
  text: string;
  authorName: string;
  authorHandle: string | null;
  authorId: string | null;
  createdAt: Date;
  likeCount: number | null;
  raw: unknown;
}

export interface SocialProvider {
  readonly name: "upload-post" | "demo";
  readonly live: boolean;
  createProfile(username: string): Promise<void>;
  deleteProfile(username: string): Promise<void>;
  /** accounts connected to the profile; null when the profile does not exist */
  getProfile(username: string): Promise<{ username: string; accounts: ProviderAccount[] } | null>;
  /** URL of the hosted (white-label) page where the client connects accounts */
  connectUrl(username: string, o: { redirectUrl: string; platforms: Platform[]; title: string; description: string; logoUrl?: string | null }): Promise<string>;
  pages(username: string, platform: "FACEBOOK" | "LINKEDIN"): Promise<ProviderPage[]>;
  upload(i: UploadInput): Promise<UploadResult>;
  status(ref: { jobId?: string | null; requestId?: string | null }): Promise<JobStatus>;
  editScheduled(jobId: string, e: EditInput): Promise<void>;
  /** true = cancelled; false = the job is not there any more (already published / unknown) */
  cancelScheduled(jobId: string): Promise<boolean>;
  postMetrics(r: { profile: string; platform: Platform; platformPostId: string | null; requestId: string | null }): Promise<MetricsResult>;
  accountFollowers(profile: string, platform: Platform, pageId?: string | null): Promise<number | null>;
  comments(r: { profile: string; platform: Platform; postId: string | null; postUrl: string | null; after?: string | null }): Promise<{ comments: ProviderComment[]; next: string | null }>;
  /** public reply under a comment (or a comment on the post when commentId is missing) */
  reply(r: { profile: string; platform: Platform; message: string; commentId: string | null; postId: string | null; postUrl: string | null }): Promise<{ id: string | null }>;
  /** Instagram: private reply (DM) to the comment's author */
  privateReply(r: { profile: string; commentId: string; message: string }): Promise<{ id: string | null }>;
}
