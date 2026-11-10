import { PrismaClient } from "@prisma/client";
import { plainDashes, plainDashesDeep } from "../dashes";

/** the content fields of ads: saved without the long dash ("—" / "–" → "-"), whatever wrote them */
const CONTENT: Record<string, string[]> = {
  adwordsAsset: ["headline", "subheadline", "body", "cta", "adText", "spokenText", "screenText", "lp"],
  metaAd: ["primaryText", "metaHeadline", "description", "headline", "ctaImage", "badgeText", "body", "webinarTitle", "extra"],
};
export function cleanContent(model: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((d) => cleanContent(model, d));
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const f of CONTENT[model] ?? []) {
    const v = out[f];
    if (typeof v === "string") out[f] = plainDashes(v);
    else if (v && typeof v === "object" && "set" in (v as object) && typeof (v as { set: unknown }).set === "string") out[f] = { set: plainDashes((v as { set: string }).set) };
    else if (v && typeof v === "object") out[f] = plainDashesDeep(v);
  }
  return out;
}

function make() {
  const base = new PrismaClient();
  const ops = (model: string) => ({
    async create({ args, query }: { args: { data: unknown }; query: (a: unknown) => Promise<unknown> }) {
      return query({ ...args, data: cleanContent(model, args.data) });
    },
    async createMany({ args, query }: { args: { data: unknown }; query: (a: unknown) => Promise<unknown> }) {
      return query({ ...args, data: cleanContent(model, args.data) });
    },
    async update({ args, query }: { args: { data: unknown }; query: (a: unknown) => Promise<unknown> }) {
      return query({ ...args, data: cleanContent(model, args.data) });
    },
    async updateMany({ args, query }: { args: { data: unknown }; query: (a: unknown) => Promise<unknown> }) {
      return query({ ...args, data: cleanContent(model, args.data) });
    },
    async upsert({ args, query }: { args: { create: unknown; update: unknown }; query: (a: unknown) => Promise<unknown> }) {
      return query({ ...args, create: cleanContent(model, args.create), update: cleanContent(model, args.update) });
    },
  });
  return base.$extends({ query: { adwordsAsset: ops("adwordsAsset"), metaAd: ops("metaAd") } as never });
}

type Db = ReturnType<typeof make>;
const g = globalThis as unknown as { __prisma?: Db };
export const prisma: Db = g.__prisma ?? make();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;
