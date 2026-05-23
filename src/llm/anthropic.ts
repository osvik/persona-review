import Anthropic from "@anthropic-ai/sdk";
import { getRequiredApiKey } from "../keys.js";
import type {
  ContentBlock,
  CreateModelResponseOptions,
  ImageBlock,
  Message,
  ModelClient,
  ModelResponse,
  TextBlock,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock,
} from "./types.js";

export class AnthropicClient implements ModelClient {
  public readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey = getRequiredApiKey("ANTHROPIC_API_KEY")) {
    if (!apiKey.trim()) {
      throw new Error(
        "ANTHROPIC_API_KEY is required. Set it as an environment variable or add it to ~/.persona-review/keys.yaml."
      );
    }
    this.client = new Anthropic({ apiKey: apiKey.trim() });
  }

  async createResponse(
    opts: CreateModelResponseOptions
  ): Promise<ModelResponse> {
    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxOutputTokens,
      system: [
        {
          type: "text",
          text: opts.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: opts.tools.map(toAnthropicTool),
      tool_choice:
        opts.toolChoice.type === "tool"
          ? { type: "tool", name: opts.toolChoice.name }
          : { type: "any" },
      messages: withCacheBreakpoint(opts.messages).map(toAnthropicMessage),
    });

    const usage = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };

    return {
      content: response.content.map(fromAnthropicBlock),
      stopReason: response.stop_reason,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        reasoningOutputTokens: 0,
      },
    };
  }
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

function toAnthropicMessage(msg: Message): Anthropic.MessageParam {
  return {
    role: msg.role,
    content: msg.content
      .map(toAnthropicBlock)
      .filter((b): b is Anthropic.ContentBlockParam => b !== null),
  };
}

function toAnthropicBlock(block: ContentBlock): Anthropic.ContentBlockParam | null {
  if (block.type === "text") {
    const out: Anthropic.TextBlockParam = {
      type: "text",
      text: block.text,
    };
    if (block.cacheControl) out.cache_control = { type: "ephemeral" };
    return out;
  }
  if (block.type === "image") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mediaType,
        data: block.data,
      },
    };
  }
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  if (block.type === "tool_result") {
    return {
      type: "tool_result",
      tool_use_id: block.toolUseId,
      content: block.content,
      is_error: block.isError,
    };
  }
  return null;
}

function fromAnthropicBlock(block: Anthropic.ContentBlock): ContentBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  return {
    type: "provider_item",
    provider: "anthropic",
    item: block,
  };
}

function withCacheBreakpoint(messages: Message[]): Message[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return messages;
  return messages.map((msg, idx) => {
    if (idx !== lastAssistantIdx) return msg;
    if (!msg.content.length) return msg;
    const blocks = msg.content.map((b) =>
      b.type === "text" ? ({ ...b } satisfies TextBlock) : b
    );
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === "text") {
        (blocks[i] as TextBlock).cacheControl = true;
        return { ...msg, content: blocks };
      }
    }
    const last = blocks[blocks.length - 1];
    if (last.type === "tool_use") {
      blocks[blocks.length - 1] = { ...last } satisfies ToolUseBlock;
    } else if (last.type === "tool_result") {
      blocks[blocks.length - 1] = { ...last } satisfies ToolResultBlock;
    } else if (last.type === "image") {
      blocks[blocks.length - 1] = { ...last } satisfies ImageBlock;
    }
    return { ...msg, content: blocks };
  });
}
