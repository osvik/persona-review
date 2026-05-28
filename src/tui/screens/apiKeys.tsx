import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import type { State, Action } from "../state.js";
import { PROVIDER_ENV_VARS } from "../../agent.js";
import {
  lookupApiKey,
  writeApiKey,
  USER_KEYS_PATH,
  type ApiKeyLookup,
} from "../../keys.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";
import type { Provider } from "../../llm/types.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

type Mode = { kind: "menu" } | { kind: "edit"; provider: Provider };

export function ApiKeysScreen({ state, dispatch }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "menu" });
  // Re-lookup all 3 keys on mount + after each successful save.
  const [lookups, setLookups] = useState<Record<Provider, ApiKeyLookup>>(() =>
    snapshotLookups()
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      if (mode.kind === "menu") {
        dispatch({ type: "NAVIGATE", screen: "settings" });
      } else {
        setMode({ kind: "menu" });
        setError(null);
      }
      return;
    }
    if (mode.kind === "menu" && input === "q") {
      dispatch({ type: "NAVIGATE", screen: "settings" });
    }
  });

  if (mode.kind === "edit") {
    return (
      <KeyEditor
        provider={mode.provider}
        currentLookup={lookups[mode.provider]}
        error={error}
        setError={setError}
        onCommitted={(refreshed) => {
          setLookups(refreshed);
          setMode({ kind: "menu" });
          // If the edited key matches the active provider, refresh the
          // form's banner via the global state.apiKey too.
          if (mode.provider === state.provider) {
            const lk = refreshed[state.provider];
            dispatch({
              type: "SET_API_KEY",
              apiKey: {
                ready: Boolean(lk.value),
                envVar: lk.name,
                source: lk.source,
                filePath: lk.filePath,
              },
            });
          }
        }}
        onCancel={() => {
          setMode({ kind: "menu" });
          setError(null);
        }}
        onFlash={setFlash}
      />
    );
  }

  const items = PROVIDERS.map((p) => {
    const lk = lookups[p];
    const status = describeStatus(lk);
    return {
      key: p,
      label: `${PROVIDER_ENV_VARS[p].padEnd(22, " ")}${status}`,
      value: p,
    };
  });

  return (
    <Box flexDirection="column">
      <Header />
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Writes go to {USER_KEYS_PATH}. Env vars override the file.
        </Text>
        {flash && (
          <Text color={colors.success} bold>
            {flash}
          </Text>
        )}
      </Box>
      <Box marginTop={1}>
        <SelectInput<Provider>
          items={items}
          onSelect={(item) => {
            setError(null);
            setFlash(null);
            setMode({ kind: "edit", provider: item.value });
          }}
        />
      </Box>
      <KeyHint hints={["↑↓ navigate", "Enter edit", "Esc / q back", "Ctrl-C quit"]} />
    </Box>
  );
}

function describeStatus(lk: ApiKeyLookup): string {
  if (!lk.value) return "missing";
  const last4 = lk.value.length >= 4 ? lk.value.slice(-4) : lk.value;
  const sourceLabel =
    lk.source === "environment"
      ? "env"
      : lk.source === "keys-file"
        ? "keys.yaml"
        : "missing";
  return `set    (${sourceLabel}, last 4: …${last4})`;
}

function snapshotLookups(): Record<Provider, ApiKeyLookup> {
  const out = {} as Record<Provider, ApiKeyLookup>;
  for (const p of PROVIDERS) {
    out[p] = lookupApiKey(PROVIDER_ENV_VARS[p]);
  }
  return out;
}

interface KeyEditorProps {
  provider: Provider;
  currentLookup: ApiKeyLookup;
  error: string | null;
  setError: (e: string | null) => void;
  onCommitted: (refreshed: Record<Provider, ApiKeyLookup>) => void;
  onCancel: () => void;
  onFlash: (msg: string) => void;
}

function KeyEditor({
  provider,
  currentLookup,
  error,
  setError,
  onCommitted,
  onCancel: _onCancel,
  onFlash,
}: KeyEditorProps) {
  const [draft, setDraft] = useState("");
  const [peek, setPeek] = useState(false);

  useInput((_input, key) => {
    // Tab toggles the mask. Using a non-printable key so it doesn't
    // double as a character added to the draft by ink-text-input.
    if (key.tab && draft.length > 0) {
      setPeek((p) => !p);
    }
  });

  const envVar = PROVIDER_ENV_VARS[provider];
  const fromEnv = currentLookup.source === "environment";

  const handleSubmit = (raw: string) => {
    const trimmed = raw.trim();
    try {
      writeApiKey(envVar, trimmed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return;
    }
    onFlash(
      trimmed.length === 0
        ? `Cleared ${envVar} from ${USER_KEYS_PATH}.`
        : `Saved ${envVar} to ${USER_KEYS_PATH}.`
    );
    onCommitted(snapshotLookups());
  };

  return (
    <Box flexDirection="column">
      <Header />
      <Box marginTop={1} flexDirection="column">
        <Text>
          Edit <Text bold>{envVar}</Text>{" "}
          <Text dimColor>(currently: {describeStatus(currentLookup)})</Text>
        </Text>
        {fromEnv && (
          <Box marginTop={1}>
            <Text color={colors.warning} bold>
              ⚠ This key is set via environment variable. Saving here writes to
              keys.yaml, but the env var will still take precedence.
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text>New value: </Text>
        <TextInput
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          mask={peek ? undefined : "*"}
          placeholder="(empty + Enter clears the entry)"
        />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color={colors.error} bold>
            {error}
          </Text>
        </Box>
      )}
      <KeyHint
        hints={[
          peek ? "Tab re-hide" : "Tab peek",
          "Enter save (empty clears)",
          "Esc cancel",
        ]}
      />
    </Box>
  );
}

function Header() {
  return (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>
        persona-review · API keys
      </Text>
      <Text dimColor>
        Per-provider keys. Values never display in full — only last 4 chars.
      </Text>
    </Box>
  );
}
