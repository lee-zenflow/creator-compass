import { describe, expect, test } from "vitest";

import { assertAllowedUpload } from "./file-policy";

describe("private upload policy", () => {
  test("rejects disguised executable uploads", () => {
    expect(() => assertAllowedUpload({ name: "a.png.exe", mime: "image/png", bytes: 120, signature: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })).toThrow("FILE_TYPE_NOT_ALLOWED");
  });

  test("accepts a bounded image only when extension mime and signature agree", () => {
    expect(() => assertAllowedUpload({ name: "review.png", mime: "image/png", bytes: 120, signature: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })).not.toThrow();
    expect(() => assertAllowedUpload({ name: "review.png", mime: "image/png", bytes: 120, signature: new Uint8Array([0x4d, 0x5a]) })).toThrow("FILE_SIGNATURE_MISMATCH");
  });

  test("accepts bounded DOCX zip containers and rejects a mismatched signature", () => {
    const docxMime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(() =>
      assertAllowedUpload({
        name: "knowledge.docx",
        mime: docxMime,
        bytes: 10 * 1024 * 1024,
        signature: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      }),
    ).not.toThrow();
    expect(() =>
      assertAllowedUpload({
        name: "knowledge.docx",
        mime: docxMime,
        bytes: 120,
        signature: new Uint8Array([0x4d, 0x5a]),
      }),
    ).toThrow("FILE_SIGNATURE_MISMATCH");
  });
});
