import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCurrentActor: vi.fn(async () => ({
    kind: "user" as const,
    userId: "10000000-0000-4000-8000-000000000001",
    role: "admin" as "admin" | "user",
  })),
  put: vi.fn(async () => ({
    objectKey: "private/user/10000000-0000-4000-8000-000000000001/secret.pdf",
  })),
  delete: vi.fn(async () => undefined),
  enqueue: vi.fn(async () => ({
    sourceId: "30000000-0000-4000-8000-000000000003",
    jobId: "40000000-0000-4000-8000-000000000004",
  })),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock("@/features/identity/current-actor", () => ({ resolveCurrentActor: mocks.resolveCurrentActor }));
vi.mock("@/server/storage/local-storage", () => ({
  getPrivateStorage: () => ({ put: mocks.put, delete: mocks.delete }),
}));
vi.mock("@/server/knowledge/ingestion-service", () => ({
  enqueueKnowledgeIngestion: mocks.enqueue,
}));

import { POST } from "@/app/api/admin/knowledge/uploads/route";

function uploadRequest(file: { name: string; type: string; bytes: Uint8Array }, fields: Record<string, string> = {}) {
  const request = new Request("https://creator.example/api/admin/knowledge/uploads", {
    method: "POST",
    headers: {
      origin: "https://creator.example",
      "content-length": String(file.bytes.byteLength + 1024),
    },
  });
  vi.spyOn(request, "formData").mockResolvedValue({
    get: (key: string) => key === "file"
      ? { name: file.name, type: file.type, size: file.bytes.byteLength, arrayBuffer: vi.fn(async () => file.bytes.buffer) }
      : fields[key] ?? null,
  } as unknown as FormData);
  return request;
}

describe("knowledge upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://creator.example";
  });

  test("rejects a non-admin before reading or storing the upload", async () => {
    mocks.resolveCurrentActor.mockResolvedValueOnce({
      kind: "user",
      userId: "10000000-0000-4000-8000-000000000001",
      role: "user",
    });
    const response = await POST(uploadRequest({
      name: "case.pdf",
      type: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }));
    expect(response.status).toBe(403);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  test("rejects a request without a bounded content length before buffering multipart data", async () => {
    const request = new Request("https://creator.example/api/admin/knowledge/uploads", {
      method: "POST",
      headers: { origin: "https://creator.example" },
    });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);

    expect(response.status).toBe(411);
    expect(await response.json()).toEqual({ error: "CONTENT_LENGTH_REQUIRED" });
    expect(formData).not.toHaveBeenCalled();
  });

  test("stores a valid private document and returns identifiers only", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const response = await POST(uploadRequest({
      name: "case.pdf",
      type: "application/pdf",
      bytes,
    }, { name: "公开案例", licenseNote: "已获授权" }));

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({
      sourceId: "30000000-0000-4000-8000-000000000003",
      jobId: "40000000-0000-4000-8000-000000000004",
    });
    expect(JSON.stringify(body)).not.toContain("objectKey");
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin" }),
      expect.objectContaining({
        kind: "file",
        name: "公开案例",
        mime: "application/pdf",
        size: bytes.byteLength,
        licenseNote: "已获授权",
      }),
    );
  });

  test("rejects knowledge files above 10 MiB", async () => {
    const response = await POST(uploadRequest({
      name: "large.pdf",
      type: "application/pdf",
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
    }, { name: "过大文件", licenseNote: "已获授权" }));
    expect(response.status).toBe(413);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  test("rejects invalid metadata before writing private storage", async () => {
    const response = await POST(uploadRequest({
      name: "case.pdf",
      type: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }, { name: "过".repeat(161), licenseNote: "已获授权" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "KNOWLEDGE_METADATA_INVALID" });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  test("deletes the private object when queueing fails and exposes no internal detail", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("database detail objectKey=secret"));
    const response = await POST(uploadRequest({
      name: "case.pdf",
      type: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }, { name: "公开案例", licenseNote: "已获授权" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "UPLOAD_FAILED" });
    expect(mocks.delete).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin" }),
      "private/user/10000000-0000-4000-8000-000000000001/secret.pdf",
    );
  });
});
