/**
 * Upload-Post API (https://api.upload-post.com/api). Endpoints and fields follow the official
 * client library (npm "upload-post" 2.16): `Authorization: Apikey <key>`, POST /upload (multipart),
 * GET /uploadposts/status, PATCH|DELETE /uploadposts/schedule/{job_id}, /uploadposts/users,
 * /uploadposts/users/generate-jwt, /uploadposts/{facebook|linkedin}/pages, /uploadposts/comments*,
 * /uploadposts/post-analytics, /analytics/{profile}. The key never leaves the server.
 *
 * Response bodies are parsed tolerantly (the library types them loosely): every response is kept raw
 * next to what was read from it. NOT verified against the live API from this environment.
 */
import fs from "node:fs";
import { env } from "../../env";
import { PLATFORM_META, platformFromProvider, type Platform } from "@/lib/social/platforms";
import { ProviderError, type EditInput, type JobState, type JobStatus, type MetricsResult, type ProviderAccount, type ProviderComment, type ProviderPage, type SocialProvider, type UploadInput, type UploadResult } from "./types";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** first number found under any of the keys, also one level down (e.g. post_metrics.views) */
export function pickNum(o: unknown, keys: string[]): number | null {
  if (!isObj(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    if (isObj(v) && typeof v.value === "number") return v.value;
  }
  return null;
}
export function pickStr(o: unknown, keys: string[]): string | null {
  if (!isObj(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function retryAfterMs(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.min(120_000, Math.max(0, s * 1000));
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.min(120_000, Math.max(0, t - Date.now())) : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Req {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined | null>;
  json?: unknown;
  form?: () => Promise<FormData>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** safe to repeat (GET, or a POST carrying an Idempotency-Key) */
  idempotent: boolean;
  tries?: number;
}

export class UploadPostProvider implements SocialProvider {
  readonly name = "upload-post" as const;
  readonly live = true;
  constructor(
    private key = env.uploadPostKey,
    private base = env.uploadPostBaseUrl,
  ) {}

  async request<T = Json>(r: Req): Promise<{ status: number; body: T }> {
    const url = new URL(`${this.base}${r.path}`);
    for (const [k, v] of Object.entries(r.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const tries = r.tries ?? (r.idempotent ? 3 : 1);
    let last: ProviderError | null = null;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), r.timeoutMs ?? 30_000);
      let res: Response;
      try {
        const headers: Record<string, string> = { Authorization: `Apikey ${this.key}`, "X-Upload-Post-Source": "askby-social-studio", Accept: "application/json", ...(r.headers ?? {}) };
        let body: BodyInit | undefined;
        if (r.form) body = await r.form();
        else if (r.json !== undefined) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(r.json);
        }
        res = await fetch(url, { method: r.method, headers, body, signal: ac.signal });
      } catch (e) {
        clearTimeout(timer);
        const aborted = (e as Error).name === "AbortError";
        // the request may have been received: only an idempotent request is repeated
        last = new ProviderError(aborted ? "Upload-Post nie odpowiedział na czas" : `Brak połączenia z Upload-Post: ${(e as Error).message}`, null, true, aborted ? "timeout" : "network", undefined, r.method !== "GET");
        if (attempt < tries) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw last;
      }
      clearTimeout(timer);
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text.slice(0, 2000) };
      }
      if (res.ok) return { status: res.status, body: parsed as T };
      const msg = pickStr(parsed, ["message", "detail", "error", "error_message"]) ?? `HTTP ${res.status}`;
      const code = pickStr(parsed, ["error_code", "code"]) ?? undefined;
      const retryable = res.status === 429 || res.status >= 500;
      last = new ProviderError(`Upload-Post: ${msg}`, res.status, retryable, code, retryAfterMs(res.headers.get("retry-after")), false, parsed);
      if (retryable && attempt < tries) {
        await sleep(last.retryAfterMs ?? 1000 * 2 ** (attempt - 1));
        continue;
      }
      throw last;
    }
    throw last ?? new ProviderError("Upload-Post: nieznany błąd", null, true);
  }

  // ---------------------------------------------------------------- profiles

  async createProfile(username: string) {
    try {
      await this.request({ method: "POST", path: "/uploadposts/users", json: { username }, idempotent: true });
    } catch (e) {
      // already there (409 / "exists"): the id is stable, so it is ours
      if (e instanceof ProviderError && (e.status === 409 || /exist/i.test(e.message))) return;
      throw e;
    }
  }

  async deleteProfile(username: string) {
    try {
      await this.request({ method: "DELETE", path: "/uploadposts/users", json: { username }, idempotent: true });
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return;
      throw e;
    }
  }

  async getProfile(username: string) {
    const { body } = await this.request<Json>({ method: "GET", path: "/uploadposts/users", idempotent: true });
    const profiles = (Array.isArray(body?.profiles) ? body.profiles : Array.isArray(body?.users) ? body.users : []) as Json[];
    const p = profiles.find((x) => x.username === username);
    if (!p) return null;
    return { username, accounts: parseAccounts(p.social_accounts) };
  }

  async connectUrl(username: string, o: { redirectUrl: string; platforms: Platform[]; title: string; description: string; logoUrl?: string | null }) {
    const { body } = await this.request<Json>({
      method: "POST",
      path: "/uploadposts/users/generate-jwt",
      json: {
        username,
        redirect_url: o.redirectUrl,
        redirect_button_text: "Wróć do Social Media Studio",
        platforms: o.platforms.map((p) => PLATFORM_META[p].provider),
        connect_title: o.title,
        connect_description: o.description,
        language: "pl",
        show_calendar: false,
        ...(o.logoUrl ? { logo_image: o.logoUrl } : {}),
      },
      idempotent: true,
    });
    const url = pickStr(body, ["access_url", "connection_url", "url"]);
    if (!url) throw new ProviderError("Upload-Post nie zwrócił adresu łączenia kont", 200, false, undefined, undefined, false, body);
    return url;
  }

  async pages(username: string, platform: "FACEBOOK" | "LINKEDIN"): Promise<ProviderPage[]> {
    const { body } = await this.request<Json>({ method: "GET", path: `/uploadposts/${platform === "FACEBOOK" ? "facebook" : "linkedin"}/pages`, query: { profile: username }, idempotent: true });
    const list = (Array.isArray(body?.pages) ? body.pages : Array.isArray(body?.data) ? body.data : []) as Json[];
    return list
      .map((p) => ({ id: pickStr(p, ["id", "page_id", "urn", "organization_urn"]) ?? "", name: pickStr(p, ["name", "page_name", "localizedName"]) ?? "", accountId: pickStr(p, ["account_id", "user_id"]) }))
      .filter((p) => p.id);
  }

  // ---------------------------------------------------------------- publishing

  async upload(i: UploadInput): Promise<UploadResult> {
    const provider = PLATFORM_META[i.platform].provider;
    const form = async () => {
      const f = new FormData();
      const blob = await fs.openAsBlob(i.file.path, { type: i.file.mime });
      f.append("video", blob, i.file.name);
      f.append("user", i.profile);
      f.append("platform[]", provider);
      f.append("title", i.platform === "YOUTUBE" || i.platform === "FACEBOOK" || i.platform === "LINKEDIN" ? i.title || firstLine(i.caption) : i.caption);
      if (i.platform === "YOUTUBE" || i.platform === "FACEBOOK" || i.platform === "LINKEDIN") f.append("description", i.caption);
      if (i.firstComment?.trim()) f.append("first_comment", i.firstComment.trim());
      f.append("scheduled_date", i.scheduledAt.toISOString());
      f.append("timezone", "UTC");
      f.append("async_upload", "true");
      if (env.uploadPostSendExternalId) f.append("external_id", i.externalId);
      for (const [k, v] of Object.entries(platformFields(i))) {
        if (Array.isArray(v)) for (const x of v) f.append(k, String(x));
        else if (v !== undefined && v !== null && v !== "") f.append(k, String(v));
      }
      return f;
    };
    // the same Idempotency-Key collapses a repeated request into the same order at the provider
    const { status, body } = await this.request<Json>({ method: "POST", path: "/upload", form, headers: { "Idempotency-Key": i.idempotencyKey }, timeoutMs: 10 * 60_000, idempotent: true, tries: 3 });
    return parseUploadResponse(status, body, i.platform);
  }

  async status(ref: { jobId?: string | null; requestId?: string | null }): Promise<JobStatus> {
    try {
      const { body } = await this.request<Json>({ method: "GET", path: "/uploadposts/status", query: ref.jobId ? { job_id: ref.jobId } : { request_id: ref.requestId }, idempotent: true });
      return parseStatus(body);
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return { state: "not_found", raw: e.body };
      throw e;
    }
  }

  async editScheduled(jobId: string, e: EditInput) {
    const body: Json = {};
    if (e.scheduledAt) {
      body.scheduled_date = e.scheduledAt.toISOString();
      body.timezone = "UTC";
    }
    if (e.title !== undefined) body.title = e.title;
    if (e.caption !== undefined) body.caption = e.caption;
    if (e.fields && Object.keys(e.fields).length) body.fields = e.fields;
    await this.request({ method: "PATCH", path: `/uploadposts/schedule/${encodeURIComponent(jobId)}`, json: body, idempotent: true });
  }

  async cancelScheduled(jobId: string) {
    try {
      await this.request({ method: "DELETE", path: `/uploadposts/schedule/${encodeURIComponent(jobId)}`, idempotent: true });
      return true;
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return false;
      throw e;
    }
  }

  // ---------------------------------------------------------------- analytics

  async postMetrics(r: { profile: string; platform: Platform; platformPostId: string | null; requestId: string | null }): Promise<MetricsResult> {
    const provider = PLATFORM_META[r.platform].provider;
    const { body } = r.platformPostId
      ? await this.request<Json>({ method: "GET", path: "/uploadposts/post-analytics", query: { platform_post_id: r.platformPostId, platform: provider, user: r.profile }, idempotent: true })
      : await this.request<Json>({ method: "GET", path: `/uploadposts/post-analytics/${encodeURIComponent(r.requestId ?? "")}`, idempotent: true });
    return parseMetrics(body, provider);
  }

  async accountFollowers(profile: string, platform: Platform, pageId?: string | null) {
    const provider = PLATFORM_META[platform].provider;
    const { body } = await this.request<Json>({ method: "GET", path: `/analytics/${encodeURIComponent(profile)}`, query: { platforms: provider, ...(platform === "FACEBOOK" && pageId ? { page_id: pageId } : {}), ...(platform === "LINKEDIN" && pageId ? { page_urn: pageId } : {}) }, idempotent: true });
    const block = (isObj(body?.analytics) ? body.analytics[provider] : body?.[provider]) as unknown;
    return pickNum(block, ["followers", "followers_count", "follower_count", "subscribers", "subscriber_count", "fans"]);
  }

  // ---------------------------------------------------------------- comments

  async comments(r: { profile: string; platform: Platform; postId: string | null; postUrl: string | null; after?: string | null }) {
    const { body } = await this.request<Json>({
      method: "GET",
      path: "/uploadposts/comments",
      query: { platform: PLATFORM_META[r.platform].provider, user: r.profile, post_id: r.postId, post_url: r.postId ? null : r.postUrl, after: r.after, limit: 50 },
      idempotent: true,
    });
    const list = (Array.isArray(body?.comments) ? body.comments : Array.isArray(body?.data) ? body.data : []) as Json[];
    const comments: ProviderComment[] = [];
    const walk = (c: Json, parent: string | null) => {
      const id = pickStr(c, ["id", "comment_id", "cid"]);
      if (!id) return;
      const author = isObj(c.author) ? c.author : isObj(c.from) ? c.from : isObj(c.user) ? c.user : {};
      comments.push({
        id,
        parentId: pickStr(c, ["parent_id", "parent_comment_id"]) ?? parent,
        text: pickStr(c, ["text", "message", "content", "comment"]) ?? "",
        authorName: pickStr(author, ["name", "display_name", "username"]) ?? pickStr(c, ["username", "author_name"]) ?? "",
        authorHandle: pickStr(author, ["username", "handle"]) ?? pickStr(c, ["username"]),
        authorId: pickStr(author, ["id", "user_id"]),
        createdAt: new Date(pickStr(c, ["timestamp", "created_at", "created_time", "publishedAt", "create_time"]) ?? Date.now()),
        likeCount: pickNum(c, ["like_count", "likes", "likeCount", "digg_count"]),
        raw: c,
      });
      const replies = (Array.isArray(c.replies) ? c.replies : isObj(c.replies) && Array.isArray(c.replies.data) ? c.replies.data : []) as Json[];
      for (const x of replies) walk(x, id);
    };
    for (const c of list) walk(c, null);
    const paging = isObj(body?.paging) ? body.paging : isObj(body?.pagination) ? body.pagination : {};
    const next = pickStr(body, ["next", "next_cursor", "after"]) ?? pickStr(paging, ["next_cursor", "after", "next"]) ?? (isObj(paging.cursors) ? pickStr(paging.cursors, ["after"]) : null);
    return { comments, next: next && next !== r.after ? next : null };
  }

  async reply(r: { profile: string; platform: Platform; message: string; commentId: string | null; postId: string | null; postUrl: string | null }) {
    if (r.platform === "INSTAGRAM" && r.commentId) {
      const { body } = await this.request<Json>({ method: "POST", path: "/uploadposts/comments/public-reply", json: { platform: "instagram", user: r.profile, comment_id: r.commentId, message: r.message }, idempotent: false });
      return { id: pickStr(body, ["id", "comment_id", "reply_id"]) ?? (isObj(body?.data) ? pickStr(body.data, ["id"]) : null) };
    }
    const { body } = await this.request<Json>({
      method: "POST",
      path: "/uploadposts/comments/create",
      json: { platform: PLATFORM_META[r.platform].provider, user: r.profile, message: r.message, ...(r.commentId ? { comment_id: r.commentId } : r.postId ? { post_id: r.postId } : { post_url: r.postUrl }) },
      idempotent: false,
    });
    return { id: pickStr(body, ["id", "comment_id"]) ?? (isObj(body?.data) ? pickStr(body.data, ["id"]) : null) };
  }

  async privateReply(r: { profile: string; commentId: string; message: string }) {
    const { body } = await this.request<Json>({ method: "POST", path: "/uploadposts/comments/reply", json: { platform: "instagram", user: r.profile, comment_id: r.commentId, message: r.message }, idempotent: false });
    return { id: pickStr(body, ["id", "message_id"]) };
  }
}

const firstLine = (s: string) => (s.split(/\n/)[0] ?? "").slice(0, 100);

/** platform options of the post → Upload-Post form fields (names from the official library) */
export function platformFields(i: Pick<UploadInput, "platform" | "options" | "pageId" | "coverTimestamp">): Record<string, string | number | boolean | string[]> {
  const o = i.options ?? {};
  const out: Record<string, string | number | boolean | string[]> = {};
  switch (i.platform) {
    case "INSTAGRAM":
      out.media_type = "REELS";
      out.share_to_feed = o.shareToFeed !== false;
      if (typeof i.coverTimestamp === "number") out.thumb_offset = Math.round(i.coverTimestamp * 1000);
      break;
    case "TIKTOK":
      out.privacy_level = String(o.tiktokPrivacy ?? "PUBLIC_TO_EVERYONE");
      if (o.disableComments) out.disable_comment = true;
      if (o.disableDuet) out.disable_duet = true;
      if (o.disableStitch) out.disable_stitch = true;
      if (typeof i.coverTimestamp === "number") out.cover_timestamp = Math.round(i.coverTimestamp * 1000);
      if (o.aiGenerated) out.is_aigc = true;
      break;
    case "YOUTUBE":
      out.privacyStatus = String(o.youtubePrivacy ?? "public");
      out.selfDeclaredMadeForKids = Boolean(o.madeForKids ?? false);
      if (Array.isArray(o.youtubeTags) && o.youtubeTags.length) out["tags[]"] = (o.youtubeTags as string[]).map(String);
      if (o.youtubeCategoryId) out.categoryId = String(o.youtubeCategoryId);
      if (o.aiGenerated) out.containsSyntheticMedia = true;
      break;
    case "FACEBOOK":
      if (i.pageId) out.facebook_page_id = i.pageId;
      out.facebook_media_type = String(o.facebookMediaType ?? "REELS");
      break;
    case "LINKEDIN":
      out.visibility = "PUBLIC";
      if (i.pageId) out.target_linkedin_page_id = i.pageId;
      break;
  }
  return out;
}

function parseAccounts(sa: unknown): ProviderAccount[] {
  if (!isObj(sa)) return [];
  const out: ProviderAccount[] = [];
  for (const [name, v] of Object.entries(sa)) {
    const platform = platformFromProvider(name);
    if (!platform || !v || (typeof v === "string" && !v.trim())) continue;
    const a: Json = isObj(v) ? v : { username: String(v) };
    const caps = a.capabilities;
    out.push({
      platform,
      platformAccountId: pickStr(a, ["id", "account_id", "user_id", "open_id", "channel_id", "page_id", "urn", "social_id"]),
      handle: pickStr(a, ["username", "handle", "user_name"]),
      displayName: pickStr(a, ["display_name", "name", "channel_title", "username"]),
      image: pickStr(a, ["social_images", "profile_image", "avatar", "picture", "avatar_url", "profile_picture"]),
      reauthRequired: Boolean(a.reauth_required ?? a.needs_reauth ?? a.reauthRequired ?? false),
      capabilities: Array.isArray(caps) ? caps.map(String) : isObj(caps) ? Object.keys(caps).filter((k) => Boolean(caps[k])) : [],
      raw: a,
    });
  }
  return out;
}

function toState(s: string | null | undefined): JobState {
  const v = (s ?? "").toLowerCase();
  if (["completed", "success", "succeeded", "published", "done"].includes(v)) return "completed";
  if (["failed", "error", "retryable"].includes(v)) return "failed";
  if (["scheduled", "queued"].includes(v)) return "scheduled";
  if (["pending", "accepted"].includes(v)) return "pending";
  if (["processing", "in_progress", "running", "uploading", "publishing"].includes(v)) return "in_progress";
  if (["cancelled", "canceled", "deleted"].includes(v)) return "cancelled";
  if (v === "not_found") return "not_found";
  return "unknown";
}

/** the per-platform result of a request (array or map, top level or under data/results) */
function platformResult(body: unknown, provider: string): Json | null {
  if (!isObj(body)) return null;
  const pools: unknown[] = [body.results, body.platforms, isObj(body.data) ? body.data.platforms : null, isObj(body.data) ? body.data.results : null, body.data];
  for (const pool of pools) {
    if (Array.isArray(pool)) {
      const hit = (pool as Json[]).find((x) => isObj(x) && String(x.platform ?? x.name ?? "").toLowerCase() === provider);
      if (hit) return hit;
    } else if (isObj(pool) && isObj(pool[provider])) return pool[provider] as Json;
  }
  return null;
}

export function parseUploadResponse(status: number, body: Json, platform: Platform): UploadResult {
  const provider = PLATFORM_META[platform].provider;
  const r = platformResult(body, provider);
  const jobId = pickStr(body, ["job_id", "jobId"]) ?? (isObj(body?.data) ? pickStr(body.data, ["job_id"]) : null);
  const requestId = pickStr(body, ["request_id", "requestId"]) ?? (isObj(body?.data) ? pickStr(body.data, ["request_id"]) : null);
  const err = (r && pickStr(r, ["error", "error_message", "message"])) ?? (body.success === false ? pickStr(body, ["message", "error"]) : null);
  let state: JobState = jobId ? "scheduled" : requestId ? "pending" : "unknown";
  if (r && (r.success === true || pickStr(r, ["url", "post_url"]))) state = "completed";
  if (err && (body.success === false || (r && r.success === false))) state = "failed";
  const warnings = [...asStrings(body.warnings), ...asStrings(r?.warnings)];
  return { jobId, requestId, state, url: r ? pickStr(r, ["url", "post_url", "permalink"]) : null, platformPostId: r ? pickStr(r, ["post_id", "platform_post_id", "media_id", "video_id", "id"]) : null, error: err, warnings, httpStatus: status, raw: body };
}

export function parseStatus(body: Json): JobStatus {
  const st = pickStr(body, ["status", "state"]) ?? (isObj(body?.data) ? pickStr(body.data, ["status"]) : null);
  let state = toState(st);
  // the platform's own result wins over the overall status (partial success of a multi-platform request)
  const pools = [body.results, isObj(body.data) ? body.data.results ?? body.data.platforms : null, body.platforms];
  let r: Json | null = null;
  for (const p of pools) {
    if (Array.isArray(p) && p.length && isObj(p[0])) r = p[0] as Json;
    else if (isObj(p)) r = (Object.values(p).find(isObj) as Json) ?? null;
    if (r) break;
  }
  const err = (r && pickStr(r, ["error", "error_message"])) ?? pickStr(body, ["error", "error_message"]);
  if (r) {
    if (r.success === true || pickStr(r, ["url", "post_url"])) state = "completed";
    else if (r.success === false && err) state = "failed";
  }
  return {
    state,
    url: r ? pickStr(r, ["url", "post_url", "permalink"]) : pickStr(body, ["url", "post_url"]),
    platformPostId: r ? pickStr(r, ["post_id", "platform_post_id", "media_id", "video_id", "id"]) : pickStr(body, ["post_id", "platform_post_id"]),
    error: state === "failed" ? (err ?? "Publikacja nie powiodła się") : null,
    warnings: [...asStrings(body.warnings), ...asStrings(r?.warnings)],
    raw: body,
  };
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : (pickStr(x, ["message", "field"]) ?? JSON.stringify(x)))) : typeof v === "string" ? [v] : []);

const METRICS: Array<[keyof Omit<MetricsResult, "unsupported" | "raw">, string[]]> = [
  ["views", ["views", "video_views", "view_count", "plays", "play_count", "viewCount"]],
  ["reach", ["reach", "accounts_reached", "unique_viewers"]],
  ["impressions", ["impressions", "impression_count"]],
  ["likes", ["likes", "like_count", "reactions", "likeCount", "digg_count"]],
  ["comments", ["comments", "comment_count", "commentCount"]],
  ["shares", ["shares", "share_count", "reposts"]],
  ["saves", ["saves", "saved", "save_count", "favorites"]],
  ["watchTimeSec", ["total_time_watched", "watch_time", "watch_time_sec", "estimatedMinutesWatched_sec"]],
  ["avgViewDurationSec", ["average_time_watched", "avg_view_duration", "average_view_duration", "averageViewDuration"]],
];

/** metrics of one post; a metric missing from the response stays null and is listed as unsupported */
export function parseMetrics(body: unknown, provider: string): MetricsResult {
  let m: unknown = body;
  if (isObj(body)) {
    const pm = body.post_metrics ?? body.metrics ?? (isObj(body.data) ? (body.data.post_metrics ?? body.data) : null);
    const per = isObj(body.platforms) ? body.platforms[provider] : isObj(body.analytics) ? body.analytics[provider] : null;
    m = isObj(per) ? (isObj(per.post_metrics) ? per.post_metrics : per) : isObj(pm) ? (isObj(pm[provider]) ? pm[provider] : pm) : body;
  }
  const out = { unsupported: [] as string[], raw: body } as MetricsResult;
  for (const [k, keys] of METRICS) {
    const v = pickNum(m, keys);
    out[k] = v as never;
    if (v === null) out.unsupported.push(k);
  }
  // YouTube reports minutes
  if (out.watchTimeSec === null) {
    const min = pickNum(m, ["estimatedMinutesWatched", "watch_time_minutes"]);
    if (min !== null) {
      out.watchTimeSec = min * 60;
      out.unsupported = out.unsupported.filter((x) => x !== "watchTimeSec");
    }
  }
  return out;
}
