import { env, openaiConfigured, uploadPostLive, elevenLabsConfigured } from "@/lib/server/env";
import { isStaff, requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { demoExists } from "@/lib/server/social/demo";
import { RULES_VERSION } from "@/lib/social/rules";

/** integrations status (no secrets: only whether something is set) */
export const GET = route(async () => {
  const user = await requireUser();
  const staff = isStaff(user.role);
  return json({
    staff,
    uploadPost: { live: uploadPostLive(), keySet: env.uploadPostKey.length > 0, forcedDemo: env.socialDemoForced, baseUrl: staff ? env.uploadPostBaseUrl : undefined },
    webhook: staff ? { url: `${env.appUrl}/api/hooks/upload-post${env.uploadPostWebhookToken ? "?token=…" : ""}`, secretSet: !!env.uploadPostWebhookSecret, tokenSet: !!env.uploadPostWebhookToken, signatureHeader: env.uploadPostSignatureHeader, timestampHeader: env.uploadPostTimestampHeader, deliveryHeader: env.uploadPostDeliveryHeader, sendExternalId: env.uploadPostSendExternalId } : undefined,
    ai: { openai: openaiConfigured(), model: env.openaiTextModel, rulesVersion: RULES_VERSION },
    transcription: elevenLabsConfigured(),
    demoLoaded: await demoExists(),
    email: { enabled: false },
  });
});
