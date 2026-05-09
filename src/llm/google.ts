import type {
  ContentBlock,
  CreateModelResponseOptions,
  Message,
  ModelClient,
  ModelResponse,
  ToolDefinition,
  ToolUseBlock,
} from "./types.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GoogleGeminiClient implements ModelClient {
  public readonly provider = "google" as const;
  private readonly apiKey: string;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required.");
    }
    this.apiKey = apiKey;
  }

  async createResponse(
    opts: CreateModelResponseOptions
  ): Promise<ModelResponse> {
    const response = await fetch(
      `${GEMINI_API_BASE}/${modelPath(opts.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: opts.systemPrompt }],
          },
          contents: toGoogleContents(opts.messages),
          generationConfig: {
            maxOutputTokens: opts.maxOutputTokens,
            thinkingConfig: {
              thinkingLevel: "high",
            },
          },
          tools: [
            {
              functionDeclarations: opts.tools.map(toGoogleFunctionDeclaration),
            },
          ],
          toolConfig: {
            functionCallingConfig:
              opts.toolChoice.type === "tool"
                ? {
                    mode: "ANY",
                    allowedFunctionNames: [opts.toolChoice.name],
                  }
                : { mode: "ANY" },
          },
        }),
      }
    );

    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(
        `Google Gemini API error ${response.status}: ${formatGoogleError(json)}`
      );
    }

    return fromGoogleResponse(json);
  }
}

function modelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function toGoogleFunctionDeclaration(
  tool: ToolDefinition
): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.inputSchema),
  };
}

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "type" && Array.isArray(value)) {
      const nonNullTypes = value.filter((v) => v !== "null");
      if (nonNullTypes.length === 1) {
        out.type = nonNullTypes[0];
        out.nullable = true;
      } else {
        out.type = nonNullTypes;
        if (value.length !== nonNullTypes.length) out.nullable = true;
      }
      continue;
    }
    out[key] = toGeminiSchema(value);
  }
  return out;
}

function toGoogleContents(messages: Message[]): Record<string, unknown>[] {
  const toolNamesById = new Map<string, string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use") toolNamesById.set(block.id, block.name);
    }
  }

  const contents: Record<string, unknown>[] = [];
  for (const msg of messages) {
    const providerContent = msg.content.find(
      (b) => b.type === "provider_item" && b.provider === "google"
    );
    if (providerContent?.type === "provider_item") {
      const item = asRecord(providerContent.item);
      if (Array.isArray(item.parts)) {
        contents.push(item);
        continue;
      }
    }

    const role = msg.role === "assistant" ? "model" : "user";
    let bufferedParts: Record<string, unknown>[] = [];
    let bufferedKind: "functionResponse" | "other" | null = null;

    const flush = () => {
      if (!bufferedParts.length) return;
      contents.push({ role, parts: bufferedParts });
      bufferedParts = [];
      bufferedKind = null;
    };

    for (const block of msg.content) {
      if (block.type === "provider_item") continue;
      const part = toGooglePart(block, toolNamesById);
      if (!part) continue;
      const kind = block.type === "tool_result" ? "functionResponse" : "other";
      if (bufferedKind && bufferedKind !== kind) flush();
      bufferedKind = kind;
      bufferedParts.push(part);
    }
    flush();
  }
  return contents;
}

function toGooglePart(
  block: ContentBlock,
  toolNamesById: Map<string, string>
): Record<string, unknown> | null {
  if (block.type === "text") {
    return { text: block.text };
  }
  if (block.type === "image") {
    return {
      inlineData: {
        mimeType: block.mediaType,
        data: block.data,
      },
    };
  }
  if (block.type === "tool_use") {
    const functionCall: Record<string, unknown> = {
      name: block.name,
      args: block.input ?? {},
    };
    if (block.id) functionCall.id = block.id;
    return { functionCall };
  }
  if (block.type === "tool_result") {
    const functionResponse: Record<string, unknown> = {
      id: block.toolUseId,
      name: toolNamesById.get(block.toolUseId) ?? "unknown_tool",
      response: block.isError
        ? { error: block.content }
        : { output: block.content },
    };
    return { functionResponse };
  }
  return null;
}

function fromGoogleResponse(json: unknown): ModelResponse {
  const obj = asRecord(json);
  const candidates = asArray(obj.candidates);
  const firstCandidate = asRecord(candidates[0]);
  const contentRecord = asRecord(firstCandidate.content);
  const parts = asArray(contentRecord.parts);
  const content: ContentBlock[] = [];

  for (const partValue of parts) {
    const part = asRecord(partValue);
    if (typeof part.text === "string") {
      content.push({ type: "text", text: part.text });
    }
    const functionCall = asRecord(part.functionCall);
    if (typeof functionCall.name === "string") {
      content.push(functionCallToToolUse(functionCall));
    }
  }

  if (parts.length) {
    content.push({
      type: "provider_item",
      provider: "google",
      item: contentRecord,
    });
  }

  const usage = asRecord(obj.usageMetadata);
  const reasoningTokens = numberOrZero(usage.thoughtsTokenCount);
  const outputTokens =
    numberOrZero(usage.candidatesTokenCount) + reasoningTokens;

  return {
    content,
    stopReason:
      typeof firstCandidate.finishReason === "string"
        ? firstCandidate.finishReason
        : null,
    usage: {
      inputTokens: numberOrZero(usage.promptTokenCount),
      outputTokens,
      cacheReadTokens: numberOrZero(usage.cachedContentTokenCount),
      cacheWriteTokens: 0,
      reasoningOutputTokens: reasoningTokens,
    },
  };
}

function functionCallToToolUse(rec: Record<string, unknown>): ToolUseBlock {
  const name = typeof rec.name === "string" ? rec.name : "";
  const callId =
    typeof rec.id === "string"
      ? rec.id
      : `google_call_${Math.random().toString(36).slice(2)}`;
  return {
    type: "tool_use",
    id: callId,
    name,
    input: asRecord(rec.args),
    providerItem: rec,
  };
}

function formatGoogleError(json: unknown): string {
  const obj = asRecord(json);
  const err = asRecord(obj.error);
  if (typeof err.message === "string") return err.message;
  return JSON.stringify(json);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
