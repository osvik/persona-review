import type {
  ContentBlock,
  CreateModelResponseOptions,
  Message,
  ModelClient,
  ModelResponse,
  ToolDefinition,
  ToolUseBlock,
} from "./types.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIResponsesClient implements ModelClient {
  public readonly provider = "openai" as const;
  private readonly apiKey: string;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required.");
    }
    this.apiKey = apiKey;
  }

  async createResponse(
    opts: CreateModelResponseOptions
  ): Promise<ModelResponse> {
    const response = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        instructions: opts.systemPrompt,
        max_output_tokens: opts.maxOutputTokens,
        input: toOpenAIInput(opts.messages),
        tools: opts.tools.map(toOpenAITool),
        tool_choice:
          opts.toolChoice.type === "tool"
            ? { type: "function", name: opts.toolChoice.name }
            : "required",
      }),
    });

    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(
        `OpenAI Responses API error ${response.status}: ${formatOpenAIError(json)}`
      );
    }

    return fromOpenAIResponse(json);
  }
}

function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
}

function toOpenAIInput(messages: Message[]): unknown[] {
  const input: unknown[] = [];
  for (const msg of messages) {
    const messageContent: unknown[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        messageContent.push({ type: "input_text", text: block.text });
      } else if (block.type === "image") {
        messageContent.push({
          type: "input_image",
          image_url: `data:${block.mediaType};base64,${block.data}`,
          detail: "auto",
        });
      } else if (block.type === "tool_use") {
        input.push(
          block.providerItem ??
            ({
              type: "function_call",
              call_id: block.id,
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            } satisfies Record<string, unknown>)
        );
      } else if (block.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: block.toolUseId,
          output: block.content,
        });
      } else if (block.type === "provider_item" && block.provider === "openai") {
        input.push(block.item);
      }
    }
    if (messageContent.length) {
      input.push({ role: msg.role, content: messageContent });
    }
  }
  return input;
}

function fromOpenAIResponse(json: unknown): ModelResponse {
  const obj = asRecord(json);
  const output = asArray(obj.output);
  const content: ContentBlock[] = [];

  for (const item of output) {
    const rec = asRecord(item);
    const type = rec.type;
    if (type === "function_call") {
      content.push(functionCallToToolUse(rec));
    } else if (type === "message") {
      content.push(...messageToTextBlocks(rec));
      content.push({ type: "provider_item", provider: "openai", item });
    } else if (type === "reasoning") {
      content.push({ type: "provider_item", provider: "openai", item });
    } else {
      content.push({ type: "provider_item", provider: "openai", item });
    }
  }

  const usage = asRecord(obj.usage);
  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  return {
    content,
    stopReason: typeof obj.status === "string" ? obj.status : null,
    usage: {
      inputTokens: numberOrZero(usage.input_tokens),
      outputTokens: numberOrZero(usage.output_tokens),
      cacheReadTokens: numberOrZero(inputDetails.cached_tokens),
      cacheWriteTokens: 0,
      reasoningOutputTokens: numberOrZero(outputDetails.reasoning_tokens),
    },
  };
}

function functionCallToToolUse(rec: Record<string, unknown>): ToolUseBlock {
  const name = typeof rec.name === "string" ? rec.name : "";
  const callId =
    typeof rec.call_id === "string"
      ? rec.call_id
      : typeof rec.id === "string"
        ? rec.id
        : `openai_call_${Math.random().toString(36).slice(2)}`;
  const rawArgs = typeof rec.arguments === "string" ? rec.arguments : "{}";
  let input: unknown = {};
  try {
    input = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    input = {};
  }
  return {
    type: "tool_use",
    id: callId,
    name,
    input,
    providerItem: rec,
  };
}

function messageToTextBlocks(rec: Record<string, unknown>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const c of asArray(rec.content)) {
    const item = asRecord(c);
    if (item.type === "output_text" && typeof item.text === "string") {
      blocks.push({ type: "text", text: item.text });
    }
  }
  return blocks;
}

function formatOpenAIError(json: unknown): string {
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
