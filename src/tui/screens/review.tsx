import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import type { State, Action } from "../state.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";
import { StatusLog } from "../components/StatusLog.js";
import { Feedback } from "../components/Feedback.js";
import { CostLine } from "../components/CostLine.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

export function ReviewScreen({ state, dispatch }: Props) {
  const persona = state.personas.find((p) => p.id === state.personaId);
  const reviewDone = state.review !== null;

  useInput((input, key) => {
    if (!reviewDone) return;
    if (input === "r") {
      dispatch({ type: "NAVIGATE", screen: "repl" });
    } else if (input === "n" || key.escape || input === "b") {
      // Back to form for another run
      dispatch({ type: "RESET_RUN" });
      dispatch({ type: "NAVIGATE", screen: "form" });
    } else if (input === "q") {
      dispatch({ type: "NAVIGATE", screen: "done" });
    }
  });

  if (state.error && !state.review) {
    return (
      <Box flexDirection="column">
        <Text color={colors.error} bold>
          Review failed: {state.error}
        </Text>
        <Box marginTop={1}>
          <StatusLog lines={state.statusLog} visible={20} />
        </Box>
        <KeyHint hints={["Press q to quit, or wait for screen change"]} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.accent} bold>
          {reviewDone ? "Review complete" : "Reviewing..."}
        </Text>
      </Box>
      <Text dimColor>
        {persona ? `${persona.name} (${persona.id})` : state.personaId} ·{" "}
        {state.url}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <StatusLog lines={state.statusLog} visible={reviewDone ? 6 : 16} />
        {!reviewDone && (
          <Box marginTop={1}>
            <Text color={colors.accent}>
              <Spinner type="dots" />
            </Text>
            <Text> running...</Text>
          </Box>
        )}
      </Box>

      {reviewDone && state.review && persona && (
        <Box flexDirection="column" marginTop={1}>
          <Feedback persona={persona} feedback={state.review.feedback} />
          <Box marginTop={1}>
            <CostLine
              provider={state.review.provider}
              model={state.review.model}
              actionsTaken={state.review.actionsTaken}
              inputTokens={state.review.inputTokens}
              outputTokens={state.review.outputTokens}
              costUsd={state.review.costUsd}
              costCapUsd={state.review.costCapUsd}
              label="review"
            />
          </Box>
        </Box>
      )}

      <KeyHint
        hints={
          reviewDone
            ? ["r enter chat", "n new review", "q quit"]
            : ["Ctrl-C cancel"]
        }
      />
    </Box>
  );
}
