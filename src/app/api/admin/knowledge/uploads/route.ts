import { cookies } from "next/headers";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { assertTrustedMutationOrigin } from "@/lib/auth/security";
import { enqueueKnowledgeIngestion } from "@/server/knowledge/ingestion-service";
import { DOCX_MIME } from "@/server/knowledge/ingestion-contracts";
import { assertAllowedUpload } from "@/server/security/file-policy";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getPrivateStorage } from "@/server/storage/local-storage";

const MAX_KNOWLEDGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const KNOWLEDGE_UPLOAD_MIMES = new Set(["text/plain", "application/pdf", DOCX_MIME]);

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== "string" && typeof value.name === "string" && typeof value.type === "string" && typeof value.arrayBuffer === "function");
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request.headers.get("origin"), process.env.APP_URL ?? "http://localhost:3000");
  } catch {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const contentLength = request.headers.get("content-length");
  if (!contentLength) {
    return Response.json({ error: "CONTENT_LENGTH_REQUIRED" }, { status: 411 });
  }
  const announcedSize = Number(contentLength);
  if (!Number.isSafeInteger(announcedSize) || announcedSize <= 0) {
    return Response.json({ error: "CONTENT_LENGTH_REQUIRED" }, { status: 411 });
  }
  if (announcedSize > MAX_KNOWLEDGE_UPLOAD_BYTES + 64 * 1024) return Response.json({ error: "FILE_SIZE_NOT_ALLOWED" }, { status: 413 });

  let storedObjectKey: string | null = null;
  let actor: Extract<Awaited<ReturnType<typeof resolveCurrentActor>>, { kind: "user" }> | null = null;
  try {
    const resolved = await resolveCurrentActor(request.headers, await cookies());
    if (resolved.kind !== "user" || resolved.role !== "admin") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    actor = resolved;
    enforceRateLimit("upload", `admin:${actor.userId}`);
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadFile(file)) return Response.json({ error: "FILE_REQUIRED" }, { status: 400 });
    if (file.size > MAX_KNOWLEDGE_UPLOAD_BYTES) return Response.json({ error: "FILE_SIZE_NOT_ALLOWED" }, { status: 413 });
    if (!KNOWLEDGE_UPLOAD_MIMES.has(file.type)) return Response.json({ error: "FILE_TYPE_NOT_ALLOWED" }, { status: 400 });
    const name = text(form, "name");
    const licenseNote = text(form, "licenseNote");
    const platform = text(form, "platform") || "all";
    const contentType = text(form, "contentType") || "general";
    const tags = text(form, "tags").split(/[，,]/u).map((value) => value.trim()).filter(Boolean);
    if (!name || name.length > 160 || !licenseNote || licenseNote.length > 1000 || platform.length > 40 || contentType.length > 40 || tags.length > 20 || tags.some((tag) => tag.length > 40)) {
      return Response.json({ error: "KNOWLEDGE_METADATA_INVALID" }, { status: 400 });
    }

    const body = new Uint8Array(await file.arrayBuffer());
    if (body.byteLength > MAX_KNOWLEDGE_UPLOAD_BYTES) return Response.json({ error: "FILE_SIZE_NOT_ALLOWED" }, { status: 413 });
    assertAllowedUpload({ name: file.name, mime: file.type, bytes: body.byteLength, signature: body.slice(0, 16) });
    const storage = getPrivateStorage();
    const stored = await storage.put(actor, { name: file.name, mime: file.type, bytes: body.byteLength, signature: body.slice(0, 16), body });
    storedObjectKey = stored.objectKey;
    const result = await enqueueKnowledgeIngestion(actor, {
      kind: "file",
      name,
      objectKey: stored.objectKey,
      mime: file.type as "text/plain" | "application/pdf" | typeof DOCX_MIME,
      size: body.byteLength,
      licenseNote,
      platform,
      contentType,
      tags,
    });
    return Response.json({ sourceId: result.sourceId, jobId: result.jobId }, { status: 202, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (storedObjectKey && actor) await getPrivateStorage().delete(actor, storedObjectKey).catch(() => undefined);
    const code = error instanceof Error ? error.message : "UPLOAD_FAILED";
    if (code === "UNAUTHORIZED") return Response.json({ error: code }, { status: 401 });
    if (code === "RATE_LIMITED") return Response.json({ error: code }, { status: 429 });
    if (["FILE_TYPE_NOT_ALLOWED", "FILE_SIZE_NOT_ALLOWED", "FILE_SIGNATURE_MISMATCH", "FILE_NAME_INVALID", "FILE_SIZE_MISMATCH"].includes(code)) {
      return Response.json({ error: code }, { status: 400 });
    }
    return Response.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }
}
