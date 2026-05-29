import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import type { State, Action } from "../state.js";
import type { Persona } from "../../persona.js";
import type { SessionDevice } from "../../browser.js";
import { loadSubmitData } from "../../submit-data.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";

type Mode = "menu" | "editing-url" | "editing-persona" | "editing-device";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

export function FormScreen({ state, dispatch }: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [urlDraft, setUrlDraft] = useState(state.url);
  const [error, setError] = useState<string | null>(null);

  const persona = state.personas.find((p) => p.id === state.personaId);

  useInput(
    (input) => {
      if (input === "p") dispatch({ type: "NAVIGATE", screen: "personas" });
      else if (input === "s") dispatch({ type: "NAVIGATE", screen: "settings" });
    },
    { isActive: mode === "menu" }
  );

  if (mode === "editing-url") {
    return (
      <Box flexDirection="column">
        <Header />
        <Box marginTop={1}>
          <Text>URL: </Text>
          <TextInput
            value={urlDraft}
            onChange={setUrlDraft}
            onSubmit={(v) => {
              const trimmed = v.trim();
              dispatch({ type: "SET_URL", url: trimmed });
              setUrlDraft(trimmed);
              setMode("menu");
            }}
            placeholder="https://example.org/"
          />
        </Box>
        <KeyHint hints={["Enter save and return"]} />
      </Box>
    );
  }

  if (mode === "editing-persona") {
    type V = string;
    const items = state.personas.map((p) => ({
      key: p.id,
      label: `${p.id}  —  ${p.name}`,
      value: p.id,
    }));
    const initialIndex = Math.max(
      0,
      state.personas.findIndex((p) => p.id === state.personaId)
    );
    return (
      <Box flexDirection="column">
        <Header />
        <Box marginTop={1}>
          <Text bold>Choose persona:</Text>
        </Box>
        <SelectInput<V>
          items={items}
          initialIndex={initialIndex}
          limit={10}
          onSelect={(item) => {
            dispatch({ type: "SET_PERSONA_ID", personaId: item.value });
            setMode("menu");
          }}
        />
        <KeyHint hints={["↑↓ navigate", "Enter select"]} />
      </Box>
    );
  }

  if (mode === "editing-device") {
    type V = SessionDevice | undefined;
    const items: { key: string; label: string; value: V }[] = [
      { key: "auto", label: "auto  (use persona's default)", value: undefined },
      { key: "mobile", label: "mobile  (390 × 844, iOS Safari)", value: "mobile" },
      { key: "desktop", label: "desktop  (1280 × 800, Chrome macOS)", value: "desktop" },
    ];
    const initialIndex = items.findIndex((i) => i.value === state.device);
    return (
      <Box flexDirection="column">
        <Header />
        <Box marginTop={1}>
          <Text bold>Choose device:</Text>
        </Box>
        <SelectInput<V>
          items={items}
          initialIndex={initialIndex >= 0 ? initialIndex : 0}
          onSelect={(item) => {
            dispatch({ type: "SET_DEVICE", device: item.value });
            setMode("menu");
          }}
        />
        <KeyHint hints={["↑↓ navigate", "Enter select"]} />
      </Box>
    );
  }

  // Mode: menu
  const handleRun = () => {
    if (!state.url) {
      setError("URL is required.");
      return;
    }
    if (!state.apiKey.ready) {
      setError(
        `${state.apiKey.envVar} is not set. Add it to ${state.apiKey.filePath} or export it before running.`
      );
      return;
    }
    if (!persona) {
      setError(`Persona "${state.personaId}" not found.`);
      return;
    }
    if (state.allowSubmit) {
      // Parse the submit-data file now so the consent screen can render the
      // resolved identity. Re-parse every Run so the file can change between
      // Settings save and the actual run.
      try {
        const data = loadSubmitData(state.submitDataPath);
        dispatch({ type: "SET_SUBMIT_DATA", data });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`submit-data: ${msg}`);
        return;
      }
      setError(null);
      dispatch({ type: "NAVIGATE", screen: "submitConsent" });
      return;
    }
    setError(null);
    dispatch({ type: "RESET_RUN" });
    dispatch({ type: "NAVIGATE", screen: "review" });
  };

  type MenuValue =
    | "url"
    | "persona"
    | "device"
    | "settings"
    | "browse"
    | "run";
  const menuItems: { key: string; label: string; value: MenuValue }[] = [
    {
      key: "url",
      label: `URL      —  ${state.url || "(not set)"}`,
      value: "url",
    },
    {
      key: "persona",
      label: `Persona  —  ${state.personaId}${persona ? `  (${persona.name})` : ""}`,
      value: "persona",
    },
    {
      key: "device",
      label: `Device   —  ${describeDevice(state.device, persona)}`,
      value: "device",
    },
    { key: "settings", label: "Settings (toggles, cost cap, max actions, max tokens, submit-data)", value: "settings" },
    { key: "browse", label: "Browse personas (full list with summaries)", value: "browse" },
    { key: "run", label: "▶ Run review", value: "run" },
  ];

  return (
    <Box flexDirection="column">
      <Header />
      {!state.apiKey.ready && (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.error} bold>
            {state.apiKey.envVar} is not set.
          </Text>
          <Text dimColor>
            Add it to {state.apiKey.filePath}, or export it before running.
          </Text>
        </Box>
      )}
      {phase2Warning(state) && (
        <Box marginTop={1}>
          <Text color={colors.warning} bold>
            {phase2Warning(state)}
          </Text>
        </Box>
      )}
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
          onSelect={(item) => {
            const v = item.value;
            if (v === "url") setMode("editing-url");
            else if (v === "persona") setMode("editing-persona");
            else if (v === "device") setMode("editing-device");
            else if (v === "settings") dispatch({ type: "NAVIGATE", screen: "settings" });
            else if (v === "browse") dispatch({ type: "NAVIGATE", screen: "personas" });
            else handleRun();
          }}
        />
      </Box>
      <KeyHint
        hints={[
          "↑↓ navigate",
          "Enter select",
          "p browse personas",
          "s settings",
          "Ctrl-C quit",
        ]}
      />
    </Box>
  );
}

function Header() {
  return (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>
        persona-review · TUI
      </Text>
      <Text dimColor>Pick a URL, persona, and device, then run.</Text>
    </Box>
  );
}

function describeDevice(
  device: SessionDevice | undefined,
  persona: Persona | undefined
): string {
  if (device) return device;
  if (persona) {
    const resolved = persona.device === "mobile" ? "mobile" : "desktop";
    return `auto  (persona default: ${persona.device}, will use: ${resolved})`;
  }
  return "auto";
}

function phase2Warning(state: State): string | null {
  const parts: string[] = [];
  if (state.allowSubmit) parts.push("submit enabled");
  if (state.allowDownloads) parts.push("downloads enabled");
  if (state.allowCrossPageNavigation) parts.push("cross-page nav enabled");
  return parts.length ? `⚠ ${parts.join(" · ")}` : null;
}
