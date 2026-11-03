import { z } from "zod";
import { PLATFORMS } from "@/lib/social/platforms";

export const AutomationInput = z
  .object({
    keyword: z.string().trim().min(2, "Podaj słowo (min. 2 znaki)").max(40),
    publicReply: z.string().trim().max(1000).default(""),
    dmReply: z.string().trim().max(1000).default(""),
    platforms: z.array(z.enum(PLATFORMS as unknown as [string, ...string[]])).max(10).default([]),
    enabled: z.boolean().default(true),
  })
  .refine((a) => a.publicReply || a.dmReply, { message: "Wpisz odpowiedź pod komentarzem albo wiadomość prywatną" });

export const automationView = (a: { id: string; keyword: string; publicReply: string; dmReply: string; platforms: string[]; enabled: boolean; sentCount: number; lastSentAt: Date | null; createdAt: Date }) => ({
  id: a.id,
  keyword: a.keyword,
  publicReply: a.publicReply,
  dmReply: a.dmReply,
  platforms: a.platforms,
  enabled: a.enabled,
  sentCount: a.sentCount,
  lastSentAt: a.lastSentAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});
