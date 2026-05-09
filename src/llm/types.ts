export type Provider = "anthropic" | "openai" | "google";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolChoice =
  | { type: "any" }
  | { type: "tool"; name: string };

export interface TextBlock {
  type: "text";
  text: string;
  cacheControl?: boolean;
}

export interface ImageBlock {
  type: "image";
  mediaType: "image/jpeg";
  data: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  providerItem?: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface ProviderItemBlock {
  type: "provider_item";
  provider: Provider;
  item: unknown;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | ProviderItemBlock;

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningOutputTokens: number;
}

export interface ModelResponse {
  content: ContentBlock[];
  usage: Usage;
  stopReason?: string | null;
}

export interface CreateModelResponseOptions {
  model: string;
  maxOutputTokens: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  toolChoice: ToolChoice;
  messages: Message[];
}

export interface ModelClient {
  provider: Provider;
  createResponse(opts: CreateModelResponseOptions): Promise<ModelResponse>;
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningOutputTokens: 0,
  };
}
