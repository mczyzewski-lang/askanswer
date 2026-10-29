/**
 * MOCK Upload-Post API (tests only) — the request / response shapes of the official client library
 * (npm "upload-post"): Apikey auth, /api/upload (multipart, Idempotency-Key), /api/uploadposts/status,
 * schedule PATCH / DELETE, users, generate-jwt, pages, comments, analytics. Plus test controls under
 * /uploadpost/_* (force a job state, lose / restore an authorization, swap the connected account).
 * Also the AI answers of Social Media Studio (chat completions with "ZADANIE: SOCIAL_*").
 */
import crypto from "node:crypto";
import type http from "node:http";

export const UP_KEY = "up-mock-key-123";
const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "linkedin"];

interface Job {
  id: string;
  user: string;
  platform: string;
  scheduledDate: string;
  state: "scheduled" | "completed" | "failed" | "cancelled" | "in_progress";
  title: string;
  description: string;
  fields: Record<string, string[]>;
  idempotencyKey: string;
  error?: string;
  url?: string;
  postId?: string;
}
const profiles = new Map<string, Record<string, Record<string, unknown>>>();
const jobs = new Map<string, Job>();
const idem = new Map<string, string>();
const log = { uploads: [] as Array<{ user: string; platform: string; idempotencyKey: string; scheduled_date: string; title: string; description: string; external_id?: string; jobId: string; duplicate: boolean }>, cancels: [] as string[], patches: [] as Array<{ id: string; body: unknown }>, replies: [] as Array<{ path: string; body: unknown }> };
const ownReplies = new Map<string, Array<Record<string, unknown>>>();

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** text fields of a multipart body (file parts are only checked for presence) */
function multipart(buf: Buffer, contentType: string) {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const fields: Record<string, string[]> = {};
  const files: Record<string, number> = {};
  if (!b) return { fields, files };
  const boundary = Buffer.from(`--${b[1] ?? b[2]}`);
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length + 2;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.subarray(start, next - 2);
    const sep = part.indexOf("\r\n\r\n");
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString();
      const name = /name="([^"]+)"/.exec(head)?.[1];
      const isFile = /filename="/.test(head);
      const value = part.subarray(sep + 4);
      if (name) {
        if (isFile) files[name] = value.length;
        else (fields[name] ??= []).push(value.toString());
      }
    }
    pos = next;
  }
  return { fields, files };
}

const id = (p: string) => `${p}_${crypto.randomBytes(6).toString("hex")}`;
const accountId = (user: string, platform: string) => `${platform}_${crypto.createHash("sha1").update(`${user}:${platform}`).digest("hex").slice(0, 10)}`;

export async function uploadPostMock(req: http.IncomingMessage, res: http.ServerResponse, url: URL, json: (code: number, data: unknown) => void) {
  const p = url.pathname.replace(/^\/uploadpost/, "");
  // ---- test controls & the hosted "connect" page (a browser hits it: no API key) ----
  if (p === "/connect" && req.method === "GET") {
    const user = url.searchParams.get("username") ?? "";
    const prof = profiles.get(user);
    if (!prof) return json(404, { message: "Profile not found" });
    for (const pl of (url.searchParams.get("platforms") ?? "").split(",").filter((x) => PLATFORMS.includes(x)))
      prof[pl] = { id: accountId(user, pl), username: `${pl}.test.${user.slice(-4)}`, display_name: `Konto ${pl} (test)`, social_images: null, reauth_required: false, ...(pl === "tiktok" ? { capabilities: ["comments", "music"] } : {}) };
    res.writeHead(302, { location: url.searchParams.get("redirect") ?? "/" });
    return res.end();
  }
  if (p === "/_log") return json(200, { ...log, jobs: [...jobs.values()] });
  if (p === "/_control" && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    const j = jobs.get(b.jobId);
    if (!j) return json(404, { message: "no job" });
    j.state = b.state;
    if (b.state === "completed") {
      j.postId = j.postId ?? id(`${j.platform}post`);
      j.url = `https://${j.platform}.example/p/${j.postId}`;
    }
    if (b.error) j.error = b.error;
    return json(200, { ok: true, job: j });
  }
  if (p === "/_reauth" && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    const a = profiles.get(b.username)?.[b.platform];
    if (!a) return json(404, { message: "no account" });
    a.reauth_required = !!b.reauth;
    return json(200, { ok: true });
  }
  if (p === "/_identity" && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    const a = profiles.get(b.username)?.[b.platform];
    if (!a) return json(404, { message: "no account" });
    a.id = b.id;
    a.username = b.handle ?? a.username;
    return json(200, { ok: true });
  }
  // ---- the API ----
  if (req.headers.authorization !== `Apikey ${UP_KEY}`) return json(401, { success: false, message: "Invalid API key" });
  if (p === "/api/uploadposts/users" && req.method === "GET") return json(200, { success: true, profiles: [...profiles.entries()].map(([username, sa]) => ({ username, social_accounts: Object.fromEntries(PLATFORMS.map((pl) => [pl, sa[pl] ?? ""])) })) });
  if (p === "/api/uploadposts/users" && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    if (!b.username) return json(400, { success: false, message: "username required" });
    if (profiles.has(b.username)) return json(409, { success: false, message: "User already exists" });
    profiles.set(b.username, {});
    return json(201, { success: true, profile: { username: b.username, social_accounts: {} } });
  }
  if (p === "/api/uploadposts/users" && req.method === "DELETE") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    if (!profiles.delete(b.username)) return json(404, { success: false, message: "Not found" });
    return json(200, { success: true });
  }
  if (p === "/api/uploadposts/users/generate-jwt" && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    if (!profiles.has(b.username)) return json(404, { success: false, message: "Profile not found" });
    const u = new URL(`http://127.0.0.1:4010/uploadpost/connect`);
    u.searchParams.set("username", b.username);
    u.searchParams.set("redirect", b.redirect_url);
    u.searchParams.set("platforms", (b.platforms ?? PLATFORMS).join(","));
    return json(200, { success: true, access_url: u.toString(), duration: "48h" });
  }
  if ((p === "/api/uploadposts/facebook/pages" || p === "/api/uploadposts/linkedin/pages") && req.method === "GET") {
    const fb = p.includes("facebook");
    return json(200, { success: true, pages: fb ? [{ id: "fbpage_1", name: "Strona testowa", account_id: "x" }] : [{ id: "urn:li:organization:123", name: "Firma testowa" }] });
  }
  if (p === "/api/upload" && req.method === "POST") {
    const key = String(req.headers["idempotency-key"] ?? "");
    const { fields, files } = multipart(await readBody(req), String(req.headers["content-type"] ?? ""));
    const user = fields.user?.[0] ?? "";
    const platform = fields["platform[]"]?.[0] ?? "";
    if (!files.video) return json(400, { success: false, message: "video is required" });
    const prof = profiles.get(user);
    if (!prof?.[platform]) return json(400, { success: false, message: `No ${platform} account connected for ${user}` });
    if (prof[platform].reauth_required) return json(401, { success: false, message: "Token expired, please reconnect the account (reauth required)" });
    if (key && idem.has(key)) {
      const jid = idem.get(key)!;
      log.uploads.push({ user, platform, idempotencyKey: key, scheduled_date: fields.scheduled_date?.[0] ?? "", title: fields.title?.[0] ?? "", description: fields.description?.[0] ?? "", external_id: fields.external_id?.[0], jobId: jid, duplicate: true });
      return json(202, { success: true, job_id: jid, message: "Duplicate request (idempotency key)" });
    }
    const jid = id("job");
    const j: Job = { id: jid, user, platform, scheduledDate: fields.scheduled_date?.[0] ?? new Date().toISOString(), state: "scheduled", title: fields.title?.[0] ?? "", description: fields.description?.[0] ?? "", fields, idempotencyKey: key };
    jobs.set(jid, j);
    if (key) idem.set(key, jid);
    log.uploads.push({ user, platform, idempotencyKey: key, scheduled_date: j.scheduledDate, title: j.title, description: j.description, external_id: fields.external_id?.[0], jobId: jid, duplicate: false });
    return json(202, { success: true, job_id: jid, scheduled_date: j.scheduledDate });
  }
  if (p === "/api/uploadposts/status" && req.method === "GET") {
    const j = jobs.get(url.searchParams.get("job_id") ?? url.searchParams.get("request_id") ?? "");
    if (!j) return json(404, { success: false, status: "not_found", message: "Job not found" });
    if (j.state === "completed") return json(200, { success: true, status: "completed", results: [{ platform: j.platform, success: true, url: j.url, post_id: j.postId }] });
    if (j.state === "failed") return json(200, { success: true, status: "completed", results: [{ platform: j.platform, success: false, error: j.error ?? "Platform rejected the video" }] });
    return json(200, { success: true, status: j.state, job_id: j.id, scheduled_date: j.scheduledDate });
  }
  const sched = /^\/api\/uploadposts\/schedule\/([^/]+)$/.exec(p);
  if (sched) {
    const j = jobs.get(decodeURIComponent(sched[1]));
    if (!j || j.state !== "scheduled") return json(404, { success: false, message: "Scheduled job not found" });
    if (req.method === "DELETE") {
      j.state = "cancelled";
      log.cancels.push(j.id);
      return json(200, { success: true, message: "Cancelled" });
    }
    if (req.method === "PATCH") {
      const b = JSON.parse((await readBody(req)).toString() || "{}");
      if (b.scheduled_date) j.scheduledDate = b.scheduled_date;
      log.patches.push({ id: j.id, body: b });
      return json(200, { success: true, job_id: j.id, scheduled_date: j.scheduledDate });
    }
  }
  if (p === "/api/uploadposts/post-analytics" && req.method === "GET") {
    // no reach / saves: those must stay null in the app
    return json(200, { success: true, platform: url.searchParams.get("platform"), post_metrics: { views: 1234, likes: 56, comments: 7, shares: 3 } });
  }
  const an = /^\/api\/analytics\/([^/]+)$/.exec(p);
  if (an) {
    const pl = url.searchParams.get("platforms") ?? "instagram";
    return json(200, { success: true, analytics: { [pl]: { followers: 1000 } } });
  }
  if (p === "/api/uploadposts/comments" && req.method === "GET") {
    const postId = url.searchParams.get("post_id") ?? "";
    const base = [
      { id: `c1_${postId}`, text: "Ile kosztuje konsultacja? Chętnie się umówię.", username: "kasia_m", timestamp: new Date(Date.now() - 600e3).toISOString(), like_count: 2 },
      { id: `c2_${postId}`, text: "Świetny materiał, dzięki!", username: "tomek", timestamp: new Date(Date.now() - 300e3).toISOString(), like_count: 5 },
      { id: `c3_${postId}`, text: "Dostałem pozew z sądu, co mam zrobić w mojej sprawie?", username: "marek", timestamp: new Date(Date.now() - 200e3).toISOString(), like_count: 0 },
    ];
    return json(200, { success: true, comments: [...base, ...(ownReplies.get(postId) ?? [])] });
  }
  if ((p === "/api/uploadposts/comments/create" || p === "/api/uploadposts/comments/public-reply" || p === "/api/uploadposts/comments/reply") && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    log.replies.push({ path: p, body: b });
    const rid = id("reply");
    return json(200, { success: true, id: rid });
  }
  return json(404, { success: false, message: `unknown endpoint ${req.method} ${p}` });
}

/** AI answers for Social Media Studio (deterministic) */
export function socialAi(system: string, user: string): unknown | null {
  const task = /ZADANIE: (\S+)/.exec(system)?.[1];
  if (!task?.startsWith("SOCIAL_")) return null;
  if (task === "SOCIAL_POSTS") {
    const platforms = [...system.matchAll(/platform: "([A-Z]+)"/g)].map((m) => m[1]);
    const title = /TYTUŁ FILMU: (.*)/.exec(user)?.[1] ?? "film";
    const mode = /POLECENIE: (.*)/.exec(user)?.[1];
    return {
      posts: platforms.map((pl, i) => ({
        platform: pl,
        title: pl === "YOUTUBE" ? `Tytuł YouTube: ${title}`.slice(0, 100) : "",
        description: mode ? `Nowa wersja ${pl} (${mode.slice(0, 20)}) — ${title}` : `Opis ${pl} [test ${i + 1}]: ${title}. Konkretnie i w tonie marki.`,
        hashtags: ["#test", `#${pl.toLowerCase()}tag`, "#viral"],
        cta: pl === "LINKEDIN" ? "A jak to wygląda u Was?" : "Zapisz na później.",
        firstComment: pl === "INSTAGRAM" ? "Pytanie do Was: co sprawdzić następne?" : "",
        coverSecond: 1,
        coverReason: "Wyraźna twarz i napis",
        youtubeTags: pl === "YOUTUBE" ? ["test", "film testowy"] : [],
        altOpenings: ["Otwarcie lęk", "Otwarcie liczba", "Otwarcie pytanie?"],
      })),
    };
  }
  if (task === "SOCIAL_HOOKS") return { openings: [{ mechanism: "lęk", text: "Boisz się komornika?" }, { mechanism: "liczba", text: "3 rzeczy, które musisz wiedzieć" }, { mechanism: "pytanie", text: "Czy to dotyczy także Ciebie?" }] };
  if (task === "SOCIAL_CLASSIFY") {
    const items = [...user.matchAll(/\[([^\]]+)\][^\n]*\n([^\n]*)/g)].map((m) => ({ id: m[1], text: m[2] }));
    return {
      comments: items.map(({ id, text }) => {
        const t = text.toLowerCase();
        if (/pozew|sąd|sprawie/.test(t)) return { id, category: "needs_human", sentiment: "neutral", isQuestion: true, isLead: false, needsHuman: true, sensitive: ["legal"], language: "pl", reason: "sprawa prawna" };
        if (/kosztuje|umówi|cena/.test(t)) return { id, category: "purchase_intent", sentiment: "positive", isQuestion: true, isLead: true, needsHuman: false, sensitive: [], language: "pl", reason: "pyta o cenę" };
        if (/\?/.test(t)) return { id, category: "question", sentiment: "neutral", isQuestion: true, isLead: false, needsHuman: false, sensitive: [], language: "pl", reason: "pytanie" };
        return { id, category: "positive", sentiment: "positive", isQuestion: false, isLead: false, needsHuman: false, sensitive: [], language: "pl", reason: "podziękowanie" };
      }),
    };
  }
  if (task === "SOCIAL_REPLY") return { reply: "Dziękujemy! Napisz do nas wiadomość prywatną — odpowiemy na szczegóły.", language: "pl", needsHuman: false, reason: "" };
  if (task === "SOCIAL_INSIGHTS") return { observations: ["Filmy z pytaniem w otwarciu mają więcej wyświetleń w tej próbie."], hypotheses: ["Krótsze opisy mogą zwiększać zaangażowanie — do przetestowania."], topics: ["komornik"], openings: ["pytanie"], ctas: ["zapisz"], frequency: "2–3 publikacje tygodniowo", hours: "wieczory w dni robocze (hipoteza)", nextVideos: ["Co komornik może zabrać?"], caveats: ["Mała próba."] };
  return null;
}
