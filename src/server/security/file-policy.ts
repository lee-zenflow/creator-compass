export type UploadDescriptor = {
  name: string;
  mime: string;
  bytes: number;
  signature?: Uint8Array;
};

const policies = {
  "image/png": { extensions: ["png"], maxBytes: 10 * 1024 * 1024, signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  "image/jpeg": { extensions: ["jpg", "jpeg"], maxBytes: 10 * 1024 * 1024, signatures: [[0xff, 0xd8, 0xff]] },
  "image/webp": { extensions: ["webp"], maxBytes: 10 * 1024 * 1024, signatures: [[0x52, 0x49, 0x46, 0x46]] },
  "application/pdf": { extensions: ["pdf"], maxBytes: 15 * 1024 * 1024, signatures: [[0x25, 0x50, 0x44, 0x46]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extensions: ["docx"],
    maxBytes: 10 * 1024 * 1024,
    signatures: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  },
  "text/plain": { extensions: ["txt"], maxBytes: 2 * 1024 * 1024, signatures: [] },
} as const;

function signatureMatches(actual: Uint8Array, expected: readonly number[]) {
  return expected.every((value, index) => actual[index] === value);
}

export function assertAllowedUpload(file: UploadDescriptor) {
  if (!file.name || file.name.length > 180 || /[\\/\0]/.test(file.name)) throw new Error("FILE_NAME_INVALID");
  const parts = file.name.toLocaleLowerCase("en-US").split(".");
  const extension = parts.at(-1) ?? "";
  const policy = policies[file.mime as keyof typeof policies];
  if (!policy || !policy.extensions.some((allowed) => allowed === extension) || parts.some((part) => ["exe", "cmd", "bat", "com", "scr", "js", "msi", "ps1"].includes(part))) {
    throw new Error("FILE_TYPE_NOT_ALLOWED");
  }
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > policy.maxBytes) throw new Error("FILE_SIZE_NOT_ALLOWED");
  if (policy.signatures.length > 0) {
    if (!file.signature || !policy.signatures.some((signature) => signatureMatches(file.signature!, signature))) throw new Error("FILE_SIGNATURE_MISMATCH");
    if (file.mime === "image/webp" && new TextDecoder().decode(file.signature.slice(8, 12)) !== "WEBP") throw new Error("FILE_SIGNATURE_MISMATCH");
  }
}
