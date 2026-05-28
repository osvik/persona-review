import React, { useEffect, useReducer, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  closeConversation,
  openConversation,
  runReviewLoop,
  type PersonaConversation,
} from "../agent.js";
import { reducer, type State } from "./state.js";
import { FormScreen } from "./screens/form.js";
import { PersonaListScreen } from "./screens/personaList.js";
import { SettingsScreen } from "./screens/settings.js";
import { SubmitConsentScreen } from "./screens/submitConsent.js";
import { ReviewScreen } from "./screens/review.js";
import { ReplScreen } from "./screens/repl.js";
import { colors } from "./theme.js";
import { KeyHint } from "./components/KeyHint.js";

interface Props {
  initial: State;
  onConvChange?: (conv: PersonaConversation | null) => void;
}

export function App({ initial, onConvChange }: Props) {
  const [state, dispatch] = useReducer(reducer, initial);
  const { exit } = useApp();
  const convRef = useRef<PersonaConversation | null>(null);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    }
  });

  // Mirror conv into a ref so the cleanup effect can close it on exit.
  useEffect(() => {
    convRef.current = state.conv;
    onConvChange?.(state.conv);
  }, [state.conv, onConvChange]);

  // Close the browser session when the app unmounts (clean exit).
  useEffect(() => {
    return () => {
      if (convRef.current) {
        void closeConversation(convRef.current);
        convRef.current = null;
      }
    };
  }, []);

  // Auto-exit when state.screen === "done".
  useEffect(() => {
    if (state.screen === "done") {
      // Allow one render cycle so the user sees the goodbye text.
      const t = setTimeout(() => exit(), 50);
      return () => clearTimeout(t);
    }
  }, [state.screen, exit]);

  // Drive the review pipeline when navigating to "review".
  useEffect(() => {
    if (state.screen !== "review") return;
    if (state.busy || state.review || state.error) return;

    const persona = state.personas.find((p) => p.id === state.personaId);
    if (!persona) {
      dispatch({ type: "ERROR", error: `Persona "${state.personaId}" not found.` });
      return;
    }
    if (!state.url) {
      dispatch({ type: "ERROR", error: "URL is required." });
      return;
    }

    let cancelled = false;
    dispatch({ type: "BUSY", busy: true });

    void (async () => {
      let conv: PersonaConversation | null = null;
      try {
        conv = await openConversation(persona, state.url, {
          provider: state.provider,
          model: state.model,
          maxOutputTokens: state.maxOutputTokens,
          maxActions: state.maxActions,
          costCapUsd: state.costCapUsd,
          fullPage: state.fullPage,
          device: state.device,
          allowSubmit: state.allowSubmit,
          allowDownloads: state.allowDownloads,
          allowCrossPageNavigation: state.allowCrossPageNavigation,
          submitData: state.submitData ?? undefined,
          onStatus: (msg) => {
            if (!cancelled) dispatch({ type: "STATUS", msg });
          },
        });
        if (cancelled) {
          await closeConversation(conv);
          return;
        }
        dispatch({ type: "CONV_READY", conv });
        const review = await runReviewLoop(conv);
        if (cancelled) return;
        dispatch({ type: "REVIEW_DONE", review });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) dispatch({ type: "ERROR", error: msg });
        if (conv) {
          try {
            await closeConversation(conv);
          } catch {
            /* best effort */
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately depends only on screen transition: once we enter "review",
    // we capture the form values for the whole run.
  }, [state.screen]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {state.screen === "form" && <FormScreen state={state} dispatch={dispatch} />}
      {state.screen === "personas" && (
        <PersonaListScreen state={state} dispatch={dispatch} />
      )}
      {state.screen === "settings" && (
        <SettingsScreen state={state} dispatch={dispatch} />
      )}
      {state.screen === "submitConsent" && (
        <SubmitConsentScreen state={state} dispatch={dispatch} />
      )}
      {state.screen === "review" && (
        <ReviewScreen state={state} dispatch={dispatch} />
      )}
      {state.screen === "repl" && <ReplScreen state={state} dispatch={dispatch} />}
      {state.screen === "done" && (
        <Box flexDirection="column">
          <Text color={colors.accent} bold>
            Goodbye.
          </Text>
          <KeyHint hints={["closing browser session..."]} />
        </Box>
      )}
    </Box>
  );
}
