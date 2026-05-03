#!/usr/bin/env node
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
  DEFAULT_OPENAI_MODEL,
  DEFAULT_PROVIDER,
  type PersonaConversation,
} from "./agent.js";
import type { SessionDevice } from "./browser.js";
import { formatUsd } from "./cost.js";
import {
  describeSubmitData,
  loadSubmitData,
  type SubmitData,
} from "./submit-data.js";
import type { Provider } from "./llm/types.js";

interface Args {
  command: "review" | "list-personas" | "help";
  url?: string;
  json: boolean;
  personaId: string;
  provider: Provider;
  model?: string;
  maxOutputTokens: number;
  maxActions: number;
  costCapUsd: number;
  fullPage: boolean;
  device?: SessionDevice;
  repl: boolean;
  replOnly: boolean;
  allowSubmit: boolean;
  allowDownloads: boolean;
  submitDataPath?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let url: string | undefined;
  let json = false;
  let personaId = DEFAULT_PERSONA_ID;
  let provider: Provider = DEFAULT_PROVIDER;
  let model: string | undefined;
  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
  let maxActions = DEFAULT_MAX_ACTIONS;
  let costCapUsd = DEFAULT_COST_CAP_USD;
  let fullPage = false;
  let device: SessionDevice | undefined;
  let repl = false;
  let replOnly = false;
  let allowSubmit = false;
  let allowDownloads = false;
  let submitDataPath: string | undefined;
  let yes = false;
  let command: Args["command"] = "review";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      command = "help";
    } else if (a === "--list-personas") {
      command = "list-personas";
    } else if (a === "--json") {
      json = true;
    } else if (a === "--full-page-snapshot") {
      fullPage = true;
    } else if (a === "--repl") {
      repl = true;
    } else if (a === "--repl-only") {
      replOnly = true;
    } else if (a === "--allow-submit") {
      allowSubmit = true;
    } else if (a === "--allow-downloads") {
      allowDownloads = true;
    } else if (a === "--submit-data") {
      submitDataPath = args[++i];
    } else if (a === "--yes" || a === "-y") {
      yes = true;
    } else if (a === "--persona") {
      personaId = args[++i];
    } else if (a === "--provider") {
      const p = args[++i];
      if (p !== "anthropic" && p !== "openai") {
        console.error(`--provider must be 'anthropic' or 'openai'.`);
        process.exit(1);
      }
      provider = p;
    } else if (a === "--device") {
      const d = args[++i];
      if (d !== "mobile" && d !== "desktop") {
        console.error(`--device must be 'mobile' or 'desktop'.`);
        process.exit(1);
      }
      device = d;
    } else if (a === "--model") {
      model = args[++i];
    } else if (a === "--max-tokens") {
      maxOutputTokens = parseInt(args[++i], 10);
    } else if (a === "--max-actions") {
      maxActions = parseInt(args[++i], 10);
    } else if (a === "--cost-cap-usd") {
      costCapUsd = parseFloat(args[++i]);
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
    json,
    personaId,
    provider,
    model,
    maxOutputTokens,
    maxActions,
    costCapUsd,
    fullPage,
    device,
    repl,
    replOnly,
    allowSubmit,
    allowDownloads,
    submitDataPath,
    yes,
  };
}

function printHelp() {
  const help = `persona-review — AI persona feedback for non-profit web pages

Usage:
  npm run review -- <url> [options]
  npm run review -- --list-personas

Options:
  --persona <id>          Persona archetype id (default: ${DEFAULT_PERSONA_ID}).
  --provider <name>       LLM provider: 'anthropic' or 'openai'
                          (default: ${DEFAULT_PROVIDER}).
  --device <m|d>          Override the persona's device: 'mobile' (390x844)
                          or 'desktop' (1280x800). Default: per-persona.
  --list-personas         Print available personas and exit.
  --json                  Emit JSON feedback instead of prose. Cannot be
                          combined with --repl or --repl-only.
  --repl                  After the initial review, enter an interactive
                          prompt to ask the persona follow-up questions.
                          The cost cap is shared across review + REPL.
  --repl-only             Skip the initial review; load the page and enter
                          the interactive prompt directly.
  --allow-submit          Permit ONE form submission this session and ask
                          the persona to react to the resulting thank-you
                          or error page. Requires interactive consent.
  --allow-downloads       Permit browser downloads. Default: downloads are
                          blocked by Playwright.
  --submit-data <path>    Override the test identity used for form fills
                          (default: ./submit-data.yaml).
  -y, --yes               Skip the --allow-submit consent prompt (for
                          automated runs).
  --model <id>            Provider-specific model id
                          (defaults: Anthropic ${DEFAULT_ANTHROPIC_MODEL},
                          OpenAI ${DEFAULT_OPENAI_MODEL}).
  --cost-cap-usd <n>      Hard cost cap in USD per (URL, persona) session
                          (default: ${DEFAULT_COST_CAP_USD}). Includes review + all REPL turns.
  --max-actions <n>       Soft cap on browser actions per phase (default: ${DEFAULT_MAX_ACTIONS}).
  --max-tokens <n>        Max output tokens per LLM call (default: ${DEFAULT_MAX_OUTPUT_TOKENS}).
  --full-page-snapshot    Send a full-page screenshot each turn instead of
                          just the viewport (default: viewport only, so the
                          persona has to scroll to see what's below).
  -h, --help              Show this help.

Environment:
  ANTHROPIC_API_KEY    Required for --provider anthropic.
  OPENAI_API_KEY       Required for --provider openai.

Without --allow-submit (default), form-submit buttons are blocked at the
browser layer. With --allow-submit, the persona fills the form using the
shared test identity in ./submit-data.yaml (override with --submit-data),
clicks submit ONCE, and reacts to the resulting thank-you / error message.

Without --allow-downloads (default), browser downloads are blocked. With
--allow-downloads, Playwright stores downloads in temporary browser storage;
this tool does not save them into the project and they are deleted when the
browser context closes.

Simulation != user research. Persona output is a plausible reaction, not
evidence — use it to notice things, not to decide things.`;
  console.log(help);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.command === "help") {
    printHelp();
    return;
  }

  if (opts.command === "list-personas") {
    await printPersonaList();
    return;
  }

  if (!opts.url) {
    printHelp();
    process.exit(1);
  }

  const requiredKey =
    opts.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[requiredKey]) {
    console.error(
      `Error: ${requiredKey} environment variable is required for --provider ${opts.provider}.`
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

  const conv = await openConversation(persona, opts.url!, {
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
    submitData,
  });

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

function renderProse(persona: Persona, f: Feedback) {
  const line = (s = "") => console.log(s);
  line();
  line(`── ${persona.name}'s feedback (${persona.id}) ──`);
  line();
  line(f.summary);
  line();

  if (f.liked.length) line(`Liked:       ${f.liked.join("; ")}`);
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
