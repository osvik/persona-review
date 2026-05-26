import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { State, Action } from "../state.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const PAGE_SIZE = 4; // personas per page; each persona block is multi-line

export function PersonaListScreen({ state, dispatch }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(state.personas.length / PAGE_SIZE));

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "b") {
      dispatch({ type: "NAVIGATE", screen: "form" });
    } else if (key.rightArrow || input === " " || input === "n") {
      setPage((p) => Math.min(totalPages - 1, p + 1));
    } else if (key.leftArrow || input === "p") {
      setPage((p) => Math.max(0, p - 1));
    }
  });

  const start = page * PAGE_SIZE;
  const visible = state.personas.slice(start, start + PAGE_SIZE);

  return (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>
        Available personas ({state.personas.length})
      </Text>
      <Text dimColor>
        Page {page + 1} / {totalPages}. Use ← → to page, q to return.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((p) => (
          <Box key={p.id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={colors.accent} bold>
                {p.id}
              </Text>
              <Text>  —  {p.name}</Text>
            </Text>
            <Text>  {p.role}</Text>
            <Text dimColor>
              {`  device=${p.device}  tech=${p.tech_confidence}  ` +
                `engagement=${p.cause_engagement}  scrutiny=${p.scrutiny}  ` +
                `reading=${p.reading_level}`}
            </Text>
            {p.accessibility.length > 0 && (
              <Text dimColor>{`  accessibility: ${p.accessibility.join(", ")}`}</Text>
            )}
          </Box>
        ))}
      </Box>
      <KeyHint
        hints={["← prev", "→ next", "q/Esc back to form", "Ctrl-C quit"]}
      />
    </Box>
  );
}
