/**
 * DEMO provider: behaves like Upload-Post (profiles, connected accounts, scheduled orders with
 * idempotency keys, publishing at the scheduled time, metrics that grow, comments that arrive) but
 * never leaves this server. State lives in the database (DemoProviderRecord) because the web app
 * and the worker are separate processes. Everything it creates is labelled DEMO and its URLs use
 * the reserved ".invalid" domain.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { env } from "../../env";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import type { EditInput, JobStatus, MetricsResult, ProviderAccount, ProviderComment, SocialProvider, UploadInput, UploadResult } from "./types";

type Rec = Record<string, unknown>;

async function getRec<T = Rec>(key: string): Promise<T | null> {
  const r = await prisma.demoProviderRecord.findUnique({ where: { key } });
  return (r?.data as T) ?? null;
}
async function putRec(kind: string, key: string, data: unknown) {
  await prisma.demoProviderRecord.upsert({ where: { key }, create: { kind, key, data: data as Prisma.InputJsonValue }, update: { data: data as Prisma.InputJsonValue } });
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest();
const rand = (seed: string, i = 0) => hash(`${seed}:${i}`).readUInt32BE(0) / 0xffffffff;

interface DemoJob {
  id: string;
  profile: string;
  platform: Platform;
  scheduledAt: string;
  state: "scheduled" | "completed" | "failed" | "cancelled";
  title: string;
  caption: string;
  idempotencyKey: string;
  url?: string;
  platformPostId?: string;
  publishedAt?: string;
  error?: string;
}

const DEMO_NAMES: Record<Platform, string> = { INSTAGRAM: "demo.instagram", TIKTOK: "demo.tiktok", YOUTUBE: "Kanał DEMO", FACEBOOK: "Strona DEMO", LINKEDIN: "Firma DEMO" };

/** connect demo accounts to a profile (the DEMO "OAuth" page calls this) */
export async function demoConnect(profile: string, platforms: Platform[], label: string) {
  const cur = (await getRec<{ accounts: ProviderAccount[] }>(`profile:${profile}`)) ?? { accounts: [] };
  const byPlatform = new Map(cur.accounts.map((a) => [a.platform, a]));
  for (const p of platforms) {
    const slug = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "") || "demo";
    byPlatform.set(p, {
      platform: p,
      platformAccountId: `demo_${PLATFORM_META[p].provider}_${hash(`${profile}:${p}`).toString("hex").slice(0, 10)}`,
      handle: `${slug}.${PLATFORM_META[p].short.toLowerCase()}`,
      displayName: `${label} · ${DEMO_NAMES[p]}`,
      image: null,
      reauthRequired: false,
      capabilities: p === "TIKTOK" ? ["comments", "music", "location"] : [],
      raw: { demo: true },
    });
  }
  await putRec("profile", `profile:${profile}`, { accounts: [...byPlatform.values()] });
}

/** simulate a lost / restored authorization (scenario tests, demo) */
export async function demoSetReauth(profile: string, platform: Platform, reauth: boolean) {
  const cur = await getRec<{ accounts: ProviderAccount[] }>(`profile:${profile}`);
  if (!cur) return;
  await putRec("profile", `profile:${profile}`, { accounts: cur.accounts.map((a) => (a.platform === platform ? { ...a, reauthRequired: reauth } : a)) });
}

export async function demoDisconnect(profile: string, platform: Platform) {
  const cur = await getRec<{ accounts: ProviderAccount[] }>(`profile:${profile}`);
  if (!cur) return;
  await putRec("profile", `profile:${profile}`, { accounts: cur.accounts.filter((a) => a.platform !== platform) });
}

/** demo orders whose time has come and that were not "delivered" as a webhook yet */
export async function dueDemoJobs(now = new Date()): Promise<DemoJob[]> {
  const rows = await prisma.demoProviderRecord.findMany({ where: { kind: "job" } });
  return rows.map((r) => r.data as unknown as DemoJob).filter((j) => j.state === "scheduled" && new Date(j.scheduledAt) <= now);
}

const COMMENTS = [
  { text: "Super wytłumaczone, dzięki! 👏", author: "Kasia M." },
  { text: "A ile to kosztuje? Gdzie mogę się umówić na konsultację?", author: "Tomasz W." },
  { text: "Czy to dotyczy też osób, które prowadziły kiedyś firmę?", author: "Agnieszka" },
  { text: "Bzdury, u mnie nic takiego nie zadziałało.", author: "anon_1987" },
  { text: "Mam podobną sprawę w sądzie, czy możecie pomóc? Pozew dostałem wczoraj.", author: "Marek K." },
  { text: "Zarabiaj 5000 zł dziennie! Link w bio 💰💰", author: "promo_bot_77" },
  { text: "Wysłałam to mamie, bardzo potrzebne ❤️", author: "Ola" },
  { text: "Proszę o kontakt, mój numer to 600 100 200", author: "Piotr" },
];

export class DemoProvider implements SocialProvider {
  readonly name = "demo" as const;
  readonly live = false;

  async createProfile(username: string) {
    if (!(await getRec(`profile:${username}`))) await putRec("profile", `profile:${username}`, { accounts: [] });
  }
  async deleteProfile(username: string) {
    await prisma.demoProviderRecord.deleteMany({ where: { key: `profile:${username}` } });
  }
  async getProfile(username: string) {
    const r = await getRec<{ accounts: ProviderAccount[] }>(`profile:${username}`);
    return r ? { username, accounts: r.accounts } : null;
  }
  async connectUrl(username: string, o: { redirectUrl: string; platforms: Platform[] }) {
    const u = new URL(`${env.appUrl}/social/demo-connect`);
    u.searchParams.set("profile", username);
    u.searchParams.set("redirect", o.redirectUrl);
    u.searchParams.set("platforms", o.platforms.join(","));
    return u.toString();
  }
  async pages(username: string, platform: "FACEBOOK" | "LINKEDIN") {
    const base = hash(`${username}:${platform}`).toString("hex").slice(0, 8);
    return platform === "FACEBOOK"
      ? [
          { id: `demo_page_${base}_1`, name: "Strona firmowa (DEMO)" },
          { id: `demo_page_${base}_2`, name: "Druga strona (DEMO)" },
        ]
      : [
          { id: "me", name: "Profil osobisty (DEMO)" },
          { id: `urn:li:organization:demo${base}`, name: "Strona firmy (DEMO)" },
        ];
  }

  async upload(i: UploadInput): Promise<UploadResult> {
    // same key = same order, like the real API
    const existing = await getRec<{ jobId: string }>(`idem:${i.idempotencyKey}`);
    if (existing) {
      const j = await getRec<DemoJob>(`job:${existing.jobId}`);
      return { jobId: existing.jobId, requestId: null, state: j?.state === "completed" ? "completed" : j?.state === "failed" ? "failed" : "scheduled", httpStatus: 202, raw: { demo: true, duplicate: true, job_id: existing.jobId } };
    }
    const prof = await this.getProfile(i.profile);
    if (!prof?.accounts.some((a) => a.platform === i.platform)) return { jobId: null, requestId: null, state: "failed", error: `Konto ${PLATFORM_META[i.platform].name} nie jest połączone (DEMO)`, httpStatus: 400, raw: { demo: true } };
    if (prof.accounts.find((a) => a.platform === i.platform)?.reauthRequired) return { jobId: null, requestId: null, state: "failed", error: "Konto wymaga ponownej autoryzacji (DEMO)", httpStatus: 401, raw: { demo: true } };
    const id = `demo_job_${crypto.randomBytes(8).toString("hex")}`;
    const job: DemoJob = { id, profile: i.profile, platform: i.platform, scheduledAt: i.scheduledAt.toISOString(), state: "scheduled", title: i.title, caption: i.caption, idempotencyKey: i.idempotencyKey };
    await putRec("job", `job:${id}`, job);
    await putRec("idem", `idem:${i.idempotencyKey}`, { jobId: id });
    return { jobId: id, requestId: null, state: "scheduled", httpStatus: 202, raw: { demo: true, success: true, job_id: id } };
  }

  async status(ref: { jobId?: string | null; requestId?: string | null }): Promise<JobStatus> {
    const j = ref.jobId ? await getRec<DemoJob>(`job:${ref.jobId}`) : null;
    if (!j) return { state: "not_found", raw: { demo: true } };
    if (j.state === "scheduled" && new Date(j.scheduledAt) <= new Date()) {
      // publish now (a caption with [DEMO-FAIL] simulates a platform rejection)
      if (/\[DEMO-FAIL\]/.test(j.caption) || /\[DEMO-FAIL\]/.test(j.title)) {
        j.state = "failed";
        j.error = "Platforma odrzuciła publikację (symulacja DEMO)";
      } else {
        j.state = "completed";
        j.platformPostId = `demo_${PLATFORM_META[j.platform].provider}_${j.id.slice(-10)}`;
        j.url = `https://demo.invalid/${PLATFORM_META[j.platform].provider}/${j.platformPostId}`;
        j.publishedAt = new Date().toISOString();
      }
      await putRec("job", `job:${j.id}`, j);
    }
    return { state: j.state, url: j.url ?? null, platformPostId: j.platformPostId ?? null, error: j.error ?? null, warnings: [], raw: { demo: true, ...j } };
  }

  async editScheduled(jobId: string, e: EditInput) {
    const j = await getRec<DemoJob>(`job:${jobId}`);
    if (!j || j.state !== "scheduled") throw new Error("Zlecenie DEMO nie jest już zaplanowane");
    if (e.scheduledAt) j.scheduledAt = e.scheduledAt.toISOString();
    if (e.caption !== undefined) j.caption = e.caption;
    if (e.title !== undefined) j.title = e.title;
    await putRec("job", `job:${jobId}`, j);
  }

  async cancelScheduled(jobId: string) {
    const j = await getRec<DemoJob>(`job:${jobId}`);
    if (!j || j.state !== "scheduled") return false;
    j.state = "cancelled";
    await putRec("job", `job:${jobId}`, j);
    return true;
  }

  async postMetrics(r: { platform: Platform; platformPostId: string | null }): Promise<MetricsResult> {
    const id = r.platformPostId ?? "x";
    const job = (await prisma.demoProviderRecord.findMany({ where: { kind: "job" } })).map((x) => x.data as unknown as DemoJob).find((j) => j.platformPostId === id);
    const hours = job?.publishedAt ? Math.max(0, (Date.now() - new Date(job.publishedAt).getTime()) / 3600e3) : 1;
    const scale = 800 + rand(id) * 9000;
    const views = Math.round(scale * (1 - Math.exp(-(hours + 1) / 40)));
    const like = 0.03 + rand(id, 1) * 0.05;
    const base = { views, reach: Math.round(views * 0.82), impressions: Math.round(views * 1.4), likes: Math.round(views * like), comments: Math.round(views * like * 0.12), shares: Math.round(views * like * 0.2), saves: Math.round(views * like * 0.25), watchTimeSec: Math.round(views * (8 + rand(id, 2) * 14)), avgViewDurationSec: Math.round((8 + rand(id, 2) * 14) * 10) / 10 };
    const unsupportedBy: Record<Platform, Array<keyof typeof base>> = {
      INSTAGRAM: ["impressions", "watchTimeSec", "avgViewDurationSec"],
      TIKTOK: ["impressions", "saves"],
      YOUTUBE: ["reach", "impressions", "saves", "shares"],
      FACEBOOK: ["saves", "impressions"],
      LINKEDIN: ["reach", "saves", "watchTimeSec", "avgViewDurationSec"],
    };
    const unsupported = unsupportedBy[r.platform];
    const out: MetricsResult = { views: null, reach: null, impressions: null, likes: null, comments: null, shares: null, saves: null, watchTimeSec: null, avgViewDurationSec: null, unsupported: unsupported as string[], raw: { demo: true, hours } };
    for (const k of Object.keys(base) as Array<keyof typeof base>) if (!unsupported.includes(k)) (out as unknown as Record<string, number>)[k] = base[k];
    return out;
  }

  async accountFollowers(profile: string, platform: Platform) {
    const days = Math.floor(Date.now() / 86400e3);
    return Math.round(1200 + rand(`${profile}:${platform}`) * 20000 + (days % 1000) * 3);
  }

  async comments(r: { platform: Platform; postId: string | null }): Promise<{ comments: ProviderComment[]; next: string | null }> {
    const id = r.postId ?? "";
    const job = (await prisma.demoProviderRecord.findMany({ where: { kind: "job" } })).map((x) => x.data as unknown as DemoJob).find((j) => j.platformPostId === id);
    if (!job?.publishedAt) return { comments: [], next: null };
    const hours = (Date.now() - new Date(job.publishedAt).getTime()) / 3600e3;
    const visible = Math.min(COMMENTS.length, 2 + Math.floor(hours * 2));
    const start = Math.floor(rand(id) * COMMENTS.length);
    const out: ProviderComment[] = [];
    for (let n = 0; n < visible; n++) {
      const c = COMMENTS[(start + n) % COMMENTS.length];
      out.push({ id: `demo_c_${id.slice(-8)}_${n}`, parentId: null, text: c.text, authorName: c.author, authorHandle: c.author.toLowerCase().replace(/[^a-z0-9_]/g, ""), authorId: `demo_u_${n}`, createdAt: new Date(new Date(job.publishedAt).getTime() + n * 20 * 60e3), likeCount: Math.floor(rand(id, n) * 12), raw: { demo: true } });
    }
    const own = (await getRec<{ list: ProviderComment[] }>(`replies:${id}`))?.list ?? [];
    return { comments: [...out, ...own.map((x) => ({ ...x, createdAt: new Date(x.createdAt) }))], next: null };
  }

  async reply(r: { platform: Platform; message: string; commentId: string | null; postId: string | null }) {
    const key = `replies:${r.postId ?? "unknown"}`;
    const cur = (await getRec<{ list: ProviderComment[] }>(key))?.list ?? [];
    const id = `demo_r_${crypto.randomBytes(6).toString("hex")}`;
    cur.push({ id, parentId: r.commentId, text: r.message, authorName: "Twoje konto (DEMO)", authorHandle: "me", authorId: "me", createdAt: new Date(), likeCount: 0, raw: { demo: true, own: true } });
    await putRec("replies", key, { list: cur });
    return { id };
  }

  async privateReply() {
    return { id: `demo_dm_${crypto.randomBytes(6).toString("hex")}` };
  }
}
