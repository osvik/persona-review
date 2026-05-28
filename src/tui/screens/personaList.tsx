import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { State, Action } from "../state.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

export function PersonaListScreen({ state, dispatch }: Props) {
  useInput((input, key) => {
    if (key.escape || input === "q" || input === "b") {
      dispatch({ type: "NAVIGATE", screen: "form" });
    }
  });

  const items = state.personas.map((p) => ({
    key: p.id,
    label: `${p.id}  —  ${p.name}  —  ${p.role}`,
    value: p.id,
  }));

  return (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>
        Available personas ({state.personas.length})
      </Text>
      <Text dimColor>
        Enter on a persona to inspect its YAML. q / Esc to return.
      </Text>
      <Box marginTop={1}>
        <SelectInput<string>
          items={items}
          limit={10}
          onSelect={(item) =>
            dispatch({ type: "OPEN_PERSONA_INSPECTOR", personaId: item.value })
          }
        />
      </Box>
      <KeyHint
        hints={["↑↓ navigate", "Enter inspect YAML", "q / Esc back", "Ctrl-C quit"]}
      />
    </Box>
  );
}
