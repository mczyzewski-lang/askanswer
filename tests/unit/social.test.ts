import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { can, permissionsOf } from "@/lib/social/rbac";
import { zonedToUtc, utcToZonedInput, dayKey, weekdayInTz, hourInTz } from "@/lib/social/tz";
import { checkPostText, checkVideo, composeCaption, normalizeHashtags } from "@/lib/social/rules";
import { verifySignature, signatureCandidates, parseTimestamp, normalizeEvent } from "@/lib/server/social/webhooks";
import { parseMetrics, parseStatus, parseUploadResponse, platformFields, pickNum } from "@/lib/server/social/provider/upload-post";
import { contentHashOf } from "@/lib/server/social/posts";
import { dueCheckpoint, engagementRate } from "@/lib/server/social/analytics";
import { nextPollAt } from "@/lib/server/social/comments";
import { redactPersonal } from "@/lib/server/social/ai";
import { isPrivateAddress } from "@/lib/server/social/media";

describe("rbac", () => {
  it("roles combine; an approver cannot edit, an editor cannot approve", () => {
    expect(can(["APPROVER"], "content.approve")).toBe(true);
    expect(can(["APPROVER"], "content.edit")).toBe(false);
    expect(can(["EDITOR"], "content.approve")).toBe(false);
    expect(can(["EDITOR", "APPROVER"], "content.approve")).toBe(true);
    expect(can(["VIEWER"], "comments.reply")).toBe(false);
    expect(can(["ADMIN"], "project.delete")).toBe(false);
    expect(can(["OWNER"], "project.delete")).toBe(true);
    expect(permissionsOf([]).size).toBe(0);
  });
});

describe("time zones (Europe/Warsaw)", () => {
  it("wall clock ↔ UTC across summer / winter time", () => {
    expect(zonedToUtc("2026-07-01T18:30", "Europe/Warsaw").toISOString()).toBe("2026-07-01T16:30:00.000Z");
    expect(zonedToUtc("2026-12-01T18:30", "Europe/Warsaw").toISOString()).toBe("2026-12-01T17:30:00.000Z");
    expect(utcToZonedInput("2026-07-01T16:30:00Z", "Europe/Warsaw")).toBe("2026-07-01T18:30");
    // the night of the change back (25.10.2026): 02:30 exists twice — the first one is used
    expect(utcToZonedInput(zonedToUtc("2026-10-25T03:30", "Europe/Warsaw"), "Europe/Warsaw")).toBe("2026-10-25T03:30");
    expect(dayKey("2026-12-31T23:30:00Z", "Europe/Warsaw")).toBe("2027-01-01");
    expect(weekdayInTz("2026-11-02T10:00:00Z", "Europe/Warsaw")).toBe(0); // Monday
    expect(hourInTz("2026-11-02T10:00:00Z", "Europe/Warsaw")).toBe(11);
  });
});

describe("platform rules", () => {
  it("hashtags: normalised, deduplicated, generic ones removed", () => {
    expect(normalizeHashtags(["#Upadłość konsumencka", "upadłośćkonsumencka", "#viral", "fyp", "#komornik!", ""])).toEqual(["#Upadłośćkonsumencka", "#komornik"]);
  });
  it("caption = text + CTA + hashtags (no duplicates)", () => {
    expect(composeCaption({ description: "Tekst.", cta: "Zapisz.", hashtags: ["#a", "#b"] })).toBe("Tekst.\n\nZapisz.\n\n#a #b");
    expect(composeCaption({ description: "Tekst. Zapisz.", cta: "Zapisz.", hashtags: [] })).toBe("Tekst. Zapisz.");
  });
  it("text limits, YouTube title, forbidden phrases", () => {
    const long = "x".repeat(2300);
    expect(checkPostText("INSTAGRAM", { description: long, hashtags: [] }).some((i) => i.level === "error")).toBe(true);
    expect(checkPostText("YOUTUBE", { description: "ok", hashtags: [], title: "" }).some((i) => i.field === "title")).toBe(true);
    expect(checkPostText("LINKEDIN", { description: "Gwarantujemy wynik", hashtags: [] }, ["gwarantujemy"]).some((i) => i.message.includes("Zakazane"))).toBe(true);
    expect(checkPostText("TIKTOK", { description: "Dobry opis", hashtags: ["#a", "#b", "#c"] }).filter((i) => i.level === "error")).toEqual([]);
  });
  it("video checks per platform", () => {
    const vertical = { durationSec: 40, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sizeBytes: 30e6 };
    expect(checkVideo("INSTAGRAM", vertical).ok).toBe(true);
    expect(checkVideo("FACEBOOK", { ...vertical, durationSec: 120 }).warnings.join(" ")).toContain("zwykły post");
    expect(checkVideo("YOUTUBE", { ...vertical, durationSec: 240 }).ok).toBe(false);
    const landscape = checkVideo("TIKTOK", { ...vertical, width: 1920, height: 1080 });
    expect(landscape.conversion).toBe("vertical-1080");
    expect(checkVideo("YOUTUBE", { ...vertical, width: 1920, height: 1080 }).ok).toBe(false);
    expect(checkVideo("LINKEDIN", { ...vertical, width: 1920, height: 1080 }).ok).toBe(true);
    expect(checkVideo("INSTAGRAM", { ...vertical, durationSec: 1 }).ok).toBe(false);
  });
});

describe("webhook signature", () => {
  const secret = "whsec_test_0123456789";
  const body = JSON.stringify({ event: "upload_completed", job_id: "j1" });
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  it("accepts hex, sha256=hex, base64 and timestamped signatures; rejects anything else", () => {
    expect(verifySignature(body, hex, null, secret)).toBe(true);
    expect(verifySignature(body, `sha256=${hex}`, null, secret)).toBe(true);
    expect(verifySignature(body, crypto.createHmac("sha256", secret).update(body).digest("base64"), null, secret)).toBe(true);
    const ts = String(Math.floor(Date.now() / 1000));
    const tsSig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(verifySignature(body, `t=${ts},v1=${tsSig}`, null, secret)).toBe(true);
    expect(verifySignature(body, tsSig, ts, secret)).toBe(true);
    expect(verifySignature(body, hex, null, "other-secret")).toBe(false);
    expect(verifySignature(`${body} `, hex, null, secret)).toBe(false);
    expect(verifySignature(body, null, null, secret)).toBe(false);
    expect(signatureCandidates("t=1,v1=a,v1=b").sigs).toEqual(["a", "b"]);
  });
  it("timestamps and event names", () => {
    expect(parseTimestamp("1700000000")).toBe(1700000000);
    expect(parseTimestamp("1700000000000")).toBe(1700000000);
    expect(parseTimestamp("2023-11-14T22:13:20Z")).toBe(1700000000);
    expect(normalizeEvent("social_account.reauth_required")).toBe("social_account_reauth_required");
  });
});

describe("Upload-Post responses", () => {
  it("scheduled upload → job id; immediate result per platform", () => {
    expect(parseUploadResponse(202, { success: true, job_id: "job_1" }, "TIKTOK")).toMatchObject({ jobId: "job_1", state: "scheduled" });
    const done = parseUploadResponse(200, { success: true, request_id: "r1", results: [{ platform: "instagram", success: true, url: "https://ig/p/1", post_id: "123" }] }, "INSTAGRAM");
    expect(done).toMatchObject({ requestId: "r1", state: "completed", url: "https://ig/p/1", platformPostId: "123" });
    expect(parseUploadResponse(200, { success: false, results: [{ platform: "youtube", success: false, error: "quota" }] }, "YOUTUBE").state).toBe("failed");
  });
  it("status: partial success reads the platform's own result", () => {
    expect(parseStatus({ status: "completed", results: [{ platform: "tiktok", success: false, error: "Video too long" }] })).toMatchObject({ state: "failed", error: "Video too long" });
    expect(parseStatus({ status: "scheduled" }).state).toBe("scheduled");
    expect(parseStatus({ status: "in_progress" }).state).toBe("in_progress");
  });
  it("metrics: missing ones stay null and are listed as unsupported", () => {
    const m = parseMetrics({ post_metrics: { views: 120, likes: "7", comments: 2 } }, "instagram");
    expect(m.views).toBe(120);
    expect(m.likes).toBe(7);
    expect(m.reach).toBeNull();
    expect(m.unsupported).toContain("reach");
    expect(m.unsupported).not.toContain("views");
    expect(pickNum({ a: { value: 3 } }, ["a"])).toBe(3);
  });
  it("platform options → form fields", () => {
    expect(platformFields({ platform: "YOUTUBE", options: { youtubeTags: ["a", "b"], youtubePrivacy: "unlisted" }, pageId: null, coverTimestamp: null })).toMatchObject({ "tags[]": ["a", "b"], privacyStatus: "unlisted" });
    expect(platformFields({ platform: "FACEBOOK", options: {}, pageId: "p1", coverTimestamp: null })).toMatchObject({ facebook_page_id: "p1", facebook_media_type: "REELS" });
    expect(platformFields({ platform: "INSTAGRAM", options: {}, pageId: null, coverTimestamp: 1.5 })).toMatchObject({ media_type: "REELS", thumb_offset: 1500 });
  });
});

describe("approval hash", () => {
  const base = { title: "", description: "Opis", hashtags: ["#a"], cta: "Zapisz", firstComment: "", coverTimestamp: null, options: { b: 1, a: 2, _ai: { x: 1 } }, mediaVariantId: null, scheduledAt: new Date("2026-11-03T17:00:00Z"), socialAccountId: "acc1", mediaId: "m1", account: { platformAccountId: "ig_1", pageId: null } };
  it("changes with text, date, file, account identity and page — not with AI notes or key order", () => {
    const h = contentHashOf(base);
    expect(contentHashOf({ ...base, options: { a: 2, b: 1, _ai: { y: 2 } } })).toBe(h);
    expect(contentHashOf({ ...base, description: "Opis!" })).not.toBe(h);
    expect(contentHashOf({ ...base, scheduledAt: new Date("2026-11-03T18:00:00Z") })).not.toBe(h);
    expect(contentHashOf({ ...base, mediaVariantId: "v1" })).not.toBe(h);
    expect(contentHashOf({ ...base, account: { platformAccountId: "ig_2", pageId: null } })).not.toBe(h);
    expect(contentHashOf({ ...base, account: { platformAccountId: "ig_1", pageId: "page" } })).not.toBe(h);
  });
});

describe("monitoring schedule", () => {
  const pub = new Date("2026-11-01T10:00:00Z");
  it("checkpoints 1h / 24h / 72h / 7d / 30d", () => {
    expect(dueCheckpoint(pub, [], new Date("2026-11-01T10:30:00Z"))).toEqual({ due: null, next: new Date("2026-11-01T11:00:00Z") });
    expect(dueCheckpoint(pub, [], new Date("2026-11-01T11:05:00Z")).due).toBe("1h");
    expect(dueCheckpoint(pub, ["1h"], new Date("2026-11-02T10:05:00Z")).due).toBe("24h");
    expect(dueCheckpoint(pub, ["1h", "24h", "72h", "7d", "30d"], new Date("2026-12-15T10:00:00Z"))).toEqual({ due: null, next: null });
  });
  it("engagement rate never invents data", () => {
    expect(engagementRate({ views: 100, impressions: null, likes: 5, comments: 1, shares: null, saves: null })).toBe(0.06);
    expect(engagementRate({ views: null, impressions: null, likes: 5, comments: 1, shares: null, saves: null })).toBeNull();
    expect(engagementRate({ views: 100, impressions: null, likes: null, comments: null, shares: null, saves: null })).toBeNull();
  });
  it("comment polling slows down with age; webhook platforms are polled half as often", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(nextPollAt(new Date("2026-11-01T11:00:00Z"), "FACEBOOK", now)!.getTime() - now.getTime()).toBe(15 * 60e3);
    expect(nextPollAt(new Date("2026-11-01T11:00:00Z"), "INSTAGRAM", now)!.getTime() - now.getTime()).toBe(30 * 60e3);
    expect(nextPollAt(new Date("2026-10-28T12:00:00Z"), "YOUTUBE", now)!.getTime() - now.getTime()).toBe(3600e3);
    expect(nextPollAt(new Date("2026-06-01T12:00:00Z"), "YOUTUBE", now)).toBeNull();
  });
});

describe("privacy and SSRF", () => {
  it("personal data is removed before AI", () => {
    const r = redactPersonal("Mój numer 600 100 200, mail jan.kowalski@example.com, PESEL 85010112345, konto PL61109010140000071219812874 @kasia https://x.pl");
    expect(r).not.toMatch(/600 100 200|jan\.kowalski|85010112345|61109010140000071219812874|@kasia|x\.pl/);
  });
  it("private / local addresses are refused", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});
