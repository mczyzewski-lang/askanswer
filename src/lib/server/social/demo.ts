/**
 * DEMO data: organization "AV Holding (DEMO)" with three projects, demo accounts, a generated demo
 * film each, published posts with metrics and comments, and drafts waiting for approval. Every row
 * is flagged isDemo and goes only to the mock provider, so nothing can be published for real.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { run } from "../ffmpeg";
import { makeTempDir, putFile } from "../storage";
import type { Platform } from "@/lib/social/platforms";
import { demoConnect } from "./provider/mock";
import { profileUsername, syncProfile } from "./accounts";
import { createOrganization, createProject } from "./projects";
import { addTarget, contentHashOf } from "./posts";
import { mediaKey, processMedia } from "./media";

const PROJECTS: Array<{ name: string; platforms: Platform[]; brand: Partial<Prisma.BrandSettingsCreateInput>; film: string }> = [
  {
    name: "Nowy Etap",
    platforms: ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "LINKEDIN"],
    brand: { description: "Kancelaria pomagająca osobom zadłużonym wyjść na prostą (upadłość konsumencka, restrukturyzacja).", audience: "Osoby z długami, które nie dają rady spłacać rat; 30–55 lat.", goal: "Zgłoszenia na bezpłatną analizę sytuacji.", tone: "Spokojny, rzeczowy, bez oceniania; prosty język.", website: "nowyetap.example", products: "Bezpłatna analiza, prowadzenie upadłości konsumenckiej.", usp: "Analiza w 24 h, prowadzimy sprawę od początku do końca.", preferredCta: "Napisz ANALIZA w wiadomości", forbiddenPhrases: ["gwarantujemy", "umorzymy wszystko"], keywords: ["upadłość konsumencka", "długi", "komornik"] },
    film: "Czy komornik może zabrać całą pensję?",
  },
  {
    name: "Risify",
    platforms: ["INSTAGRAM", "TIKTOK", "YOUTUBE"],
    brand: { description: "Aplikacja do oceny ryzyka finansowego małych firm.", audience: "Właściciele małych firm i księgowi.", goal: "Rejestracje w aplikacji.", tone: "Konkretny, nowoczesny, z humorem.", website: "risify.example", products: "Aplikacja Risify (14 dni za darmo).", preferredCta: "Sprawdź Risify — link w bio", keywords: ["płynność finansowa", "ryzyko", "faktury"] },
    film: "3 sygnały, że Twój klient nie zapłaci faktury",
  },
  {
    name: "Pravna",
    platforms: ["FACEBOOK", "INSTAGRAM", "LINKEDIN"],
    brand: { description: "Portal z prostymi wyjaśnieniami prawa dla firm i konsumentów.", audience: "Przedsiębiorcy i osoby prywatne szukające odpowiedzi na pytania prawne.", goal: "Ruch na portal i zapisy do newslettera.", tone: "Ekspercki, ale przystępny.", website: "pravna.example", preferredCta: "Zapisz, żeby nie zgubić", forbiddenPhrases: ["porada prawna gratis"], keywords: ["prawo pracy", "umowy", "RODO"] },
    film: "Umowa o dzieło czy zlecenie? 30 sekund",
  },
];

async function demoFilm(label: string, file: string) {
  const text = label.replace(/[:'\\]/g, " ");
  await run(env.ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-vf", `drawbox=x=0:y=760:w=1080:h=400:color=black@0.6:t=fill,drawtext=text='DEMO':fontcolor=white:fontsize=140:x=(w-text_w)/2:y=800,drawtext=text='${text.slice(0, 40)}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=1010`, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]).catch(async () => {
    // drawtext needs a font — without one, a plain test pattern
    await run(env.ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  });
}

export async function demoExists() {
  return !!(await prisma.organization.findFirst({ where: { isDemo: true } }));
}

export async function seedDemo(ownerId: string) {
  const existing = await prisma.organization.findFirst({ where: { isDemo: true } });
  if (existing) return existing;
  const org = await createOrganization("AV Holding (DEMO)", ownerId, { isDemo: true });
  const dir = await makeTempDir("smdemo");
  try {
    for (const [pi, def] of PROJECTS.entries()) {
      const project = await createProject(org.id, def.name, ownerId, { isDemo: true });
      await prisma.brandSettings.update({ where: { projectId: project.id }, data: def.brand as Prisma.BrandSettingsUpdateInput });
      const username = profileUsername(project.id, 1);
      const profile = await prisma.providerProfile.create({ data: { projectId: project.id, username, label: "Główny", isDemo: true } });
      await demoConnect(username, def.platforms, def.name);
      await syncProfile(profile.id, ownerId);
      for (const a of await prisma.socialAccount.findMany({ where: { projectId: project.id, platform: { in: ["FACEBOOK", "LINKEDIN"] } } })) await prisma.socialAccount.update({ where: { id: a.id }, data: { pageId: a.platform === "FACEBOOK" ? `demo_page_${pi}` : `urn:li:organization:demo${pi}`, pageName: `${def.name} (strona DEMO)` } });
      // a demo film
      const media = await prisma.socialMedia.create({ data: { projectId: project.id, uploadedById: ownerId, title: def.film, description: "Film demonstracyjny (DEMO).", originalName: "demo.mp4", storageKey: `pending/${project.id}/${Date.now()}`, status: "PROCESSING", isDemo: true, transcript: `${def.film}. To jest film demonstracyjny Social Media Studio — w prawdziwym projekcie tutaj byłaby transkrypcja wypowiedzi eksperta.` } });
      const file = path.join(dir, `demo-${pi}.mp4`);
      await demoFilm(def.film, file);
      const key = mediaKey(project.id, media.id, "original.mp4");
      const size = await putFile(key, file, "video/mp4");
      await prisma.socialMedia.update({ where: { id: media.id }, data: { storageKey: key, sizeBytes: BigInt(size) } });
      await processMedia(media.id);
      const accounts = await prisma.socialAccount.findMany({ where: { projectId: project.id } });
      // 1) a film already published (2 days ago) with metrics and comments
      const pubItem = await prisma.contentItem.create({ data: { projectId: project.id, mediaId: media.id, title: `${def.film} (opublikowany)`, createdById: ownerId, isDemo: true } });
      for (const a of accounts) {
        const post = await addTarget(pubItem.id, a.id, ownerId);
        const at = new Date(Date.now() - (2 + pi) * 86400e3);
        const jobId = `demo_job_seed_${post.id}`;
        const platformPostId = `demo_${a.platform.toLowerCase()}_${post.id.slice(-10)}`;
        await prisma.demoProviderRecord.create({ data: { kind: "job", key: `job:${jobId}`, data: { id: jobId, profile: username, platform: a.platform, scheduledAt: at.toISOString(), state: "completed", title: def.film, caption: def.film, idempotencyKey: `seed-${post.id}`, platformPostId, url: `https://demo.invalid/${a.platform.toLowerCase()}/${platformPostId}`, publishedAt: at.toISOString() } } });
        const description = `${def.film} — wyjaśniamy w 30 sekund. (DEMO)`;
        const hashtags = def.brand.keywords ? (def.brand.keywords as string[]).slice(0, 3).map((k) => `#${k.replace(/\s+/g, "")}`) : [];
        const full = await prisma.platformPost.update({ where: { id: post.id }, data: { description, hashtags, cta: (def.brand.preferredCta as string) ?? "", scheduledAt: at, status: "PUBLISHED", publishedAt: at, publishedUrl: `https://demo.invalid/${a.platform.toLowerCase()}/${platformPostId}`, platformPostId, nextMetricsAt: new Date(), nextCommentsAt: new Date() }, include: { socialAccount: true, contentItem: true } });
        const hash = contentHashOf({ ...full, mediaId: media.id, account: full.socialAccount });
        await prisma.platformPost.update({ where: { id: post.id }, data: { contentHash: hash, approvedHash: hash, approvedRevision: full.revision, approvedAt: at, approvedById: ownerId } });
        await prisma.approval.create({ data: { platformPostId: post.id, revision: full.revision, contentHash: hash, decision: "APPROVED", comment: "DEMO", userId: ownerId, createdAt: at } });
        await prisma.scheduledPublication.create({ data: { platformPostId: post.id, platform: a.platform, socialAccountId: a.id, providerProfileUsername: username, providerJobId: jobId, externalId: `smp_${post.id}_1`, idempotencyKey: `seed-${post.id}`, generation: 1, scheduledAt: at, status: "PUBLISHED", contentHash: hash, publishedUrl: full.publishedUrl, platformPostId_native: platformPostId, isDemo: true } });
      }
      // 2) a film waiting for approval (tomorrow 18:00 UTC)
      const nextItem = await prisma.contentItem.create({ data: { projectId: project.id, mediaId: media.id, title: `${def.film} — nowa wersja`, goal: (def.brand.goal as string) ?? "", createdById: ownerId, isDemo: true } });
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1 + pi);
      tomorrow.setUTCHours(16, 30, 0, 0);
      for (const a of accounts.slice(0, 2)) {
        const post = await addTarget(nextItem.id, a.id, ownerId);
        const full = await prisma.platformPost.update({ where: { id: post.id }, data: { description: `Szkic publikacji DEMO na ${a.platform}: ${def.film}`, hashtags: ["#demo"], cta: (def.brand.preferredCta as string) ?? "", scheduledAt: tomorrow, status: "PENDING_APPROVAL" }, include: { socialAccount: true } });
        await prisma.platformPost.update({ where: { id: post.id }, data: { contentHash: contentHashOf({ ...full, mediaId: media.id, account: full.socialAccount }) } });
      }
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  return org;
}
