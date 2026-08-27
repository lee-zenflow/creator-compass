import { cookies } from "next/headers";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { assertTrustedMutationOrigin } from "@/lib/auth/security";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getPrivateStorage } from "@/server/storage/local-storage";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== "string" && typeof value.name === "string" && typeof value.type === "string" && typeof value.arrayBuffer === "function");
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request.headers.get("origin"), process.env.APP_URL ?? "http://localhost:3000");
  } catch {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const announcedSize = Number(request.headers.get("content-length") ?? 0);
  if (announcedSize > MAX_REQUEST_BYTES) return Response.json({ error: "FILE_SIZE_NOT_ALLOWED" }, { status: 413 });
  try {
    const actor = await resolveCurrentActor(request.headers, await cookies());
    enforceRateLimit("upload", actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`);
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadFile(file)) return Response.json({ error: "FILE_REQUIRED" }, { status: 400 });
    const body = new Uint8Array(await file.arrayBuffer());
    if (body.byteLength > MAX_REQUEST_BYTES) return Response.json({ error: "FILE_SIZE_NOT_ALLOWED" }, { status: 413 });
    const result = await getPrivateStorage().put(actor, {
      name: file.name,
      mime: file.type,
      bytes: body.byteLength,
      signature: body.slice(0, 16),
      body,
    });
    return Response.json(result, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UPLOAD_FAILED";
    if (code === "RATE_LIMITED") return Response.json({ error: code }, { status: 429 });
    if (["FILE_TYPE_NOT_ALLOWED", "FILE_SIZE_NOT_ALLOWED", "FILE_SIGNATURE_MISMATCH", "FILE_NAME_INVALID", "FILE_SIZE_MISMATCH"].includes(code)) return Response.json({ error: code }, { status: 400 });
    if (code === "UNAUTHORIZED") return Response.json({ error: code }, { status: 401 });
    return Response.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }
}
