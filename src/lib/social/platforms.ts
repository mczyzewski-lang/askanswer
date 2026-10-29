/** The five platforms of Social Media Studio and how the provider (Upload-Post) names them. */
export type Platform = "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE" | "LINKEDIN";
export const PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "LINKEDIN"];

export const PLATFORM_META: Record<Platform, { name: string; format: string; provider: string; color: string; short: string }> = {
  INSTAGRAM: { name: "Instagram", format: "Reels", provider: "instagram", color: "#d6249f", short: "IG" },
  TIKTOK: { name: "TikTok", format: "Film", provider: "tiktok", color: "#111111", short: "TT" },
  YOUTUBE: { name: "YouTube", format: "Shorts", provider: "youtube", color: "#ff0000", short: "YT" },
  FACEBOOK: { name: "Facebook", format: "Reels / post", provider: "facebook", color: "#1877f2", short: "FB" },
  LINKEDIN: { name: "LinkedIn", format: "Film / post", provider: "linkedin", color: "#0a66c2", short: "IN" },
};

export function platformFromProvider(name: string): Platform | null {
  const n = name.toLowerCase();
  return PLATFORMS.find((p) => PLATFORM_META[p].provider === n) ?? null;
}
