import mammoth from "mammoth";

import { DOCX_MIME, type SupportedKnowledgeMime } from "./ingestion-contracts";

export const MAX_EXTRACTED_CHARS = 200_000;

const MAX_DOCX_ENTRIES = 500;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;

function unsafeDocxArchive(): never {
  throw new Error("DOCUMENT_ARCHIVE_UNSAFE");
}

function assertSafeDocxArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEndRecordLength = 22;
  const maximumEndSearchLength = 65_557;
  const searchStart = Math.max(0, bytes.byteLength - maximumEndSearchLength);
  let endOffset = -1;

  for (let offset = bytes.byteLength - minimumEndRecordLength; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + minimumEndRecordLength + commentLength !== bytes.byteLength) continue;
    endOffset = offset;
    break;
  }
  if (endOffset < 0) unsafeDocxArchive();

  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);

  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount === 0xffff ||
    entryCount > MAX_DOCX_ENTRIES ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    directoryOffset + directorySize !== endOffset
  ) {
    unsafeDocxArchive();
  }

  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  let cursor = directoryOffset;

  try {
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > endOffset || view.getUint32(cursor, true) !== 0x02014b50) {
        unsafeDocxArchive();
      }
      const flags = view.getUint16(cursor + 8, true);
      const compressedBytes = view.getUint32(cursor + 20, true);
      const uncompressedBytes = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;

      if (
        (flags & 0x1) !== 0 ||
        compressedBytes === 0xffffffff ||
        uncompressedBytes === 0xffffffff ||
        nameLength === 0 ||
        recordEnd > endOffset
      ) {
        unsafeDocxArchive();
      }

      names.add(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
      totalCompressedBytes += compressedBytes;
      totalUncompressedBytes += uncompressedBytes;
      if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) unsafeDocxArchive();
      cursor = recordEnd;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DOCUMENT_ARCHIVE_UNSAFE") throw error;
    unsafeDocxArchive();
  }

  const compressionRatio = totalUncompressedBytes / Math.max(1, totalCompressedBytes);
  if (
    cursor !== endOffset ||
    totalCompressedBytes <= 0 ||
    compressionRatio > MAX_DOCX_COMPRESSION_RATIO ||
    !names.has("[Content_Types].xml") ||
    !names.has("word/document.xml")
  ) {
    unsafeDocxArchive();
  }
}

function normalizeExtractedText(text: string) {
  const normalized = text
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length > MAX_EXTRACTED_CHARS) {
    throw new Error("DOCUMENT_TEXT_TOO_LARGE");
  }
  return normalized;
}

function decodeHtmlEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, value: string) => {
    if (value.startsWith("#x") || value.startsWith("#X")) {
      const codePoint = Number.parseInt(value.slice(2), 16);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (value.startsWith("#")) {
      const codePoint = Number.parseInt(value.slice(1), 10);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[value.toLocaleLowerCase("en-US")] ?? entity;
  });
}

function stripHtmlWithoutActiveContent(html: string) {
  const withoutActiveContent = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|template|object|embed|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<(script|style|noscript|template|object|embed|iframe)\b[^>]*\/?>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|p|pre|section|table|tr)>/gi, "\n")
    .replace(/<![^>]*>/g, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeExtractedText(decodeHtmlEntities(withoutActiveContent));
}

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > 200) throw new Error("DOCUMENT_TOO_MANY_PAGES");
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" "),
      );
      page.cleanup();
    }
    return normalizeExtractedText(pages.join("\n\n"));
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractKnowledgeText(input: {
  mime: SupportedKnowledgeMime;
  bytes: Uint8Array;
}) {
  try {
    if (input.mime === "text/plain") {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      } catch {
        throw new Error("INVALID_TEXT_ENCODING");
      }
      return normalizeExtractedText(text);
    }
    if (input.mime === "text/html") {
      let html: string;
      try {
        html = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      } catch {
        throw new Error("INVALID_TEXT_ENCODING");
      }
      return stripHtmlWithoutActiveContent(html);
    }
    if (input.mime === "application/pdf") return await extractPdfText(input.bytes);
    if (input.mime === DOCX_MIME) {
      assertSafeDocxArchive(input.bytes);
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
      return normalizeExtractedText(result.value);
    }
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "INVALID_TEXT_ENCODING",
        "UNSUPPORTED_CONTENT_TYPE",
        "DOCUMENT_TEXT_TOO_LARGE",
        "DOCUMENT_TOO_MANY_PAGES",
        "DOCUMENT_ARCHIVE_UNSAFE",
      ].includes(error.message)
    ) {
      throw error;
    }
    throw new Error("DOCUMENT_PARSE_FAILED", { cause: error });
  }
}
