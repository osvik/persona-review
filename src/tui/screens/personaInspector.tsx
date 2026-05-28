import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { State, Action } from "../state.js";
import { findPersonaSource, type PersonaSource } from "../../persona.js";
import { colors } from "../theme.js";
import { KeyHint } from "../components/KeyHint.js";

interface Props {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const PAGE_SIZE = 18; // visible YAML lines per page

export function PersonaInspectorScreen({ state, dispatch }: Props) {
  const personaId = state.inspectingPersonaId;
  const persona = state.personas.find((p) => p.id === personaId);
  const [source, setSource] = useState<PersonaSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!personaId) {
      setLoading(false);
      setLoadError("No persona selected.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const src = await findPersonaSource(personaId);
        if (cancelled) return;
        if (!src) {
          setLoadError(`Could not find a YAML file for "${personaId}".`);
        } else {
          setSource(src);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  const lines = source ? source.raw.split("\n") : [];
  const maxOffset = Math.max(0, lines.length - PAGE_SIZE);

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "b") {
      dispatch({ type: "NAVIGATE", screen: "personas" });
      return;
    }
    if (!source) return;
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
    else if (key.pageUp) setOffset((o) => Math.max(0, o - PAGE_SIZE));
    else if (key.pageDown) setOffset((o) => Math.min(maxOffset, o + PAGE_SIZE));
    else if (input === "g") setOffset(0);
    else if (input === "G") setOffset(maxOffset);
  });

  return (
    <Box flexDirection="column">
      <Header persona={persona} source={source} />
      {loading && (
        <Box marginTop={1}>
          <Text dimColor>Loading YAML…</Text>
        </Box>
      )}
      {loadError && (
        <Box marginTop={1}>
          <Text color={colors.error} bold>
            {loadError}
          </Text>
        </Box>
      )}
      {source && (
        <Box flexDirection="column" marginTop={1}>
          {lines.slice(offset, offset + PAGE_SIZE).map((line, i) => (
            <Text key={`l${offset + i}`}>{line || " "}</Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>
              lines {offset + 1}–
              {Math.min(lines.length, offset + PAGE_SIZE)} of {lines.length}
            </Text>
          </Box>
        </Box>
      )}
      <KeyHint
        hints={[
          "↑↓ line",
          "PgUp/PgDn page",
          "g top",
          "G bottom",
          "q / Esc back",
        ]}
      />
    </Box>
  );
}

interface HeaderProps {
  persona: { id: string; name: string; role: string } | undefined;
  source: PersonaSource | null;
}

function Header({ persona, source }: HeaderProps) {
  const sourceTag = source
    ? source.isBuiltin
      ? "built-in"
      : `custom — ${source.filePath}`
    : "(loading…)";
  return (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>
        {persona ? `${persona.id} — ${persona.name}` : "(unknown persona)"}
      </Text>
      {persona && <Text>{persona.role}</Text>}
      <Text dimColor>{sourceTag}</Text>
    </Box>
  );
}
