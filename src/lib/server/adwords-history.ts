/**
 * Historia PMax — importing the Google Ads asset report. The same report (same file, or the same period
 * exported again) replaces its rows instead of adding duplicates; links to concepts are kept.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { parseHistory } from "../adwords/history";

export async function importHistory(projectId: string, text: string, fileName: string, dryRun = false) {
  const parsed = parseHistory(text);
  const fileHash = crypto.createHash("sha256").update(text.replace(/^﻿/, "")).digest("hex");
  const summary = {
    kind: "history" as const,
    fileName,
    title: parsed.title,
    periodRaw: parsed.periodRaw,
    periodFrom: parsed.period.from,
    periodTo: parsed.period.to,
    total: parsed.rows.length,
    issues: parsed.issues,
    preview: parsed.rows.slice(0, 10).map((r) => ({ component: r.component, type: r.assetType, status: r.status, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions })),
  };
  if (dryRun || parsed.issues.length) return { ...summary, applied: false, replaced: false };
  const same = await prisma.adwordsHistoryImport.findFirst({
    where: { projectId, OR: [{ fileHash }, ...(parsed.period.from && parsed.period.to ? [{ periodFrom: parsed.period.from, periodTo: parsed.period.to }] : [])] },
    include: { rows: { select: { component: true, typeKey: true, level: true, conceptId: true } } },
  });
  const links = new Map((same?.rows ?? []).filter((r) => r.conceptId).map((r) => [`${r.typeKey}|${r.level}|${r.component}`, r.conceptId]));
  const imp = await prisma.$transaction(async (tx) => {
    if (same) await tx.adwordsHistoryImport.delete({ where: { id: same.id } });
    return tx.adwordsHistoryImport.create({
      data: {
        projectId,
        fileName,
        fileHash,
        title: parsed.title,
        periodFrom: parsed.period.from,
        periodTo: parsed.period.to,
        periodRaw: parsed.periodRaw,
        rowCount: parsed.rows.length,
        rows: {
          create: parsed.rows.map((r) => ({
            projectId,
            rowNumber: r.rowNumber,
            raw: r.raw as unknown as Prisma.InputJsonValue,
            assetState: r.assetState,
            component: r.component,
            level: r.level,
            status: r.status,
            assetType: r.assetType,
            typeKey: r.typeKey,
            lastUpdated: r.lastUpdated,
            conversions: r.conversions,
            convValue: r.convValue,
            impressions: r.impressions,
            clicks: r.clicks,
            currency: r.currency,
            cost: r.cost,
            addedBy: r.addedBy,
            angle: r.angle,
            conceptId: links.get(`${r.typeKey}|${r.level}|${r.component}`) ?? null,
          })),
        },
      },
    });
  });
  return { ...summary, applied: true, replaced: !!same, importId: imp.id };
}

export async function historyOf(projectId: string) {
  const imports = await prisma.adwordsHistoryImport.findMany({ where: { projectId }, orderBy: [{ periodTo: "desc" }, { importedAt: "desc" }], select: { id: true, fileName: true, title: true, periodFrom: true, periodTo: true, periodRaw: true, rowCount: true, importedAt: true } });
  const rows = await prisma.adwordsHistoryRow.findMany({ where: { projectId }, orderBy: [{ importId: "asc" }, { rowNumber: "asc" }] });
  return { imports, rows };
}
