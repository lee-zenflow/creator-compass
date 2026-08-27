import { z } from "zod";
import {
  positioningReportRawOutputSchema,
  profileExtractOutputSchema,
} from "@/features/positioning/positioning-schemas";
import { contentPlanRawOutputSchema } from "@/features/creation/creation-schemas";
import { reviewReportRawOutputSchema } from "@/features/reviews/review-report-schemas";

export const profileExtractSchema = profileExtractOutputSchema;

export const positioningReportSchema = positioningReportRawOutputSchema;

export const contentPlanSchema = contentPlanRawOutputSchema;

export const reviewReportSchema = reviewReportRawOutputSchema;

export const AI_OUTPUT_SCHEMAS = {
  profile_extract: profileExtractSchema,
  positioning_report: positioningReportSchema,
  content_plan: contentPlanSchema,
  review_report: reviewReportSchema,
} as const;

export type AiTaskType = keyof typeof AI_OUTPUT_SCHEMAS;
export type AiOutputByTask = {
  [K in AiTaskType]: z.infer<(typeof AI_OUTPUT_SCHEMAS)[K]>;
};
