import React from "react";
import { render } from "ink";
import { listPersonas } from "../persona.js";
import { lookupApiKey } from "../keys.js";
import { PROVIDER_ENV_VARS } from "../agent.js";
import {
  closeConversation,
  type PersonaConversation,
} from "../agent.js";
import type { UserDefaults } from "../defaults.js";
import { App } from "./app.js";
import { initialState, type ApiKeyState } from "./state.js";

export interface RunTuiOptions {
  userDefaults: Partial<UserDefaults>;
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      "Error: --ui requires an interactive terminal (TTY).\n" +
        "If you are running over SSH, retry with 'ssh -t'. The TUI is not " +
        "supported in non-interactive shells, CI, or piped input."
    );
    process.exit(1);
  }

  const personas = await listPersonas();
  const provider = opts.userDefaults.provider ?? "anthropic";
  const envVar = PROVIDER_ENV_VARS[provider];
  const lookup = lookupApiKey(envVar);
  const apiKey: ApiKeyState = {
    ready: Boolean(lookup.value),
    envVar: lookup.name,
    source: lookup.source,
    filePath: lookup.filePath,
  };

  const initial = initialState(opts.userDefaults, personas, apiKey);

  // Track the live conversation so we can guarantee browser cleanup on exit,
  // including crashes that bypass React effect cleanups.
  let activeConv: PersonaConversation | null = null;
  const closeActive = async () => {
    if (activeConv) {
      try {
        await closeConversation(activeConv);
      } catch {
        /* best effort */
      }
      activeConv = null;
    }
  };
  const sigintHandler = () => {
    void closeActive().finally(() => process.exit(130));
  };
  process.on("SIGINT", sigintHandler);
  process.on("exit", () => {
    // Last-chance sync best-effort: closeConversation is async, so the
    // promise may not fully resolve before exit. Better than nothing for
    // crash paths; clean exits go through SIGINT or waitUntilExit below.
    if (activeConv) {
      void closeConversation(activeConv);
    }
  });

  const app = render(
    <App
      initial={initial}
      onConvChange={(conv) => {
        activeConv = conv;
      }}
    />
  );

  try {
    await app.waitUntilExit();
  } finally {
    process.off("SIGINT", sigintHandler);
    await closeActive();
  }
}
