import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import type { State, Action } from "../state.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";
import { availableModelsFor, formatUsd } from "../../cost.js";
import {
  defaultModelForProvider,
  PROVIDER_ENV_VARS,
} from "../../agent.js";
import { lookupApiKey } from "../../keys.js";
import {
  isSubmitDataYamlPath,
  loadSubmitData,
} from "../../submit-data.js";
import {
  parsePositiveInteger,
  parsePositiveNumber,
} from "../validate.js";
import { USER_DEFAULTS_PATH, writeUserDefaults } from "../../defaults.js";
import type { Provider } from "../../llm/types.js";

type MenuValue =
  | "provider"
  | "model"
  | "manageKeys"
  | "submit"
  | "downloads"
  | "crossPageNav"
  | "fullPage"
  | "submitData"
  | "costCap"
  | "maxActions"
  | "maxTokens"
  | "saveDefaults";

type Mode =
  | { kind: "menu" }
  | { kind: "edit-provider" }
  | { kind: "edit-model" }
  | { kind: "edit-cost-cap"; draft: string }
  | { kind: "edit-max-actions"; draft: string }
  | { kind: "edit-max-tokens"; draft: string }
  | { kind: "edit-submit-data"; draft: string };

const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

export function SettingsScreen({ state, dispatch }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "menu" });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Esc returns to form (from menu OR edit modes). q only in menu mode so
  // it doesn't fight TextInput typing.
  useInput((input, key) => {
    if (key.escape) {
      if (mode.kind === "menu") {
        dispatch({ type: "NAVIGATE", screen: "form" });
      } else {
        setMode({ kind: "menu" });
        setError(null);
      }
      return;
    }
    if (mode.kind === "menu" && input === "q") {
      dispatch({ type: "NAVIGATE", screen: "form" });
    }
  });

  if (mode.kind === "edit-provider") {
    return (
      <ProviderEditor
        state={state}
        dispatch={dispatch}
        onDone={() => setMode({ kind: "menu" })}
      />
    );
  }

  if (mode.kind === "edit-model") {
    return (
      <ModelEditor
        state={state}
        dispatch={dispatch}
        onDone={() => setMode({ kind: "menu" })}
      />
    );
  }

  if (mode.kind !== "menu") {
    return (
      <TextEditScreen
        mode={mode}
        setMode={setMode}
        error={error}
        setError={setError}
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
  const modelLabel = state.model
    ? state.model
    : `(default — ${defaultModelForProvider(state.provider)})`;

  // Recompute per render so changes from the apiKeys screen show up.
  let setCount = 0;
  for (const p of PROVIDERS) {
    if (lookupApiKey(PROVIDER_ENV_VARS[p]).value) setCount++;
  }
  const missingCount = PROVIDERS.length - setCount;
  const keysLabel = `(${setCount} set, ${missingCount} missing)`;

  const menuItems: { key: string; label: string; value: MenuValue }[] = [
    {
      key: "provider",
      label: `${label("Provider")}${state.provider}`,
      value: "provider",
    },
    {
      key: "model",
      label: `${label("Model")}${modelLabel}`,
      value: "model",
    },
    {
      key: "manageKeys",
      label: `${label("Manage API keys…")}${keysLabel}`,
      value: "manageKeys",
    },
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
      key: "fullPage",
      label: `${label("Full-page snapshot")}${onOff(state.fullPage)}`,
      value: "fullPage",
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
    {
      key: "saveDefaults",
      label: `▶ Save current settings as default (writes ${USER_DEFAULTS_PATH})`,
      value: "saveDefaults",
    },
  ];

  const handleSelect = (v: MenuValue) => {
    setError(null);
    setFlash(null);
    switch (v) {
      case "provider":
        setMode({ kind: "edit-provider" });
        return;
      case "model":
        setMode({ kind: "edit-model" });
        return;
      case "manageKeys":
        dispatch({ type: "NAVIGATE", screen: "apiKeys" });
        return;
      case "submit":
        dispatch({ type: "TOGGLE_ALLOW_SUBMIT" });
        return;
      case "downloads":
        dispatch({ type: "TOGGLE_ALLOW_DOWNLOADS" });
        return;
      case "crossPageNav":
        dispatch({ type: "TOGGLE_ALLOW_CROSS_PAGE_NAVIGATION" });
        return;
      case "fullPage":
        dispatch({ type: "TOGGLE_FULL_PAGE" });
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
      case "saveDefaults":
        try {
          // Snapshot only fields owned by this screen. Persona and device
          // live in the form screen, so they're NOT saved here — saving
          // them as "current settings" would be misleading. URL is per-run
          // (not saved). API keys live in keys.yaml (handled separately
          // by the Manage API keys screen). CLI-only flags (json, repl,
          // replOnly, yes) are not surfaced in the TUI and not written.
          writeUserDefaults({
            provider: state.provider,
            model: state.model,
            maxOutputTokens: state.maxOutputTokens,
            maxActions: state.maxActions,
            costCapUsd: state.costCapUsd,
            fullPage: state.fullPage,
            allowSubmit: state.allowSubmit,
            allowDownloads: state.allowDownloads,
            allowCrossPageNavigation: state.allowCrossPageNavigation,
            submitDataPath: state.submitDataPath,
          });
          setFlash(`Saved current settings to ${USER_DEFAULTS_PATH}.`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(`Failed to save defaults: ${msg}`);
        }
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
      {flash && (
        <Box marginTop={1}>
          <Text color={colors.success} bold>
            {flash}
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

// --- Provider sub-mode -----------------------------------------------------

interface SubEditorProps {
  state: State;
  dispatch: React.Dispatch<Action>;
  onDone: () => void;
}

function ProviderEditor({ state, dispatch, onDone }: SubEditorProps) {
  const items = PROVIDERS.map((p) => {
    const envVar = PROVIDER_ENV_VARS[p];
    const ready = Boolean(lookupApiKey(envVar).value);
    const status = ready ? "set" : "missing";
    return {
      key: p,
      label: `${p.padEnd(12, " ")}(${envVar} ${status})`,
      value: p,
    };
  });
  const initialIndex = Math.max(
    0,
    PROVIDERS.findIndex((p) => p === state.provider)
  );

  return (
    <Box flexDirection="column">
      <Header />
      <Box marginTop={1}>
        <Text bold>Choose provider:</Text>
      </Box>
      <SelectInput<Provider>
        items={items}
        initialIndex={initialIndex}
        onSelect={(item) => {
          if (item.value !== state.provider) {
            dispatch({ type: "SET_PROVIDER", provider: item.value });
          }
          onDone();
        }}
      />
      <KeyHint hints={["↑↓ navigate", "Enter select", "Esc cancel"]} />
    </Box>
  );
}

// --- Model sub-mode --------------------------------------------------------

function ModelEditor({ state, dispatch, onDone }: SubEditorProps) {
  const def = defaultModelForProvider(state.provider);
  const priced = availableModelsFor(state.provider);
  type ModelValue = string;
  const useDefaultValue = "__use_default__";
  const items: { key: string; label: string; value: ModelValue }[] = [
    {
      key: useDefaultValue,
      label: `(use default — ${def})`,
      value: useDefaultValue,
    },
    ...priced.map((m) => ({
      key: m,
      label: m === def ? `${m}  (default)` : m,
      value: m,
    })),
  ];
  const currentIndex = state.model
    ? items.findIndex((i) => i.value === state.model)
    : 0;
  const initialIndex = currentIndex >= 0 ? currentIndex : 0;

  return (
    <Box flexDirection="column">
      <Header />
      <Box marginTop={1}>
        <Text bold>
          Choose model for <Text color={colors.accent}>{state.provider}</Text>:
        </Text>
      </Box>
      <SelectInput<ModelValue>
        items={items}
        initialIndex={initialIndex}
        onSelect={(item) => {
          dispatch({
            type: "SET_MODEL",
            model: item.value === useDefaultValue ? undefined : item.value,
          });
          onDone();
        }}
      />
      <KeyHint hints={["↑↓ navigate", "Enter select", "Esc cancel"]} />
    </Box>
  );
}

// --- Text-based editors (numeric + submit-data) ---------------------------

interface TextEditProps {
  mode: Exclude<
    Mode,
    { kind: "menu" } | { kind: "edit-provider" } | { kind: "edit-model" }
  >;
  setMode: (m: Mode) => void;
  error: string | null;
  setError: (e: string | null) => void;
  dispatch: React.Dispatch<Action>;
}

function TextEditScreen({
  mode,
  setMode,
  error,
  setError,
  dispatch,
}: TextEditProps) {
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
        Session-only by default. Pick "Save current settings as default"
        to persist to ~/.persona-review/defaults.yaml. Persona and
        device aren't covered here — they live in the form.
      </Text>
    </Box>
  );
}
