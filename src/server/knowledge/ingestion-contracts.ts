import { z } from "zod";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;

export const SUPPORTED_KNOWLEDGE_MIMES = [
  "text/plain",
  "text/html",
  "application/pdf",
  DOCX_MIME,
] as const;

export type SupportedKnowledgeMime = (typeof SUPPORTED_KNOWLEDGE_MIMES)[number];

const metadataShape = {
  platform: z.string().trim().min(1).max(40).optional(),
  contentType: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
};

export const knowledgeIngestionInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    name: z.string().trim().min(1).max(160),
    url: z.string().url(),
    licenseNote: z.string().trim().min(1).max(1_000),
    ...metadataShape,
  }),
  z.object({
    kind: z.literal("file"),
    name: z.string().trim().min(1).max(160),
    objectKey: z.string().min(1),
    mime: z.enum(["text/plain", "application/pdf", DOCX_MIME]),
    size: z.number().int().positive().max(10 * 1024 * 1024),
    licenseNote: z.string().trim().min(1).max(1_000),
    ...metadataShape,
  }),
  z.object({
    kind: z.literal("text"),
    name: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(200_000),
    licenseNote: z.string().trim().min(1).max(1_000),
    ...metadataShape,
  }),
]);

export type KnowledgeIngestionInput = z.infer<typeof knowledgeIngestionInputSchema>;

export const KNOWLEDGE_INGESTION_FAILURE_CODES = [
  "URL_INVALID",
  "URL_DNS_EMPTY",
  "URL_PRIVATE_ADDRESS",
  "URL_TOO_MANY_REDIRECTS",
  "URL_REDIRECT_INVALID",
  "URL_TIMEOUT",
  "URL_RESPONSE_TOO_LARGE",
  "URL_HTTP_ERROR",
  "URL_UNSUPPORTED_CONTENT_TYPE",
  "UNSUPPORTED_CONTENT_TYPE",
  "INVALID_TEXT_ENCODING",
  "DOCUMENT_PARSE_FAILED",
  "DOCUMENT_TEXT_TOO_LARGE",
  "DOCUMENT_TOO_MANY_PAGES",
] as const;

export type KnowledgeIngestionFailureCode =
  (typeof KNOWLEDGE_INGESTION_FAILURE_CODES)[number];
