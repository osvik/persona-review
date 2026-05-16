import type { Provider } from "./llm/types.js";

export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
  promptTokenThreshold?: number;
  inputUsdPerMTokAboveThreshold?: number;
  outputUsdPerMTokAboveThreshold?: number;
  cacheWriteUsdPerMTokAboveThreshold?: number;
  cacheReadUsdPerMTokAboveThreshold?: number;
}

// Public list prices, USD per million tokens.
// Update if provider prices change.
export const PRICING: Record<string, ModelPricing> = {
  "anthropic:claude-sonnet-4-6": {
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    cacheWriteUsdPerMTok: 3.75,
    cacheReadUsdPerMTok: 0.3,
  },
  "anthropic:claude-opus-4-7": {
    inputUsdPerMTok: 15,
    outputUsdPerMTok: 75,
    cacheWriteUsdPerMTok: 18.75,
    cacheReadUsdPerMTok: 1.5,
  },
  "openai:gpt-5.5": {
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 30,
    cacheWriteUsdPerMTok: 5,
    cacheReadUsdPerMTok: 0.5,
  },
  "openai:gpt-5.4": {
    inputUsdPerMTok: 2.5,
    outputUsdPerMTok: 15,
    cacheWriteUsdPerMTok: 2.5,
    cacheReadUsdPerMTok: 0.25,
  },
  "openai:gpt-5.4-mini": {
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 4.5,
    cacheWriteUsdPerMTok: 0.75,
    cacheReadUsdPerMTok: 0.075,
  },
  "openai:gpt-5.4-nano": {
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 1.25,
    cacheWriteUsdPerMTok: 0.2,
    cacheReadUsdPerMTok: 0.02,
  },
  "google:gemini-3.1-pro-preview": {
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 12,
    cacheWriteUsdPerMTok: 2,
    cacheReadUsdPerMTok: 0.2,
    promptTokenThreshold: 200_000,
    inputUsdPerMTokAboveThreshold: 4,
    outputUsdPerMTokAboveThreshold: 18,
    cacheWriteUsdPerMTokAboveThreshold: 4,
    cacheReadUsdPerMTokAboveThreshold: 0.4,
  },
  "google:gemini-3.1-pro-preview-customtools": {
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 12,
    cacheWriteUsdPerMTok: 2,
    cacheReadUsdPerMTok: 0.2,
    promptTokenThreshold: 200_000,
    inputUsdPerMTokAboveThreshold: 4,
    outputUsdPerMTokAboveThreshold: 18,
    cacheWriteUsdPerMTokAboveThreshold: 4,
    cacheReadUsdPerMTokAboveThreshold: 0.4,
  },
};

function pricingKey(provider: Provider, model: string): string {
  return `${provider}:${model}`;
}

export function availableModelsFor(provider: Provider): string[] {
  const prefix = `${provider}:`;
  return Object.keys(PRICING)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort();
}

export function pricingFor(provider: Provider, model: string): ModelPricing {
  const p = PRICING[pricingKey(provider, model)];
  if (!p) {
    throw new Error(
      `No pricing entry for ${provider} model "${model}". Add it to PRICING in src/cost.ts.`
    );
  }
  return p;
}

export function costFor(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const p = pricingFor(provider, model);
  const thresholdApplies =
    p.promptTokenThreshold !== undefined && inputTokens > p.promptTokenThreshold;
  const inputRate =
    thresholdApplies && p.inputUsdPerMTokAboveThreshold !== undefined
      ? p.inputUsdPerMTokAboveThreshold
      : p.inputUsdPerMTok;
  const outputRate =
    thresholdApplies && p.outputUsdPerMTokAboveThreshold !== undefined
      ? p.outputUsdPerMTokAboveThreshold
      : p.outputUsdPerMTok;
  const cacheReadRate =
    thresholdApplies && p.cacheReadUsdPerMTokAboveThreshold !== undefined
      ? p.cacheReadUsdPerMTokAboveThreshold
      : p.cacheReadUsdPerMTok;
  const cacheWriteRate =
    thresholdApplies && p.cacheWriteUsdPerMTokAboveThreshold !== undefined
      ? p.cacheWriteUsdPerMTokAboveThreshold
      : p.cacheWriteUsdPerMTok;
  return (
    (inputTokens * inputRate +
      outputTokens * outputRate +
      cacheReadTokens * cacheReadRate +
      cacheWriteTokens * cacheWriteRate) /
    1_000_000
  );
}

export class CostTracker {
  private spent = 0;
  public readonly capUsd: number;
  public readonly provider: Provider;
  public readonly model: string;

  constructor(capUsd: number, provider: Provider, model: string) {
    this.capUsd = capUsd;
    this.provider = provider;
    this.model = model;
  }

  add(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0
  ): { usd: number; total: number } {
    const usd = costFor(
      this.provider,
      this.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens
    );
    this.spent += usd;
    return { usd, total: this.spent };
  }

  total(): number {
    return this.spent;
  }

  remaining(): number {
    return Math.max(0, this.capUsd - this.spent);
  }

  exceeded(): boolean {
    return this.spent > this.capUsd;
  }
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}
