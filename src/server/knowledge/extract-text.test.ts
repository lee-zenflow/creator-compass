import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { DOCX_MIME } from "./ingestion-contracts";
import { MAX_EXTRACTED_CHARS, extractKnowledgeText } from "./extract-text";

function createSimplePdf(text: string, pageCount = 1) {
  const stream = `BT /F1 18 Tf 72 100 Td (${text}) Tj ET`;
  const fontObjectNumber = pageCount + 3;
  const contentObjectNumber = pageCount + 4;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function declareUnsafeDocxExpansion(source: Uint8Array) {
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name !== "word/document.xml") continue;
    view.setUint32(offset + 24, 60 * 1024 * 1024, true);
    return bytes;
  }
  throw new Error("DOCX_CENTRAL_DIRECTORY_ENTRY_NOT_FOUND");
}

function mutateDocxEndRecord(source: Uint8Array, mutate: (view: DataView, offset: number) => void) {
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    mutate(view, offset);
    return bytes;
  }
  throw new Error("DOCX_END_RECORD_NOT_FOUND");
}

function declareUnsafeDocxRatio(source: Uint8Array) {
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 20, 1, true);
    view.setUint32(offset + 24, 49 * 1024 * 1024, true);
    return bytes;
  }
  throw new Error("DOCX_CENTRAL_DIRECTORY_ENTRY_NOT_FOUND");
}

describe("extractKnowledgeText", () => {
  test("decodes UTF-8 plain text strictly", async () => {
    await expect(
      extractKnowledgeText({
        mime: "text/plain",
        bytes: new TextEncoder().encode("中文知识文本"),
      }),
    ).resolves.toBe("中文知识文本");

    await expect(
      extractKnowledgeText({ mime: "text/plain", bytes: new Uint8Array([0xff]) }),
    ).rejects.toThrow("INVALID_TEXT_ENCODING");
  });

  test("extracts visible HTML without script, style, or embedded object content", async () => {
    const html = `<!doctype html><h1>标题 &amp; 说明</h1><script>steal()</script><style>.x{}</style><object>恶意对象</object><p>正文</p>`;

    const text = await extractKnowledgeText({
      mime: "text/html",
      bytes: new TextEncoder().encode(html),
    });

    expect(text).toContain("标题 & 说明");
    expect(text).toContain("正文");
    expect(text).not.toMatch(/steal|\.x|恶意对象/);
  });

  test("extracts PDF page text without evaluating document actions", async () => {
    const text = await extractKnowledgeText({
      mime: "application/pdf",
      bytes: createSimplePdf("PDF knowledge"),
    });

    expect(text).toContain("PDF knowledge");
  });

  test("extracts raw DOCX text and does not accept macro-enabled Office MIME", async () => {
    const bytes = readFileSync(
      resolve(process.cwd(), "node_modules/mammoth/test/test-data/single-paragraph.docx"),
    );

    await expect(
      extractKnowledgeText({ mime: DOCX_MIME, bytes }),
    ).resolves.toContain("Walking on imported air");
    await expect(
      extractKnowledgeText({
        // The runtime boundary must reject DOCM even if a caller bypasses TypeScript.
        mime: "application/vnd.ms-word.document.macroEnabled.12" as never,
        bytes,
      }),
    ).rejects.toThrow("UNSUPPORTED_CONTENT_TYPE");
  });

  test("rejects a DOCX whose central directory declares unsafe decompression", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "node_modules/mammoth/test/test-data/single-paragraph.docx"),
    );

    await expect(
      extractKnowledgeText({ mime: DOCX_MIME, bytes: declareUnsafeDocxExpansion(source) }),
    ).rejects.toThrow("DOCUMENT_ARCHIVE_UNSAFE");
  });

  test("rejects DOCX central directories with too many entries", async () => {
    const source = readFileSync(resolve(process.cwd(), "node_modules/mammoth/test/test-data/single-paragraph.docx"));
    const bytes = mutateDocxEndRecord(source, (view, offset) => {
      view.setUint16(offset + 8, 501, true);
      view.setUint16(offset + 10, 501, true);
    });
    await expect(extractKnowledgeText({ mime: DOCX_MIME, bytes }))
      .rejects.toThrow("DOCUMENT_ARCHIVE_UNSAFE");
  });

  test("rejects a DOCX compression-ratio bomb", async () => {
    const source = readFileSync(resolve(process.cwd(), "node_modules/mammoth/test/test-data/single-paragraph.docx"));
    await expect(extractKnowledgeText({ mime: DOCX_MIME, bytes: declareUnsafeDocxRatio(source) }))
      .rejects.toThrow("DOCUMENT_ARCHIVE_UNSAFE");
  });

  test("rejects a PK-prefixed payload that is not a valid DOCX archive", async () => {
    await expect(
      extractKnowledgeText({
        mime: DOCX_MIME,
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
      }),
    ).rejects.toThrow("DOCUMENT_ARCHIVE_UNSAFE");
  });

  test.each(["text/plain", "text/html"] as const)(
    "rejects normalized %s text over 200,000 characters",
    async (mime) => {
      const wrapper = mime === "text/html" ? ["<p>", "</p>"] : ["", ""];
      const source = `${wrapper[0]}${"知".repeat(MAX_EXTRACTED_CHARS + 1)}${wrapper[1]}`;

      await expect(
        extractKnowledgeText({ mime, bytes: new TextEncoder().encode(source) }),
      ).rejects.toThrow("DOCUMENT_TEXT_TOO_LARGE");
    },
  );

  test("rejects PDFs over 200 pages before extracting page text", async () => {
    await expect(
      extractKnowledgeText({
        mime: "application/pdf",
        bytes: createSimplePdf("too many pages", 201),
      }),
    ).rejects.toThrow("DOCUMENT_TOO_MANY_PAGES");
  });
});
