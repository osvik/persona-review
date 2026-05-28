import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { State, Action } from "../state.js";
import { describeSubmitData } from "../../submit-data.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

type Choice = "no" | "yes";

export function SubmitConsentScreen({ state, dispatch }: Props) {
  const persona = state.personas.find((p) => p.id === state.personaId);

  useInput((_input, key) => {
    if (key.escape) {
      dispatch({ type: "NAVIGATE", screen: "form" });
    }
  });

  if (!persona || !state.submitData) {
    // Defensive — handleRun() in the form is supposed to populate both
    // before navigating here. If we ever land here without them, bounce
    // back to the form so the user can investigate.
    return (
      <Box flexDirection="column">
        <Text color={colors.error} bold>
          Internal error: missing persona or submit-data on consent screen.
        </Text>
        <KeyHint hints={["Esc back to form"]} />
      </Box>
    );
  }

  const sourceLine = state.submitDataPath
    ? `Source: ${state.submitDataPath}`
    : "Source: bundled submit-data.yaml (pass --submit-data <path> in the CLI, or set it in Settings)";

  const identityBlock = describeSubmitData(state.submitData, persona);

  const items: { key: string; label: string; value: Choice }[] = [
    { key: "no", label: "No, cancel", value: "no" },
    { key: "yes", label: "Yes, continue and submit", value: "yes" },
  ];

  return (
    <Box flexDirection="column">
      <Text color={colors.warning} bold>
        === --allow-submit: form submission ENABLED for this run ===
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Target URL: {state.url}</Text>
        <Text>
          Persona:    {persona.name} ({persona.id})
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>{sourceLine}</Text>
        <Text>Test identity that will be typed into form fields:</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {identityBlock.split("\n").map((line, i) => (
          <Text key={`id-${i}`}>{"  " + line}</Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          This may create a real record in the target site's CRM, marketing
        </Text>
        <Text>
          automation, or analytics. Records will be findable by the name and
        </Text>
        <Text>
          email above; delete them after the run.
        </Text>
        <Text>
          Hard limit: at most one successful submission per session.
        </Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput<Choice>
          items={items}
          onSelect={(item) => {
            if (item.value === "yes") {
              dispatch({ type: "RESET_RUN" });
              dispatch({ type: "NAVIGATE", screen: "review" });
            } else {
              dispatch({ type: "NAVIGATE", screen: "form" });
            }
          }}
        />
      </Box>
      <KeyHint
        hints={["↑↓ navigate", "Enter select", "Esc cancel", "Ctrl-C quit"]}
      />
    </Box>
  );
}
