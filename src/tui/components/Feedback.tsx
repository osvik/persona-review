import React from "react";
import { Box, Text } from "ink";
import type { Feedback as FeedbackData } from "../../review.js";
import type { Persona } from "../../persona.js";
import { colors } from "../theme.js";

interface Props {
  persona: Persona;
  feedback: FeedbackData;
}

export function Feedback({ persona, feedback: f }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.accent} bold>
          ── {persona.name}'s feedback ({persona.id}) ──
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>{f.summary}</Text>
      </Box>

      {f.liked.length > 0 && (
        <Box marginTop={1}>
          <Text>
            <Text bold>Liked:       </Text>
            {f.liked.join("; ")}
          </Text>
        </Box>
      )}

      {f.confused_by.length > 0 && (
        <Box>
          <Text>
            <Text bold>Confused by: </Text>
            {f.confused_by.join("; ")}
          </Text>
        </Box>
      )}

      {f.abandoned_at && (
        <Box>
          <Text>
            <Text bold>Abandoned:   </Text>
            {f.abandoned_at}
          </Text>
        </Box>
      )}

      {f.friction.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Friction:</Text>
          {f.friction.map((x, i) => (
            <Text key={`fr-${i}`}>
              {"  - ["}
              <Text color={severityColor(x.severity)}>{x.severity}</Text>
              {"] "}
              {x.where}: "{x.quote}"
            </Text>
          ))}
        </Box>
      )}

      {f.accessibility_issues.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Accessibility concerns:</Text>
          {f.accessibility_issues.map((x, i) => (
            <Text key={`a11y-${i}`}>{"  - " + x}</Text>
          ))}
        </Box>
      )}

      {(f.trust_signals.positive.length > 0 ||
        f.trust_signals.negative.length > 0) && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Trust signals:</Text>
          {f.trust_signals.positive.map((x, i) => (
            <Text key={`tp-${i}`} color={colors.success}>
              {"  + " + x}
            </Text>
          ))}
          {f.trust_signals.negative.map((x, i) => (
            <Text key={`tn-${i}`} color={colors.error}>
              {"  - " + x}
            </Text>
          ))}
        </Box>
      )}

      {f.trace.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Trace:</Text>
          {f.trace.map((t, i) => (
            <Text key={`tr-${i}`}>
              {"  • " + t.step} — {t.reaction}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          — Note: simulation ≠ user research. This is a plausible reaction, not
          evidence.
        </Text>
      </Box>
    </Box>
  );
}

function severityColor(s: "low" | "medium" | "high"): string {
  if (s === "high") return colors.error;
  if (s === "medium") return colors.warning;
  return colors.accent;
}
