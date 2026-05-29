import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { State, Action } from "../state.js";
import { runFollowUpTurn } from "../../agent.js";
import { formatUsd } from "../../cost.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";
import { CostLine } from "../components/CostLine.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

export function ReplScreen({ state, dispatch }: Props) {
  const persona = state.personas.find((p) => p.id === state.personaId);
  const [draft, setDraft] = useState("");
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const conv = state.conv;
  const capReached =
    conv !== null && conv.costTracker.remaining() <= 0;

  useInput(
    (input) => {
      if (input === "q") {
        dispatch({ type: "NAVIGATE", screen: "done" });
      }
    },
    { isActive: state.busy || capReached }
  );

  const handleSubmit = async (raw: string) => {
    const question = raw.trim();
    if (!question) return;
    if (question === "exit" || question === "quit") {
      dispatch({ type: "NAVIGATE", screen: "done" });
      return;
    }
    if (!conv) {
      setErrorMsg("Conversation not initialized.");
      return;
    }
    setDraft("");
    setErrorMsg(null);
    setTurnStatus("thinking...");
    dispatch({ type: "BUSY", busy: true });
    try {
      const result = await runFollowUpTurn(conv, question);
      dispatch({
        type: "REPL_APPEND",
        turn: {
          q: question,
          a: result.answer,
          costUsd: result.costUsd,
          costRemaining: result.costRemaining,
          actionsTaken: result.actionsTaken,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      dispatch({ type: "BUSY", busy: false });
    } finally {
      setTurnStatus(null);
    }
  };

  const personaName = persona?.name ?? state.personaId;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.accent} bold>
          Chat with {personaName}
        </Text>
      </Box>
      {conv && (
        <Text dimColor>
          Cost cap shared with the review: {formatUsd(conv.costTracker.remaining())}{" "}
          of {formatUsd(conv.costCapUsd)} remaining.
        </Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {state.chat.map((turn, i) => (
          <Box key={`turn-${i}`} flexDirection="column" marginBottom={1}>
            <Text>
              <Text bold>{">"} You:</Text> {turn.q}
            </Text>
            <Text>
              <Text bold color={colors.accent}>{personaName}:</Text> {turn.a}
            </Text>
            {conv && (
              <CostLine
                provider={conv.provider}
                model={conv.model}
                actionsTaken={turn.actionsTaken}
                inputTokens={turn.inputTokens}
                outputTokens={turn.outputTokens}
                costUsd={turn.costUsd}
                costCapUsd={conv.costCapUsd}
                costRemaining={turn.costRemaining}
                label="follow-up"
              />
            )}
          </Box>
        ))}
      </Box>

      {errorMsg && (
        <Box marginTop={1}>
          <Text color={colors.error} bold>
            Error: {errorMsg}
          </Text>
        </Box>
      )}

      {capReached ? (
        <Box marginTop={1}>
          <Text color={colors.warning} bold>
            Cost cap reached — no further questions.
          </Text>
        </Box>
      ) : state.busy ? (
        <Box marginTop={1}>
          <Text color={colors.accent}>
            <Spinner type="dots" />
          </Text>
          <Text> {turnStatus ?? "working..."}</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text>{"> Ask "}{personaName}{": "}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={(v) => void handleSubmit(v)}
            placeholder='type "exit" to leave'
          />
        </Box>
      )}

      <KeyHint
        hints={
          capReached
            ? ["q quit"]
            : state.busy
              ? ["please wait"]
              : ["Enter ask", '"exit" or q to leave', "Ctrl-C quit"]
        }
      />
    </Box>
  );
}
