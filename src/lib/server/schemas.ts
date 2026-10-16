import { z } from "zod";

export const QuestionInput = z.object({
  text: z.string().trim().min(3, "Pytanie jest za krótkie").max(400),
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().trim().max(80).optional(),
  subcategoryId: z.string().nullable().optional(),
  subcategoryName: z.string().trim().max(80).optional(),
  instructions: z.string().trim().max(1000).nullable().optional(),
  /** Prompter projects: script body read from the teleprompter (text = hook) */
  script: z.string().trim().max(8000).nullable().optional(),
  /** QUESTION | PROMPTER | QUESTION_PROMPTER (hybrid projects); null = from the project format */
  kind: z.enum(["QUESTION", "PROMPTER", "QUESTION_PROMPTER"]).nullable().optional(),
  maxDurationSec: z.number().int().min(5).max(1800).nullable().optional(),
  expertId: z.string().nullable().optional(),
  /** CSV "Ekspert" column: matched by name to an existing expert */
  expertName: z.string().trim().max(120).optional(),
  status: z.enum(["TO_RECORD", "IN_PROGRESS", "RECORDED", "NEEDS_FIX", "APPROVED"]).optional(),
});

export const ProjectInput = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  themeId: z.string().nullable().optional(),
  voiceId: z.string().trim().max(100).nullable().optional(),
  ttsModel: z.string().trim().max(100).nullable().optional(),
  voiceCollectionId: z.string().max(64).nullable().optional(),
  naturalFillers: z.boolean().optional(),
  autoInfographics: z.boolean().optional(),
  autoBlur: z.boolean().optional(),
  autoVoice: z.boolean().optional(),
  autoZooms: z.boolean().optional(),
  autoImageEnhance: z.boolean().optional(),
  recordingMode: z.enum(["CONTINUOUS", "ANSWER_ONLY"]).optional(),
  sequential: z.boolean().optional(),
  format: z.enum(["ANSWERS", "PROMPTER", "HYBRID"]).optional(),
  ctaEnabled: z.boolean().optional(),
  ctaUrl: z.string().trim().max(200).nullable().optional(),
  ctaText: z.string().trim().max(200).nullable().optional(),
  ctaSeconds: z.number().int().min(1).max(10).optional(),
  dailyQuestionLimit: z.number().int().min(0).max(500).optional(),
  questionVisibility: z.enum(["NARRATION_ONLY", "FIRST_SECONDS", "FULL"]).optional(),
  questionSeconds: z.number().min(1).max(60).optional(),
});
