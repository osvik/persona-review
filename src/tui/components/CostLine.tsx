import React from "react";
import { Box, Text } from "ink";
import { formatUsd } from "../../cost.js";
import type { Provider } from "../../llm/types.js";

interface ReviewCost {
  provider: Provider;
  model: string;
  actionsTaken: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCapUsd: number;
  costRemaining?: number;
  label?: string;
}

export function CostLine({
  provider,
  model,
  actionsTaken,
  inputTokens,
  outputTokens,
  costUsd,
  costCapUsd,
  costRemaining,
  label = "review",
}: ReviewCost) {
  const remainingPart =
    typeof costRemaining === "number"
      ? ` — ${formatUsd(costRemaining)} remaining`
      : "";
  return (
    <Box>
      <Text dimColor>
        [model: {provider}/{model} — {actionsTaken} {label} action(s) —{" "}
        {inputTokens} in + {outputTokens} out tokens — {formatUsd(costUsd)} of{" "}
        {formatUsd(costCapUsd)} cap{remainingPart}]
      </Text>
    </Box>
  );
}
