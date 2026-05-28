import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import type { State, Action } from "../state.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";
import { formatUsd } from "../../cost.js";
import {
  isSubmitDataYamlPath,
  loadSubmitData,
} from "../../submit-data.js";
import {
  parsePositiveInteger,
  parsePositiveNumber,
} from "../validate.js";

type MenuValue =
  | "submit"
  | "downloads"
  | "crossPageNav"
  | "submitData"
  | "costCap"
  | "maxActions"
  | "maxTokens";

type Mode =
  | { kind: "menu" }
  | { kind: "edit-cost-cap"; draft: string }
  | { kind: "edit-max-actions"; draft: string }
  | { kind: "edit-max-tokens"; draft: string }
  | { kind: "edit-submit-data"; draft: string };

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

export function SettingsScreen({ state, dispatch }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "menu" });
  const [error, setError] = useState<string | null>(null);

  // Esc returns to form (from menu OR edit modes). q only in menu mode so
  // it doesn't fight TextInput typing.
  useInput((input, key) => {
    if (key.escape) {
      dispatch({ type: "NAVIGATE", screen: "form" });
      return;
    }
    if (mode.kind === "menu" && input === "q") {
      dispatch({ type: "NAVIGATE", screen: "form" });
    }
  });

  if (mode.kind !== "menu") {
    return (
      <EditScreen
        mode={mode}
        setMode={setMode}
        error={error}
        setError={setError}
        state={state}
        dispatch={dispatch}
      />
    );
  }

  // Labels are width-padded so the values line up in a column.
  const label = (s: string) => s.padEnd(22, " ");
  const onOff = (b: boolean) => (b ? "on" : "off");
  const submitDataLabel = state.submitDataPath
    ? state.submitDataPath
    : "(bundled submit-data.yaml)";

  const menuItems: { key: string; label: string; value: MenuValue }[] = [
    {
      key: "submit",
      label: `${label("Submit forms")}${onOff(state.allowSubmit)}`,
      value: "submit",
    },
    {
      key: "downloads",
      label: `${label("Allow downloads")}${onOff(state.allowDownloads)}`,
      value: "downloads",
    },
    {
      key: "crossPageNav",
      label: `${label("Cross-page nav")}${onOff(state.allowCrossPageNavigation)}`,
      value: "crossPageNav",
    },
    {
      key: "submitData",
      label: `${label("Submit-data file")}${submitDataLabel}`,
      value: "submitData",
    },
    {
      key: "costCap",
      label: `${label("Cost cap")}${formatUsd(state.costCapUsd)}`,
      value: "costCap",
    },
    {
      key: "maxActions",
      label: `${label("Max actions")}${state.maxActions}`,
      value: "maxActions",
    },
    {
      key: "maxTokens",
      label: `${label("Max tokens")}${state.maxOutputTokens}`,
      value: "maxTokens",
    },
  ];

  const handleSelect = (v: MenuValue) => {
    setError(null);
    switch (v) {
      case "submit":
        dispatch({ type: "TOGGLE_ALLOW_SUBMIT" });
        return;
      case "downloads":
        dispatch({ type: "TOGGLE_ALLOW_DOWNLOADS" });
        return;
      case "crossPageNav":
        dispatch({ type: "TOGGLE_ALLOW_CROSS_PAGE_NAVIGATION" });
        return;
      case "submitData":
        setMode({
          kind: "edit-submit-data",
          draft: state.submitDataPath ?? "",
        });
        return;
      case "costCap":
        setMode({ kind: "edit-cost-cap", draft: String(state.costCapUsd) });
        return;
      case "maxActions":
        setMode({
          kind: "edit-max-actions",
          draft: String(state.maxActions),
        });
        return;
      case "maxTokens":
        setMode({
          kind: "edit-max-tokens",
          draft: String(state.maxOutputTokens),
        });
        return;
    }
  };

  return (
    <Box flexDirection="column">
      <Header />
      {error && (
        <Box marginTop={1}>
          <Text color={colors.error} bold>
            {error}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <SelectInput<MenuValue>
          items={menuItems}
          onSelect={(item) => handleSelect(item.value)}
        />
      </Box>
      <KeyHint
        hints={["↑↓ navigate", "Enter toggle / edit", "Esc / q back", "Ctrl-C quit"]}
      />
    </Box>
  );
}

interface EditProps {
  mode: Exclude<Mode, { kind: "menu" }>;
  setMode: (m: Mode) => void;
  error: string | null;
  setError: (e: string | null) => void;
  state: State;
  dispatch: React.Dispatch<Action>;
}

function EditScreen({
  mode,
  setMode,
  error,
  setError,
  dispatch,
}: EditProps) {
  const [draft, setDraft] = useState(mode.draft);

  const updateDraft = (next: string) => {
    setDraft(next);
    if (error) setError(null);
  };

  const finish = (next: string) => {
    if (mode.kind === "edit-cost-cap") {
      const r = parsePositiveNumber(next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      dispatch({ type: "SET_COST_CAP", value: r.value });
    } else if (mode.kind === "edit-max-actions") {
      const r = parsePositiveInteger(next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      dispatch({ type: "SET_MAX_ACTIONS", value: r.value });
    } else if (mode.kind === "edit-max-tokens") {
      const r = parsePositiveInteger(next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      dispatch({ type: "SET_MAX_TOKENS", value: r.value });
    } else if (mode.kind === "edit-submit-data") {
      const trimmed = next.trim();
      if (!trimmed) {
        dispatch({ type: "SET_SUBMIT_DATA_PATH", path: undefined });
        dispatch({ type: "SET_SUBMIT_DATA", data: null });
        setMode({ kind: "menu" });
        return;
      }
      if (!isSubmitDataYamlPath(trimmed)) {
        setError("Path must end in .yaml or .yml.");
        return;
      }
      try {
        const parsed = loadSubmitData(trimmed);
        dispatch({ type: "SET_SUBMIT_DATA_PATH", path: trimmed });
        dispatch({ type: "SET_SUBMIT_DATA", data: parsed });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return;
      }
    }
    setMode({ kind: "menu" });
  };

  let prompt = "";
  let placeholder = "";
  switch (mode.kind) {
    case "edit-cost-cap":
      prompt = "Cost cap (USD): ";
      placeholder = "1.0";
      break;
    case "edit-max-actions":
      prompt = "Max actions per phase: ";
      placeholder = "15";
      break;
    case "edit-max-tokens":
      prompt = "Max output tokens: ";
      placeholder = "4096";
      break;
    case "edit-submit-data":
      prompt = "Submit-data file path: ";
      placeholder = "/absolute/path/to/submit-data.yaml (empty = bundled)";
      break;
  }

  return (
    <Box flexDirection="column">
      <Header />
      <Box marginTop={1}>
        <Text>{prompt}</Text>
        <TextInput
          value={draft}
          onChange={updateDraft}
          onSubmit={finish}
          placeholder={placeholder}
        />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color={colors.error} bold>
            {error}
          </Text>
        </Box>
      )}
      <KeyHint hints={["Enter save", "Esc cancel"]} />
    </Box>
  );
}

function Header() {
  return (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>
        persona-review · Settings
      </Text>
      <Text dimColor>
        Session-only — changes don't write to ~/.persona-review/defaults.yaml.
      </Text>
    </Box>
  );
}
