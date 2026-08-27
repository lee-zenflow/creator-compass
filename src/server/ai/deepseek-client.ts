import { z } from "zod";

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SYSTEM_LENGTH = 20_000;
const MAX_USER_LENGTH = 80_000;
const MAX_RESPONSE_CONTENT_LENGTH = 120_000;

export type AiFailureCode =
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "INVALID_OUTPUT"
  | "UPSTREAM_ERROR";

export class AiFailure extends Error {
  constructor(
    public readonly code: AiFailureCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiFailure";
  }
}

export type DeepSeekJsonRequest<T> = {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  sourceIdAllowlist?: readonly string[];
  signal?: AbortSignal;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DeepSeekClientConfig = {
  apiKey?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  onUsage?(usage: DeepSeekTokenUsage): void | Promise<void>;
};

export type DeepSeekTokenUsage = { inputTokens: number; outputTokens: number };

const requestSchema = z
  .object({
    system: z.string().min(1).max(MAX_SYSTEM_LENGTH),
    user: z.string().min(1).max(MAX_USER_LENGTH),
    sourceIdAllowlist: z.array(z.string().min(1).max(120)).max(8).optional(),
  })
  .strict();

const responseEnvelopeSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({ content: z.string().max(MAX_RESPONSE_CONTENT_LENGTH) })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1)
      .max(16),
    usage: z.object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    }),
  })
  .passthrough();

function assertAllowedSourceIds(value: unknown, allowlist: ReadonlySet<string>) {
  if (Array.isArray(value)) {
    for (const item of value) assertAllowedSourceIds(item, allowlist);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "sourceId" && typeof child === "string" && !allowlist.has(child)) {
      throw new AiFailure("INVALID_OUTPUT", "AI output contains an unknown source reference.", false);
    }
    if (key === "sourceIds" && Array.isArray(child)) {
      if (child.some((item) => typeof item !== "string" || !allowlist.has(item))) {
        throw new AiFailure("INVALID_OUTPUT", "AI output contains an unknown source reference.", false);
      }
    }
    assertAllowedSourceIds(child, allowlist);
  }
}

function parseOutput<T>(
  content: string,
  schema: z.ZodType<T>,
  sourceIdAllowlist: readonly string[],
): T {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new AiFailure("INVALID_OUTPUT", "AI output was not valid JSON.", false);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AiFailure("INVALID_OUTPUT", "AI output did not match the required schema.", false);
  }
  assertAllowedSourceIds(parsed.data, new Set(sourceIdAllowlist));
  return parsed.data;
}

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly onUsage?: DeepSeekClientConfig["onUsage"];

  constructor(config: DeepSeekClientConfig = {}) {
    this.apiKey = config.apiKey ?? "";
    this.model = DEEPSEEK_MODEL;
    this.fetcher = config.fetcher ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onUsage = config.onUsage;
  }

  async generateJson<T>(request: DeepSeekJsonRequest<T>): Promise<T> {
    if (!this.apiKey.trim() || !this.model.trim()) {
      throw new AiFailure("NOT_CONFIGURED", "DeepSeek is not configured.", false);
    }

    const parsedRequest = requestSchema.safeParse({
      system: request.system,
      user: request.user,
      sourceIdAllowlist: request.sourceIdAllowlist ? [...request.sourceIdAllowlist] : undefined,
    });
    if (!parsedRequest.success) {
      throw new AiFailure("INVALID_OUTPUT", "AI request exceeded a safe input boundary.", false);
    }

    const allowlist = parsedRequest.data.sourceIdAllowlist ?? [];
    const outputSchema = JSON.stringify(z.toJSONSchema(request.schema));
    const schemaInstruction = `Server-controlled output contract: return exactly one JSON object matching this schema. Do not add fields outside the schema. Schema: ${outputSchema}`;
    const initialSystem = `${parsedRequest.data.system}\n\n${schemaInstruction}`;
    if (initialSystem.length > MAX_SYSTEM_LENGTH) {
      throw new AiFailure("INVALID_OUTPUT", "AI output schema exceeded a safe request boundary.", false);
    }
    const firstContent = await this.requestContent(
      initialSystem,
      parsedRequest.data.user,
      request.signal,
    );
    return parseOutput(firstContent, request.schema, allowlist);
  }

  private async requestContent(system: string, user: string, externalSignal?: AbortSignal) {
    if (externalSignal?.aborted) {
      throw new AiFailure("TIMEOUT", "DeepSeek request timed out or was cancelled.", true);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

    try {
      const response = await this.fetcher(DEEPSEEK_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new AiFailure("RATE_LIMITED", "DeepSeek rate limit reached.", true);
        }
        const retryable = response.status >= 500;
        throw new AiFailure("UPSTREAM_ERROR", "DeepSeek request failed.", retryable);
      }

      let envelope: unknown;
      try {
        envelope = await response.json();
      } catch {
        throw new AiFailure("INVALID_OUTPUT", "DeepSeek returned an invalid response envelope.", false);
      }
      const parsedEnvelope = responseEnvelopeSchema.safeParse(envelope);
      if (!parsedEnvelope.success) {
        throw new AiFailure("INVALID_OUTPUT", "DeepSeek returned an invalid response envelope.", false);
      }
      await this.onUsage?.({
        inputTokens: parsedEnvelope.data.usage.prompt_tokens,
        outputTokens: parsedEnvelope.data.usage.completion_tokens,
      });
      return parsedEnvelope.data.choices[0]!.message.content;
    } catch (error) {
      if (error instanceof AiFailure) throw error;
      if (controller.signal.aborted) {
        throw new AiFailure("TIMEOUT", "DeepSeek request timed out or was cancelled.", true);
      }
      throw new AiFailure("UPSTREAM_ERROR", "DeepSeek network request failed.", true);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }
}
