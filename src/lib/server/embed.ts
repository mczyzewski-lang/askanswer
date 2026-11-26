/**
 * Films embedded on other websites: a public player page (cover, a calm pulsing play button, the
 * published MP4 - with or without the end card), an iframe code per film, and what the player
 * reports back (covers shown, plays, how far people watched, on which page).
 * No cookies and no personal data: a visitor is a random id kept in the browser's storage.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { enqueue } from "./jobs";
import { signedUrl } from "./storage";
import { HttpError } from "./errors";
import type { EditorDocument } from "../editor/types";

export type EmbedVariant = "card" | "nocard";
type Kind = "sequence" | "testimonial";

const token = () => crypto.randomBytes(12).toString("base64url");

/**
 * Publish (or refresh) the files the players show: one render with the end card, one without.
 * A film that has no end card gets one file for both. The players keep showing the earlier files
 * until the new ones are ready.
 */
export async function publishEmbeds(projectId: string, kind: Kind, filmIds?: string[]) {
  const films = (await prisma.sequenceFilm.findMany({ where: { projectId, kind, ...(filmIds?.length ? { id: { in: filmIds } } : {}) }, orderBy: [{ order: "asc" }] })).filter((f) => f.compositionId);
  const jobs: Array<{ id: string; filmId: string; code: string }> = [];
  for (const f of films) {
    const comp = await prisma.videoComposition.findUnique({ where: { id: f.compositionId! }, select: { document: true, version: true } });
    if (!comp) continue;
    if (!f.embedToken) await prisma.sequenceFilm.update({ where: { id: f.id }, data: { embedToken: token() } });
    const hasCard = (comp.document as unknown as EditorDocument).clips.some((c) => (c.label ?? "").toUpperCase() === "PLANSZA");
    // versions of one film differ by their end card: the film without a card is published once, with the first version
    const first = !films.some((x) => x.code === f.code && x.order < f.order) && !(await prisma.sequenceFilm.count({ where: { projectId, kind, code: f.code, order: { lt: f.order } } }));
    const variants: Array<{ embed: EmbedVariant | "both"; drop: boolean }> = !hasCard ? [{ embed: "both", drop: false }] : first ? [{ embed: "card", drop: false }, { embed: "nocard", drop: true }] : [{ embed: "card", drop: false }];
    for (const v of variants) {
      const j = await prisma.renderJob.create({ data: { projectId, compositionId: f.compositionId, kind: "single", settings: { format: "1080x1080", quality: "standard", ...(v.drop ? { dropLabels: ["PLANSZA"] } : {}), embed: { filmId: f.id, variant: v.embed, version: comp.version } } } });
      await enqueue("render", { renderJobId: j.id }, { idempotencyKey: `render:${j.id}`, maxAttempts: 2 });
      jobs.push({ id: j.id, filmId: f.id, code: `${f.code}${f.version}${v.embed === "nocard" ? " bez planszy" : ""}` });
    }
  }
  if (!jobs.length) throw new HttpError(409, "Nie ma jeszcze filmów do opublikowania - wgraj paczkę.");
  return { jobs };
}

/** how long an edit must rest before its published film is rendered again (the Studio saves while one works) */
const REST_MS = Math.max(2, Number(process.env.EMBED_REST_SEC) || 90) * 1000;

/**
 * The edit of a published film changed: render it again once the editing rests, and put the new file
 * under the same embed codes. Nothing happens for films that were never published.
 */
export async function scheduleEmbedRefresh(compositionId: string | null | undefined) {
  if (!compositionId) return;
  const films = await prisma.sequenceFilm.findMany({ where: { compositionId, embedToken: { not: null }, OR: [{ embedAssetId: { not: null } }, { embedNoCardAssetId: { not: null } }] }, select: { id: true } });
  for (const f of films) await enqueue("embed-refresh", { filmId: f.id }, { idempotencyKey: `embed-refresh:${f.id}:${Math.floor(Date.now() / REST_MS)}`, maxAttempts: 2, runAt: new Date(Date.now() + REST_MS + 5000) });
}

/** The job behind scheduleEmbedRefresh: waits while the edit is still being changed, skips when the film is fresh or already rendering. */
export async function refreshEmbed(filmId: string) {
  const f = await prisma.sequenceFilm.findUnique({ where: { id: filmId } });
  if (!f?.compositionId || !f.embedToken) return { skipped: "not published" };
  const comp = await prisma.videoComposition.findUnique({ where: { id: f.compositionId }, select: { updatedAt: true, version: true } });
  if (!comp) return { skipped: "no edit" };
  if (f.embedVersion != null && comp.version <= f.embedVersion) return { skipped: "fresh" };
  if (Date.now() - comp.updatedAt.getTime() < REST_MS - 2000) {
    await scheduleEmbedRefresh(f.compositionId);
    return { skipped: "still edited" };
  }
  const busy = await prisma.renderJob.count({ where: { compositionId: f.compositionId, status: { in: ["QUEUED", "RUNNING"] }, settings: { path: ["embed", "filmId"], equals: f.id } } });
  if (busy) return { skipped: "rendering" };
  // the edit as it is now is what gets published: later changes schedule their own refresh
  const r = await publishEmbeds(f.projectId, f.kind === "testimonial" ? "testimonial" : "sequence", [f.id]);
  return { jobs: r.jobs.length };
}

/** A finished embed render becomes the file its players show. */
export async function attachEmbedRender(filmId: string, variant: EmbedVariant | "both", assetId: string, version?: number) {
  await prisma.sequenceFilm.updateMany({
    where: { id: filmId },
    data: { ...(variant !== "nocard" ? { embedAssetId: assetId } : {}), ...(variant !== "card" ? { embedNoCardAssetId: assetId } : {}), embedAt: new Date(), ...(version != null ? { embedVersion: version } : {}) },
  });
}

export async function filmByToken(tok: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(tok)) return null;
  return prisma.sequenceFilm.findUnique({ where: { embedToken: tok } });
}

export const variantOf = (p: string | null): EmbedVariant => (p === "0" ? "nocard" : "card");

/** Where the player's video / cover lives right now (a fresh signed address). */
export async function embedMediaUrl(tok: string, what: "video" | "cover", variant: EmbedVariant): Promise<string | null> {
  const f = await filmByToken(tok);
  if (!f) return null;
  const id = what === "cover" ? f.coverAssetId : variant === "nocard" ? (f.embedNoCardAssetId ?? f.embedAssetId) : (f.embedAssetId ?? f.embedNoCardAssetId);
  if (!id) return null;
  const a = await prisma.mediaAsset.findUnique({ where: { id }, select: { storageKey: true, mimeType: true } });
  return a ? signedUrl(a.storageKey, { mime: a.mimeType }) : null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The player page shown inside the iframe. */
export async function embedHtml(tok: string, variant: EmbedVariant): Promise<string | null> {
  const f = await filmByToken(tok);
  if (!f || !(f.embedAssetId || f.embedNoCardAssetId)) return null;
  const p = variant === "nocard" ? "0" : "1";
  const cover = f.coverAssetId ? `/embed/t/${tok}/cover` : "";
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(f.title)}</title>
<style>
html,body{margin:0;height:100%;background:#263d3a;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.w{position:absolute;inset:0}
.w img,.w video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#263d3a}
.w video{object-fit:contain}
button.play{position:absolute;inset:0;width:100%;height:100%;border:0;padding:0;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center}
button.play:focus-visible .b{outline:3px solid #f7f1e6;outline-offset:4px}
.b{position:relative;width:19%;min-width:64px;max-width:120px;aspect-ratio:1/1;border-radius:50%;background:#b79559;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:transform .2s ease}
button.play:hover .b{transform:scale(1.06)}
.b:before,.b:after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid #d9bd86;opacity:0;animation:pulse 2.8s ease-out infinite}
.b:after{animation-delay:1.4s}
.b svg{width:38%;height:38%;margin-left:7%;fill:#263d3a}
@keyframes pulse{0%{transform:scale(1);opacity:.75}100%{transform:scale(1.75);opacity:0}}
@media (prefers-reduced-motion:reduce){.b:before,.b:after{animation:none}}
</style></head><body>
<div class="w" id="w">${cover ? `<img src="${cover}" alt="${esc(f.title)}">` : `<video src="/embed/t/${tok}/video?p=${p}#t=0.6" preload="metadata" muted playsinline></video>`}
<button class="play" id="play" type="button" aria-label="Odtwórz film: ${esc(f.title)}"><span class="b"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 5 3.5z"/></svg></span></button></div>
<script>
(function(){
  var tok=${JSON.stringify(tok)},p=${JSON.stringify(p)},vid,ses=Math.random().toString(36).slice(2)+Date.now().toString(36);
  try{vid=localStorage.getItem("ne_vid");if(!vid){vid=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);localStorage.setItem("ne_vid",vid)}}catch(e){vid="s"+ses}
  var page="";try{var r=new URL(document.referrer);page=r.origin+r.pathname}catch(e){}
  function send(kind,pct,sec){var b=JSON.stringify({p:p,kind:kind,pct:pct==null?null:Math.round(pct),sec:sec==null?null:Math.round(sec*10)/10,vid:vid,ses:ses,page:page});
    try{if(navigator.sendBeacon&&navigator.sendBeacon("/api/embed/"+tok+"/event",new Blob([b],{type:"application/json"})))return}catch(e){}
    try{fetch("/api/embed/"+tok+"/event",{method:"POST",headers:{"content-type":"application/json"},body:b,keepalive:true})}catch(e){}}
  send("load");
  document.getElementById("play").addEventListener("click",function(){
    var w=document.getElementById("w"),v=document.createElement("video");v.src="/embed/t/"+tok+"/video?p="+p;v.controls=true;v.playsInline=true;v.setAttribute("playsinline","");v.autoplay=true;
    w.innerHTML="";w.appendChild(v);var played=false,max=0,marks={25:0,50:0,75:0},sent=-1;
    function pct(){return v.duration?Math.min(100,v.currentTime/v.duration*100):0}
    v.addEventListener("playing",function(){if(!played){played=true;send("play",0,0)}});
    v.addEventListener("timeupdate",function(){var q=pct();if(q>max)max=q;[25,50,75].forEach(function(m){if(!marks[m]&&q>=m){marks[m]=1;send("progress",m,v.currentTime)}})});
    v.addEventListener("ended",function(){max=100;sent=100;send("end",100,v.duration)});
    function flush(){if(played&&max>sent+1){sent=max;send("time",max,v.currentTime)}}
    v.addEventListener("pause",flush);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")flush()});window.addEventListener("pagehide",flush);
    var pr=v.play();if(pr&&pr.catch)pr.catch(function(){});
  });
})();
</script></body></html>`;
}

const KINDS = new Set(["load", "play", "progress", "end", "time"]);
/** One report from a player. Unknown tokens and odd bodies are dropped quietly. */
export async function recordEmbedEvent(tok: string, b: { p?: unknown; kind?: unknown; pct?: unknown; sec?: unknown; vid?: unknown; ses?: unknown; page?: unknown }, userAgent: string) {
  const f = await filmByToken(tok);
  if (!f || typeof b.kind !== "string" || !KINDS.has(b.kind)) return false;
  const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[^\w.-]/g, "").slice(0, n) : "");
  const visitor = clean(b.vid, 40);
  const session = clean(b.ses, 40);
  if (!visitor || !session) return false;
  // a page view sends a handful of events: more than 40 from one is not a player
  if ((await prisma.embedEvent.count({ where: { filmId: f.id, session } })) >= 40) return false;
  let page: string | null = null;
  if (typeof b.page === "string" && b.page) {
    try {
      const u = new URL(b.page);
      page = (u.origin + u.pathname).slice(0, 300);
    } catch {
      page = null;
    }
  }
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : null);
  await prisma.embedEvent.create({
    data: { filmId: f.id, variant: variantOf(typeof b.p === "string" ? b.p : null), kind: b.kind, visitor, session, percent: num(b.pct, 100) == null ? null : Math.round(num(b.pct, 100)!), seconds: num(b.sec, 7200), page, device: /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "mobile" : "desktop" },
  });
  return true;
}

const iframe = (base: string, tok: string, variant: EmbedVariant, title: string) =>
  `<div style="position:relative;width:100%;max-width:560px;aspect-ratio:1/1;margin:0 auto"><iframe src="${base}/embed/t/${tok}?p=${variant === "nocard" ? 0 : 1}" title="${esc(title)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:16px"></iframe></div>`;

/** What the tab shows about embedding: the codes, whether the files are published, the numbers. */
export async function embedData(projectId: string, kind: Kind, origin?: string) {
  const base = (origin || env.appUrl).replace(/\/$/, "");
  const films = await prisma.sequenceFilm.findMany({ where: { projectId, kind }, orderBy: [{ order: "asc" }] });
  const ids = films.map((f) => f.id);
  const comps = await prisma.videoComposition.findMany({ where: { id: { in: films.map((f) => f.compositionId).filter((x): x is string => !!x) } }, select: { id: true, updatedAt: true, version: true } });
  type Row = { filmId: string; variant: string; loads: bigint; plays: bigint; viewers: bigint; ends: bigint };
  const rows = ids.length
    ? await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT "filmId", "variant", count(*) FILTER (WHERE "kind" = 'load') AS loads, count(*) FILTER (WHERE "kind" = 'play') AS plays, count(DISTINCT "visitor") FILTER (WHERE "kind" = 'play') AS viewers, count(*) FILTER (WHERE "kind" = 'end') AS ends FROM "EmbedEvent" WHERE "filmId" IN (${Prisma.join(ids)}) GROUP BY 1, 2`)
    : [];
  const avg = ids.length
    ? await prisma.$queryRaw<Array<{ filmId: string; variant: string; avg: number | null }>>(Prisma.sql`SELECT "filmId", "variant", avg(mx)::float AS avg FROM (SELECT "filmId", "variant", "session", max(coalesce("percent", 0)) AS mx FROM "EmbedEvent" WHERE "filmId" IN (${Prisma.join(ids)}) AND "kind" <> 'load' GROUP BY 1, 2, 3) s GROUP BY 1, 2`)
    : [];
  const pages = ids.length
    ? await prisma.$queryRaw<Array<{ filmId: string; page: string | null; plays: bigint }>>(Prisma.sql`SELECT "filmId", "page", count(*) AS plays FROM "EmbedEvent" WHERE "filmId" IN (${Prisma.join(ids)}) AND "kind" = 'play' GROUP BY 1, 2 ORDER BY 3 DESC`)
    : [];
  // the latest views (one line per page view that pressed play): when, where, on what, how far
  const recent = ids.length
    ? await prisma.$queryRaw<Array<{ filmId: string; variant: string; session: string; at: Date; page: string | null; device: string | null; pct: number | null }>>(
        Prisma.sql`SELECT "filmId", "variant", "session", min("createdAt") AS at, max("page") AS page, max("device") AS device, max(coalesce("percent", 0))::int AS pct FROM "EmbedEvent" WHERE "filmId" IN (${Prisma.join(ids)}) AND "kind" <> 'load' GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 60`,
      )
    : [];
  const n = (v: bigint | undefined) => Number(v ?? 0);
  return {
    films: films.map((f) => {
      const comp = comps.find((c) => c.id === f.compositionId);
      const stat = (variant: EmbedVariant) => {
        const r = rows.find((x) => x.filmId === f.id && x.variant === variant);
        const a = avg.find((x) => x.filmId === f.id && x.variant === variant);
        return { loads: n(r?.loads), plays: n(r?.plays), viewers: n(r?.viewers), ends: n(r?.ends), avgPercent: a?.avg == null ? null : Math.round(a.avg) };
      };
      return {
        id: f.id,
        code: f.code,
        version: f.version,
        title: f.title,
        published: !!(f.embedAssetId || f.embedNoCardAssetId),
        note: f.note,
        // this version has its own file without the end card (the first version of a film does)
        hasNoCard: !!f.embedNoCardAssetId,
        publishedAt: f.embedAt?.toISOString() ?? null,
        // the edit was changed after the files were published
        stale: !!comp && f.embedVersion != null && comp.version > f.embedVersion,
        codes: f.embedToken ? { card: iframe(base, f.embedToken, "card", f.title), nocard: iframe(base, f.embedToken, "nocard", f.title) } : null,
        preview: f.embedToken ? { card: `/embed/t/${f.embedToken}?p=1`, nocard: `/embed/t/${f.embedToken}?p=0` } : null,
        card: stat("card"),
        nocard: stat("nocard"),
        pages: pages.filter((p) => p.filmId === f.id).slice(0, 5).map((p) => ({ page: p.page ?? "(strona nieznana)", plays: n(p.plays) })),
      };
    }),
    recent: recent.map((r) => {
      const f = films.find((x) => x.id === r.filmId)!;
      return { film: `${f.code}${f.version}`, variant: r.variant, at: r.at.toISOString(), page: r.page, device: r.device, percent: r.pct ?? 0 };
    }),
  };
}

/** The codes of every published film as one text file. */
export async function embedCodesText(projectId: string, kind: Kind, origin?: string) {
  const d = await embedData(projectId, kind, origin);
  const out = ["KODY EMBED - " + (kind === "testimonial" ? "TESTIMONIALE" : "SEKWENCJA"), "Wklej kod w miejscu, w którym film ma się pojawić. Film ma format 1:1 i dopasowuje się do szerokości (najwyżej 560 px - zmień max-width, jeśli ma być większy).", "Statystyki oglądania są w panelu, w tej samej zakładce.", ""];
  const codes = [...new Set(d.films.map((f) => f.code))];
  for (const code of codes) {
    const versions = d.films.filter((f) => f.code === code);
    out.push("=".repeat(64), `${code} - ${versions[0].title}`, "=".repeat(64));
    if (!versions.some((f) => f.codes && f.published)) {
      out.push("(jeszcze nieopublikowany - kliknij w panelu „Opublikuj do osadzenia”)", "");
      continue;
    }
    for (const f of versions) {
      if (!f.codes || !f.published) continue;
      out.push(`Wersja ${f.version} - z planszą końcową${f.note ? ` (${f.note})` : ""}:`, f.codes.card, "");
    }
    const plain = versions.find((f) => f.codes && f.hasNoCard);
    if (plain) out.push("Bez planszy końcowej:", plain.codes!.nocard, "");
    out.push("");
  }
  return out.join("\n");
}
