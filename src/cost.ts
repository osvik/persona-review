export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
}

// Public list prices, USD per million tokens.
// Update if Anthropic's prices change.
export const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    cacheWriteUsdPerMTok: 3.75,
    cacheReadUsdPerMTok: 0.3,
  },
  "claude-opus-4-7": {
    inputUsdPerMTok: 15,
    outputUsdPerMTok: 75,
    cacheWriteUsdPerMTok: 18.75,
    cacheReadUsdPerMTok: 1.5,
  },
};

export function pricingFor(model: string): ModelPricing {
  const p = PRICING[model];
  if (!p) {
    throw new Error(
      `No pricing entry for model "${model}". Add it to PRICING in src/cost.ts.`
    );
  }
  return p;
}

export function costFor(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const p = pricingFor(model);
  return (
    (inputTokens * p.inputUsdPerMTok +
      outputTokens * p.outputUsdPerMTok +
      cacheReadTokens * p.cacheReadUsdPerMTok +
      cacheWriteTokens * p.cacheWriteUsdPerMTok) /
    1_000_000
  );
}

export class CostTracker {
  private spent = 0;
  public readonly capUsd: number;
  public readonly model: string;

  constructor(capUsd: number, model: string) {
    this.capUsd = capUsd;
    this.model = model;
  }

  add(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0
  ): { usd: number; total: number } {
    const usd = costFor(
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
