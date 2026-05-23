#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  DEFAULT_PERSONA_ID,
  listPersonas,
  loadPersonaById,
  type Persona,
} from "./persona.js";
import { type Feedback } from "./review.js";
import {
  openConversation,
  runReviewLoop,
  runFollowUpTurn,
  closeConversation,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MAX_ACTIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_COST_CAP_USD,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_PROVIDER,
  PROVIDER_ENV_VARS,
  defaultModelForProvider,
  type PersonaConversation,
} from "./agent.js";
import { availableModelsFor, formatUsd } from "./cost.js";
import {
  ensureUserDefaultsFile,
  loadUserDefaults,
  USER_DEFAULTS_PATH,
  USER_PERSONAS_DIR,
  type UserDefaults,
} from "./defaults.js";
import {
  describeSubmitData,
  isSubmitDataYamlPath,
  loadSubmitData,
  type SubmitData,
} from "./submit-data.js";
import { lookupApiKey, USER_KEYS_PATH } from "./keys.js";
import type { Provider } from "./llm/types.js";

interface Args extends UserDefaults {
  command:
    | "review"
    | "list-personas"
    | "status"
    | "help"
    | "version"
    | "install-browsers";
  url?: string;
}

interface ParsedArgs {
  command: Args["command"];
  url?: string;
  overrides: Partial<UserDefaults>;
}

interface PlaywrightRegistryModule {
  installBrowsersForNpmInstall(browsers: string[]): Promise<unknown>;
  registry: {
    resolveBrowsers(
      aliases: string[],
      options: { shell?: "no" | "only" | undefined }
    ): unknown[];
    installDeps(executables: unknown[], dryRun: boolean): Promise<unknown>;
  };
}

const SOFTWARE_DEFAULTS: UserDefaults = {
  json: false,
  personaId: DEFAULT_PERSONA_ID,
  provider: DEFAULT_PROVIDER,
  model: undefined,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxActions: DEFAULT_MAX_ACTIONS,
  costCapUsd: DEFAULT_COST_CAP_USD,
  fullPage: false,
  device: undefined,
  repl: false,
  replOnly: false,
  allowSubmit: false,
  allowDownloads: false,
  allowCrossPageNavigation: false,
  submitDataPath: undefined,
  yes: false,
};

const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];
const require = createRequire(import.meta.url);

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let url: string | undefined;
  const overrides: Partial<UserDefaults> = {};
  let command: Args["command"] = "review";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      command = "help";
    } else if (a === "-v" || a === "--version") {
      command = "version";
    } else if (
      a === "install-browsers" ||
      a === "install-browser" ||
      a === "--install-browsers" ||
      a === "--install-browser"
    ) {
      command = "install-browsers";
    } else if (a === "--status") {
      command = "status";
    } else if (a === "--list-personas") {
      command = "list-personas";
    } else if (a === "--json") {
      overrides.json = true;
    } else if (a === "--no-json") {
      overrides.json = false;
    } else if (a === "--full-page-snapshot") {
      overrides.fullPage = true;
    } else if (a === "--no-full-page-snapshot") {
      overrides.fullPage = false;
    } else if (a === "--repl") {
      overrides.repl = true;
    } else if (a === "--no-repl") {
      overrides.repl = false;
    } else if (a === "--repl-only") {
      overrides.replOnly = true;
    } else if (a === "--no-repl-only") {
      overrides.replOnly = false;
    } else if (a === "--allow-submit") {
      overrides.allowSubmit = true;
    } else if (a === "--no-allow-submit") {
      overrides.allowSubmit = false;
    } else if (a === "--allow-downloads") {
      overrides.allowDownloads = true;
    } else if (a === "--no-allow-downloads") {
      overrides.allowDownloads = false;
    } else if (a === "--allow-cross-page-navigation") {
      overrides.allowCrossPageNavigation = true;
    } else if (a === "--no-allow-cross-page-navigation") {
      overrides.allowCrossPageNavigation = false;
    } else if (a === "--submit-data") {
      const submitDataPath = readOptionValue(args, ++i, "--submit-data");
      if (!isSubmitDataYamlPath(submitDataPath)) {
        console.error("--submit-data must point to a .yaml or .yml file.");
        process.exit(1);
      }
      overrides.submitDataPath = submitDataPath;
    } else if (a === "--yes" || a === "-y") {
      overrides.yes = true;
    } else if (a === "--no-yes") {
      overrides.yes = false;
    } else if (a === "--persona") {
      overrides.personaId = readOptionValue(args, ++i, "--persona");
    } else if (a === "--provider") {
      const p = readOptionValue(args, ++i, "--provider");
      if (p !== "anthropic" && p !== "openai" && p !== "google") {
        console.error(`--provider must be 'anthropic', 'openai', or 'google'.`);
        process.exit(1);
      }
      overrides.provider = p;
    } else if (a === "--device") {
      const d = readOptionValue(args, ++i, "--device");
      if (d !== "mobile" && d !== "desktop") {
        console.error(`--device must be 'mobile' or 'desktop'.`);
        process.exit(1);
      }
      overrides.device = d;
    } else if (a === "--model") {
      overrides.model = readOptionValue(args, ++i, "--model");
    } else if (a === "--max-tokens") {
      overrides.maxOutputTokens = parsePositiveInteger(
        readOptionValue(args, ++i, "--max-tokens"),
        "--max-tokens"
      );
    } else if (a === "--max-actions") {
      overrides.maxActions = parsePositiveInteger(
        readOptionValue(args, ++i, "--max-actions"),
        "--max-actions"
      );
    } else if (a === "--cost-cap-usd") {
      overrides.costCapUsd = parsePositiveNumber(
        readOptionValue(args, ++i, "--cost-cap-usd"),
        "--cost-cap-usd"
      );
    } else if (!a.startsWith("-")) {
      if (url) {
        console.error(`Unexpected positional argument: ${a}`);
        process.exit(1);
      }
      url = a;
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }

  return {
    command,
    url,
    overrides,
  };
}

function resolveArgs(
  parsed: ParsedArgs,
  userDefaults: Partial<UserDefaults>
): Args {
  return {
    command: parsed.command,
    url: parsed.url,
    ...SOFTWARE_DEFAULTS,
    ...userDefaults,
    ...parsed.overrides,
  };
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    console.error(`${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${flag} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`${flag} must be a positive number.`);
    process.exit(1);
  }
  return parsed;
}

function getPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version?: unknown };

  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}

function printVersion() {
  console.log(`persona-review ${getPackageVersion()}`);
}

function playwrightRegistry(): PlaywrightRegistryModule {
  const packageJsonPath = require.resolve("playwright/package.json");
  const playwrightRequire = createRequire(packageJsonPath);
  return playwrightRequire(
    "playwright-core/lib/server/registry/index"
  ) as PlaywrightRegistryModule;
}

async function installBrowsers(): Promise<void> {
  const playwright = playwrightRegistry();
  if (process.platform === "linux") {
    console.error("Installing Linux host dependencies for Chromium...");
    const executables = playwright.registry.resolveBrowsers(["chromium"], {});
    await playwright.registry.installDeps(executables, false);
  }

  console.error(
    "Installing Chromium for the Playwright version bundled with persona-review..."
  );
  await playwright.installBrowsersForNpmInstall([
    "chromium",
    "chromium-headless-shell",
  ]);
}

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Looks like Playwright was just installed or updated") ||
    (message.includes("Executable doesn't exist") &&
      message.includes("playwright install"))
  );
}

function printMissingPlaywrightBrowserHelp() {
  console.error(
    [
      "Error: Chromium is not installed for persona-review's Playwright version.",
      "",
      "If you installed via npm/npx, install it with:",
      "  npx persona-review --install-browsers",
      "",
      "If you are in a development checkout, install it with:",
      "  npm run review -- --install-browsers",
      "",
      "Then retry your review command.",
      "",
      "Do not use plain `npx playwright install chromium` for the npm install path;",
      "that can install a browser for a different Playwright package.",
    ].join("\n")
  );
}

function printHelp(defaultsPath: string = USER_DEFAULTS_PATH) {
  const help = `persona-review — AI persona feedback for non-profit web pages

Usage:
  npx persona-review <url> [options]
  npx persona-review --status
  npx persona-review --list-personas
  npx persona-review --install-browsers
  npx persona-review --version
  or
  npm run review -- <url> [options]
  npm run review -- --status
  npm run review -- --list-personas
  npm run review -- --install-browsers
  npm run review -- --version

Options:
  --persona <id>          Persona archetype id (default: ${DEFAULT_PERSONA_ID}).
  --provider <name>       LLM provider: 'anthropic', 'openai', or 'google'
                          (default: ${DEFAULT_PROVIDER}).
  --device <m|d>          Override the persona's device: 'mobile' (390x844)
                          or 'desktop' (1280x800). Default: per-persona.
  --status                Show provider readiness, available --model ids,
                          and whether each default comes from software or
                          user defaults.
  --list-personas         Print available personas and exit.
  --install-browsers      Download Chromium for the Playwright version bundled
                          with persona-review. Run once after npm/npx install
                          or after a persona-review update. On Linux, this
                          also installs Chromium host dependencies.
  --json                  Emit JSON feedback instead of prose. Cannot be
                          combined with --repl or --repl-only.
  --repl                  After the initial review, enter an interactive
                          prompt to ask the persona follow-up questions.
                          The cost cap is shared across review + REPL.
  --repl-only             Skip the initial review; load the page and enter
                          the interactive prompt directly.
  --allow-downloads       Permit browser downloads. Default: downloads are
                          blocked by Playwright.
  --allow-cross-page-navigation
                          Permit persona clicks to navigate away from the
                          reviewed URL. Default: blocked; same-page anchors
                          and non-link UI controls still work.
  --allow-submit          Permit ONE form submission this session and ask
                          the persona to react to the resulting thank-you
                          or error page. Requires interactive consent.
  --submit-data <path>    Override the test identity used for form fills.
                          Must be a .yaml or .yml file
                          (default: ./submit-data.yaml).
  -y, --yes               Skip the --allow-submit consent prompt (for
                          automated runs).
  --model <id>            Provider-specific model id
                          (defaults: Anthropic ${DEFAULT_ANTHROPIC_MODEL},
                          OpenAI ${DEFAULT_OPENAI_MODEL},
                          Google ${DEFAULT_GOOGLE_MODEL}).
  --cost-cap-usd <n>      Hard cost cap in USD per (URL, persona) session
                          (default: ${DEFAULT_COST_CAP_USD}). Includes review + all REPL turns.
  --max-actions <n>       Soft cap on browser actions per phase (default: ${DEFAULT_MAX_ACTIONS}).
  --max-tokens <n>        Max output tokens per LLM call (default: ${DEFAULT_MAX_OUTPUT_TOKENS}).
  --full-page-snapshot    Send a full-page screenshot each turn instead of
                          just the viewport (default: viewport only, so the
                          persona has to scroll to see what's below).
  --no-<boolean-flag>     Disable a boolean option set in user defaults
                          for this run, e.g. --no-json or --no-repl.
  -v, --version           Show the package version.
  -h, --help              Show this help.

Environment:
  ANTHROPIC_API_KEY    Required for --provider anthropic.
  OPENAI_API_KEY       Required for --provider openai.
  GEMINI_API_KEY       Required for --provider google.

API keys:
  Environment variables take precedence. If a required environment variable
  is missing, persona-review reads ${USER_KEYS_PATH}. On first lookup, an
  empty keys.yaml is created if it does not exist.

User defaults:
  On first run, persona-review creates ${defaultsPath}.
  Custom personas can be added as YAML files in ${USER_PERSONAS_DIR}.
  Options set there override the built-in defaults. Command-line options
  override both.

Without --allow-submit (default), form-submit buttons are blocked at the
browser layer. With --allow-submit, the persona fills the form using the
shared test identity in ./submit-data.yaml (override with --submit-data),
clicks submit ONCE, and reacts to the resulting thank-you / error message.

Without --allow-downloads (default), browser downloads are blocked. With
--allow-downloads, Playwright stores downloads in temporary browser storage;
this tool does not save them into the project and they are deleted when the
browser context closes.

Without --allow-cross-page-navigation (default), persona clicks that would
leave the reviewed URL are blocked at the browser layer. Same-page anchors,
accordions, tabs, cookie banners, and other non-link UI controls still work.

Simulation != user research. Persona output is a plausible reaction, not
evidence — use it to notice things, not to decide things.`;
  console.log(help);
}

async function main() {
  const parsed = parseArgs(process.argv);

  if (parsed.command === "version") {
    printVersion();
    return;
  }

  if (parsed.command === "install-browsers") {
    try {
      await installBrowsers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error installing Playwright browsers: ${msg}`);
      process.exit(1);
    }
    return;
  }

  let defaultsPath: string;
  try {
    defaultsPath = ensureUserDefaultsFile();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error creating user defaults file: ${msg}`);
    process.exit(1);
  }

  if (parsed.command === "help") {
    printHelp(defaultsPath);
    return;
  }

  if (parsed.command === "list-personas") {
    await printPersonaList();
    return;
  }

  let userDefaults: Partial<UserDefaults>;
  try {
    userDefaults = loadUserDefaults(defaultsPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error loading user defaults: ${msg}`);
    process.exit(1);
  }

  if (parsed.command === "status") {
    printStatus(defaultsPath, userDefaults);
    return;
  }

  const opts = resolveArgs(parsed, userDefaults);

  if (!opts.url) {
    printHelp(defaultsPath);
    process.exit(1);
  }

  const requiredKey = PROVIDER_ENV_VARS[opts.provider];
  let apiKeyReady = false;
  try {
    apiKeyReady = Boolean(lookupApiKey(requiredKey).value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error loading API key: ${msg}`);
    process.exit(1);
  }
  if (!apiKeyReady) {
    console.error(
      `Error: ${requiredKey} is required for --provider ${opts.provider}. Set it as an environment variable or add it to ${USER_KEYS_PATH}.`
    );
    process.exit(1);
  }

  if (opts.json && (opts.repl || opts.replOnly)) {
    console.error("Error: --json cannot be combined with --repl or --repl-only.");
    process.exit(1);
  }

  const persona = await loadPersonaById(opts.personaId);

  let submitData: SubmitData | undefined;
  if (opts.allowSubmit) {
    try {
      submitData = loadSubmitData(opts.submitDataPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error loading submit-data: ${msg}`);
      process.exit(1);
    }
    const consented = await confirmSubmit({
      persona,
      url: opts.url!,
      submitData,
      submitDataPath: opts.submitDataPath,
      autoYes: opts.yes,
    });
    if (!consented) {
      console.error("Aborted: form submission consent not granted.");
      process.exit(1);
    }
  }

  const onStatus = (msg: string) => {
    if (!opts.json) console.error(msg);
  };

  let conv: PersonaConversation;
  try {
    conv = await openConversation(persona, opts.url!, {
      provider: opts.provider,
      model: opts.model,
      maxOutputTokens: opts.maxOutputTokens,
      maxActions: opts.maxActions,
      costCapUsd: opts.costCapUsd,
      fullPage: opts.fullPage,
      device: opts.device,
      onStatus,
      allowSubmit: opts.allowSubmit,
      allowDownloads: opts.allowDownloads,
      allowCrossPageNavigation: opts.allowCrossPageNavigation,
      submitData,
    });
  } catch (e) {
    if (isMissingPlaywrightBrowserError(e)) {
      printMissingPlaywrightBrowserHelp();
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error opening browser: ${msg}`);
    }
    process.exit(1);
  }

  let sigintHandled = false;
  const sigintHandler = () => {
    if (sigintHandled) return;
    sigintHandled = true;
    closeConversation(conv).finally(() => process.exit(130));
  };
  process.on("SIGINT", sigintHandler);

  try {
    if (!opts.replOnly) {
      const review = await runReviewLoop(conv);
      if (opts.json) {
        process.stdout.write(JSON.stringify(review.feedback, null, 2) + "\n");
      } else {
        renderProse(persona, review.feedback);
        console.error("");
        console.error(
          `[model: ${review.provider}/${review.model} — ${review.actionsTaken} review action(s) — ${review.inputTokens} in + ${review.outputTokens} out tokens — ${formatUsd(review.costUsd)} of ${formatUsd(review.costCapUsd)} cap]`
        );
      }
    }

    if (opts.repl || opts.replOnly) {
      await replLoop(conv, persona);
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    await closeConversation(conv);
  }
}

async function confirmSubmit(args: {
  persona: Persona;
  url: string;
  submitData: SubmitData;
  submitDataPath: string | undefined;
  autoYes: boolean;
}): Promise<boolean> {
  const { persona, url, submitData, submitDataPath, autoYes } = args;
  const summary = describeSubmitData(submitData, persona);
  const sourceLine = submitDataPath
    ? `Source: ${submitDataPath}`
    : "Source: ./submit-data.yaml (default — pass --submit-data <path> to override)";

  const banner =
    `\n=== --allow-submit: form submission ENABLED for this run ===\n\n` +
    `Target URL: ${url}\n` +
    `Persona:    ${persona.name} (${persona.id})\n\n` +
    `${sourceLine}\n` +
    `Test identity that will be typed into form fields:\n\n` +
    indent(summary, "  ") +
    `\n\nThis may create a real record in the target site's CRM, marketing\n` +
    `automation, or analytics. Records will be findable by the name and email\n` +
    `above; delete them after the run.\n` +
    `Hard limit: at most one successful submission per session.\n`;

  console.error(banner);

  if (autoYes) {
    console.error(`[--yes flag set — proceeding without prompt]`);
    return true;
  }

  if (!stdin.isTTY) {
    console.error(
      `Error: --allow-submit requires interactive confirmation, but stdin is not a TTY.\n` +
        `Re-run with --yes to skip the prompt for automated runs.`
    );
    return false;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`Continue and submit the form? [y/N] `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length ? prefix + line : line))
    .join("\n");
}

async function replLoop(conv: PersonaConversation, persona: Persona) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.error("");
  console.error(
    `[follow-up REPL — ask ${persona.name} a question. Type "exit" or press Ctrl-D to leave. Cost cap shared with the review: ${formatUsd(conv.costTracker.remaining())} of ${formatUsd(conv.costCapUsd)} remaining.]`
  );

  try {
    while (true) {
      if (conv.costTracker.remaining() <= 0) {
        console.error(`[cost cap reached — closing REPL]`);
        break;
      }
      let raw: string;
      try {
        raw = await rl.question(`\n> Ask ${persona.name}: `);
      } catch {
        // EOF / abort
        break;
      }
      const question = raw.trim();
      if (!question) continue;
      if (question === "exit" || question === "quit") break;

      try {
        const result = await runFollowUpTurn(conv, question);
        console.log("");
        console.log(`${persona.name}: ${result.answer}`);
        console.error(
          `[model: ${result.provider}/${result.model} — ${result.actionsTaken} action(s) — ${formatUsd(result.costUsd)} of ${formatUsd(result.costCapUsd)} cap — ${formatUsd(result.costRemaining)} remaining]`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[error: ${msg}]`);
        if (msg.toLowerCase().includes("cost cap")) break;
      }
    }
  } finally {
    rl.close();
  }
}

async function printPersonaList() {
  const personas = await listPersonas();
  console.log(`${personas.length} persona archetypes available:\n`);
  for (const p of personas) {
    console.log(`  ${p.id}`);
    console.log(`    ${p.name} — ${p.role}`);
    console.log(
      `    device=${p.device}  tech=${p.tech_confidence}  engagement=${p.cause_engagement}  scrutiny=${p.scrutiny}  reading=${p.reading_level}`
    );
    if (p.accessibility.length) {
      console.log(`    accessibility: ${p.accessibility.join(", ")}`);
    }
    console.log();
  }
  console.log(`Default persona: ${DEFAULT_PERSONA_ID}`);
  console.log(`Use --persona <id> to pick one.`);
}

function printStatus(defaultsPath: string, userDefaults: Partial<UserDefaults>) {
  console.log("Provider status:");
  console.log();
  for (const provider of PROVIDERS) {
    const envVar = PROVIDER_ENV_VARS[provider];
    const lookup = lookupApiKey(envVar);
    const ready = Boolean(lookup.value);
    const source =
      lookup.source === "environment"
        ? "set in environment"
        : lookup.source === "keys-file"
          ? `set in ${lookup.filePath}`
          : "missing";
    console.log(
      `  ${provider}: ${ready ? "ready" : "not ready"} (${envVar} ${source})`
    );
  }

  console.log();
  console.log("Models for --model:");
  console.log();
  for (const provider of PROVIDERS) {
    const defaultModel = defaultModelForProvider(provider);
    console.log(`  ${provider}:`);
    for (const model of availableModelsFor(provider)) {
      const marker = model === defaultModel ? " (default)" : "";
      console.log(`    - ${model}${marker}`);
    }
  }

  console.log();
  console.log("Default sources:");
  console.log();
  console.log(`  user defaults file: ${defaultsPath}`);
  const opts = resolveArgs(
    { command: "review", overrides: {} },
    userDefaults
  );
  for (const item of describeDefaultSources(opts, userDefaults)) {
    console.log(`  ${item.name}: ${item.value} (${item.source})`);
  }
}

function describeDefaultSources(
  opts: Args,
  userDefaults: Partial<UserDefaults>
): { name: string; value: string; source: "software" | "user" }[] {
  return [
    {
      name: "persona",
      value: opts.personaId,
      source: defaultSource(userDefaults, "personaId"),
    },
    {
      name: "provider",
      value: opts.provider,
      source: defaultSource(userDefaults, "provider"),
    },
    {
      name: "model",
      value: opts.model ?? defaultModelForProvider(opts.provider),
      source: defaultSource(userDefaults, "model"),
    },
    {
      name: "device",
      value: opts.device ?? "per persona",
      source: defaultSource(userDefaults, "device"),
    },
    {
      name: "json",
      value: formatDefaultValue(opts.json),
      source: defaultSource(userDefaults, "json"),
    },
    {
      name: "repl",
      value: formatDefaultValue(opts.repl),
      source: defaultSource(userDefaults, "repl"),
    },
    {
      name: "repl_only",
      value: formatDefaultValue(opts.replOnly),
      source: defaultSource(userDefaults, "replOnly"),
    },
    {
      name: "allow_submit",
      value: formatDefaultValue(opts.allowSubmit),
      source: defaultSource(userDefaults, "allowSubmit"),
    },
    {
      name: "allow_downloads",
      value: formatDefaultValue(opts.allowDownloads),
      source: defaultSource(userDefaults, "allowDownloads"),
    },
    {
      name: "allow_cross_page_navigation",
      value: formatDefaultValue(opts.allowCrossPageNavigation),
      source: defaultSource(userDefaults, "allowCrossPageNavigation"),
    },
    {
      name: "submit_data",
      value: opts.submitDataPath ?? "bundled submit-data.yaml",
      source: defaultSource(userDefaults, "submitDataPath"),
    },
    {
      name: "yes",
      value: formatDefaultValue(opts.yes),
      source: defaultSource(userDefaults, "yes"),
    },
    {
      name: "max_tokens",
      value: formatDefaultValue(opts.maxOutputTokens),
      source: defaultSource(userDefaults, "maxOutputTokens"),
    },
    {
      name: "max_actions",
      value: formatDefaultValue(opts.maxActions),
      source: defaultSource(userDefaults, "maxActions"),
    },
    {
      name: "cost_cap_usd",
      value: formatDefaultValue(opts.costCapUsd),
      source: defaultSource(userDefaults, "costCapUsd"),
    },
    {
      name: "full_page_snapshot",
      value: formatDefaultValue(opts.fullPage),
      source: defaultSource(userDefaults, "fullPage"),
    },
  ];
}

function defaultSource(
  userDefaults: Partial<UserDefaults>,
  key: keyof UserDefaults
): "software" | "user" {
  return Object.prototype.hasOwnProperty.call(userDefaults, key)
    ? "user"
    : "software";
}

function formatDefaultValue(value: string | number | boolean): string {
  return String(value);
}

function renderProse(persona: Persona, f: Feedback) {
  const line = (s = "") => console.log(s);
  line();
  line(`── ${persona.name}'s feedback (${persona.id}) ──`);
  line();
  line(f.summary);
  line();

  if (f.liked.length) line(`Liked:       ${f.liked.join("; ")}`);
  if (f.liked.length && f.confused_by.length) line();
  if (f.confused_by.length) line(`Confused by: ${f.confused_by.join("; ")}`);
  if (f.abandoned_at) line(`Abandoned:   ${f.abandoned_at}`);

  if (f.friction.length) {
    line();
    line("Friction:");
    for (const x of f.friction) {
      line(`  - [${x.severity}] ${x.where}: "${x.quote}"`);
    }
  }

  if (f.accessibility_issues.length) {
    line();
    line("Accessibility concerns:");
    for (const x of f.accessibility_issues) line(`  - ${x}`);
  }

  const ts = f.trust_signals;
  if (ts.positive.length || ts.negative.length) {
    line();
    line("Trust signals:");
    for (const x of ts.positive) line(`  + ${x}`);
    for (const x of ts.negative) line(`  - ${x}`);
  }

  if (f.trace.length) {
    line();
    line("Trace:");
    for (const t of f.trace) line(`  • ${t.step} — ${t.reaction}`);
  }

  line();
  line("— Note: simulation ≠ user research. This is a plausible reaction, not evidence.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`persona-review failed: ${msg}`);
  process.exit(1);
});
