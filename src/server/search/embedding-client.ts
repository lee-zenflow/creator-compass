import { z } from "zod";

const EMBEDDING_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 32;
const MAX_TEXT_LENGTH = 12_000;

const embeddingResponseSchema = z.object({
  model: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(80),
  dimensions: z.literal(EMBEDDING_DIMENSIONS),
  vectors: z.array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS)),
}).strict();

export type EmbeddingFailureCode =
  | "INVALID_INPUT"
  | "EMBEDDING_UNAVAILABLE"
  | "INVALID_RESPONSE";

export class EmbeddingFailure extends Error {
  readonly retryable: boolean;

  constructor(readonly code: EmbeddingFailureCode, retryable = false) {
    super(code);
    this.name = "EmbeddingFailure";
    this.retryable = retryable;
  }
}

export type EmbeddingResult = {
  model: string;
  version: string;
  dimensions: typeof EMBEDDING_DIMENSIONS;
  vectors: number[][];
};

export type EmbeddingClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function validateTexts(texts: readonly string[]) {
  const normalized = texts.map((text) => text.normalize("NFKC").trim());
  if (
    normalized.length === 0 ||
    normalized.length > MAX_BATCH_SIZE ||
    normalized.some((text) => text.length === 0 || text.length > MAX_TEXT_LENGTH)
  ) {
    throw new EmbeddingFailure("INVALID_INPUT");
  }
  return normalized;
}

function normalizedVector(vector: readonly number[]) {
  const magnitude = Math.hypot(...vector);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw new EmbeddingFailure("INVALID_RESPONSE");
  }
  return vector.map((value) => value / magnitude);
}

export class EmbeddingClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EmbeddingClientOptions = {}) {
    this.endpoint = (options.endpoint ?? process.env.EMBEDDING_SERVICE_URL ?? "http://127.0.0.1:8765")
      .replace(/\/$/u, "");
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(mode: "document" | "query", rawTexts: readonly string[]) {
    const texts = validateTexts(rawTexts);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, texts }),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new EmbeddingFailure("EMBEDDING_UNAVAILABLE", true);
    }
    if (!response.ok) throw new EmbeddingFailure("EMBEDDING_UNAVAILABLE", response.status >= 500);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EmbeddingFailure("INVALID_RESPONSE");
    }
    const parsed = embeddingResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.vectors.length !== texts.length) {
      throw new EmbeddingFailure("INVALID_RESPONSE");
    }
    return {
      ...parsed.data,
      vectors: parsed.data.vectors.map(normalizedVector),
    } satisfies EmbeddingResult;
  }

  embedDocuments(texts: readonly string[]) {
    return this.request("document", texts);
  }

  async embedQuery(text: string) {
    const result = await this.request("query", [text]);
    return {
      model: result.model,
      version: result.version,
      dimensions: result.dimensions,
      vector: result.vectors[0]!,
    };
  }
}

export const localEmbeddingClient = new EmbeddingClient();
