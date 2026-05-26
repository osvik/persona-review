# Plan: Ink-based TUI for persona-review

## Context

We want a terminal UI that wraps the existing CLI's review pipeline so users can run reviews, browse personas, and chat with a persona without composing long command lines. The TUI must be **simple, maintainable, not over-engineered**, built on **Ink** (React for the terminal), and must not tightly couple TUI logic into the existing CLI code.

The existing pipeline is already well-shaped for this: `agent.ts` exposes pure `openConversation` / `runReviewLoop` / `runFollowUpTurn` / `closeConversation` functions, status flows through an `onStatus` callback (no stdout pollution), and personas, defaults, API keys, and cost tracking are all available as plain exports. The TUI is essentially a new front end that consumes the same surface the CLI uses.

This plan covers **Phase 1 in implementation-ready detail**, with Phase 2 and Phase 3 sketched as follow-up scope. The originally listed priority 18 (action/error log viewer) is **dropped** from this plan — there's no log writer in the current code, and the log-writing story should be decided separately.

## Requirements (from the original brief)

- Works on macOS, Linux, and if possible Windows (Bash, Zsh, PowerShell).
- Same runtime as the CLI: Node.js 20 or newer.
- Reuses the CLI's defaults (`~/.persona-review/defaults.yaml`), personas (built-in + `~/.persona-review/personas/`), and API keys (env vars or `~/.persona-review/keys.yaml`).
- Works in production (`npx persona-review --ui`) and development (`npm run review -- --ui`).
- Usable through SSH (no mouse required).
- Looks good on dark and light terminal backgrounds.
- If extra temporary state is needed, use `~/.persona-review/`, CLI-compatible when possible.
- Auto-update in production mode is handled by `npx` automatically; dev mode is git-controlled by the user. No special TUI code needed for either.

## Approach

Add a self-contained `src/tui/` module. The CLI gets a one-flag change (`--ui`) that dynamically imports the TUI so Ink/React stay out of the cold path for plain `npx persona-review <url>`. The TUI reuses the existing exports verbatim — no changes to `agent.ts`, `browser.ts`, `cost.ts`, `defaults.ts`, `persona.ts`, or `keys.ts`. The only edits to existing files are:

- `src/cli.ts` — parse `--ui`, dispatch to `runTui()`. ~10 lines.
- `tsconfig.json` — add JSX support. 2 lines.
- `package.json` / `npm-shrinkwrap.json` — add Ink + React dependencies.

Everything else is new files under `src/tui/`.

## Dependencies & tooling

Add to `dependencies` (not devDeps — npx users need them at runtime):

- `ink` ^5 (Node 20+ compatible, ESM, matches `"type": "module"`)
- `react` ^18 (Ink 5 peer dep — pin to 18, not 19)
- `ink-text-input` ^6 — URL field + REPL input
- `ink-select-input` ^6 — persona / device pickers, keyboard-only
- `ink-spinner` ^5 — status indicator

Add to `devDependencies`:

- `@types/react`

`tsconfig.json` edits:

```json
"jsx": "react-jsx",
"jsxImportSource": "react"
```

`module: NodeNext` already handles `.tsx` resolution. `tsc` emits `dist/tui/*.js` alongside the existing files. The `files` field in `package.json` already publishes all of `dist`. No bundler.

Regenerate `npm-shrinkwrap.json` after `npm install`. This will be a noticeable lockfile bump — flag in the commit message.

## CLI dispatch (minimal touch to `src/cli.ts`)

1. Extend the `Args["command"]` union with `"ui"`.
2. In `parseArgs`, recognize `--ui` (and `--tui` alias) and set `command = "ui"`.
3. Reject the combination `--ui --json` with a clear error (the TUI owns stdout — JSON mode is incompatible).
4. In `main()`, after defaults are loaded but before the existing review branch:

```ts
if (parsed.command === "ui") {
  const { runTui } = await import("./tui/index.js");
  await runTui({ userDefaults });
  return;
}
```

Dynamic `import()` is the only acceptable form — it means the CLI's startup cost for non-TUI users is unchanged.

## Directory layout (new files under `src/tui/`)

Keep it flat. The project is ~10 source files; don't pre-build folders for hypothetical screens.

```
src/tui/
  index.tsx           runTui() entry. Validates TTY, render(<App/>), awaits exit.
  app.tsx             Top-level <App>: holds useReducer, routes by state.screen.
  state.ts            State type, Action union, reducer, initialState().
  theme.ts            Safe color/style helpers for dark+light terminals.
  screens/
    form.tsx          URL + persona + device + Run.
    personaList.tsx   Browse personas with role summaries (reachable from form).
    review.tsx        Status log + spinner + final feedback render.
    repl.tsx          Chat history + input + per-turn cost line.
  components/
    StatusLog.tsx     Bounded ring buffer of status lines (cap ~200).
    CostLine.tsx      Formats provider/model/tokens/$used/$cap (reuse formatUsd).
    Feedback.tsx      Renders ReviewRun.feedback. Port of renderProse() (cli.ts:846).
    KeyHint.tsx       Footer hint row: "Tab next • Enter run • Ctrl-C quit".
```

Total: ~10 new files.

## State & navigation

Single `useReducer` at the top of `<App>` + prop drilling. The screen tree is shallow; React Context would add ceremony without payoff.

State shape (in `state.ts`):

```
{
  screen: 'form' | 'personas' | 'review' | 'repl' | 'done',
  url: string,
  personaId: string,
  device: 'mobile' | 'desktop' | 'either',
  provider, model,
  personas: Persona[],
  persona: Persona | null,
  conv: PersonaConversation | null,
  statusLog: string[],            // capped at ~200
  review: ReviewRun | null,
  chat: { q: string; a: string; costUsd: number; costRemaining: number }[],
  apiKey: { ready: boolean; envVar: string; source: string },
  error: string | null,
  busy: boolean,
}
```

Actions: `SET_URL`, `SET_PERSONA`, `SET_DEVICE`, `START_REVIEW`, `STATUS`, `REVIEW_DONE`, `START_REPL`, `REPL_APPEND`, `ERROR`, `QUIT`.

**All side effects live in `useEffect`s inside `app.tsx`**, keyed on `state.screen` transitions. Screens are presentational + dispatch — they never call `openConversation` directly. This keeps lifecycle bugs centralized.

## Status streaming (onStatus → live panel)

Inside the review effect:

```ts
const onStatus = (msg: string) => dispatch({ type: 'STATUS', msg });
const conv = await openConversation(persona, url, { ..., onStatus });
dispatch({ type: 'CONV_READY', conv });
const review = await runReviewLoop(conv);
dispatch({ type: 'REVIEW_DONE', review });
```

React 18 batches dispatches inside async callbacks, so the high-frequency status events from `agent.ts:248,327,395,551,570,579,589` won't thrash. Cap `statusLog` at ~200 entries (slice in reducer) — long reviews otherwise grow memory and cause Ink relayout cost.

Guard against dispatching after unmount with a captured `cancelled` flag in the effect cleanup; on cleanup also call `closeConversation(conv)`.

## REPL inside Ink (`screens/repl.tsx`)

- Top: scrollback `<Box flexDirection="column">` of past `{q, a, costUsd, costRemaining}` pairs.
- Bottom: `<TextInput>` bound to a local `useState('')`.

On submit:

```ts
if (q.trim().toLowerCase() === 'exit' || q === 'quit') {
  dispatch({ type: 'QUIT' });
  return;
}
setBusy(true);
const r = await runFollowUpTurn(conv, q);
dispatch({ type: 'REPL_APPEND', q, a: r.answer, costUsd: r.costUsd, costRemaining: r.costRemaining });
setBusy(false);
```

Cancellation: a top-level `useInput((input, key) => { if (key.ctrl && input === 'c') exit(); })` in `<App>`. On `exit()`, the cleanup effect calls `closeConversation(conv)` — matches the SIGINT semantics in `cli.ts:551`.

Per-turn cost line is a direct port of `cli.ts:670-672` into `<CostLine>`.

## API key warning UX — Banner + block at Run

- On form-screen mount and on provider change, call `lookupApiKey(PROVIDER_ENV_VARS[state.provider])` synchronously (it's a sync file read).
- Render a red bold `<Text>` line above the Run button when missing:
  `"ANTHROPIC_API_KEY not set. Add it to ~/.persona-review/keys.yaml or export it."`
- The user can still browse the form, change persona/device. Pressing Run while `apiKey.ready === false` shows an inline error and refuses to advance to the review screen.
- Phase 3 will add an in-TUI "Set key" action that writes to `~/.persona-review/keys.yaml`.

## Light/dark terminal compatibility (`theme.ts`)

Concrete rules — no opinion-based color choices in screens:

- **Accent**: `cyan` (legible on both light and dark; avoid `blue` which is dim on dark and washed out on light).
- **Success**: `green`.
- **Warning**: bare bold text (no color), or `magenta` if a color is required. Bare yellow is unreadable on white.
- **Error**: `red` + `bold`.
- **Muted**: Ink's `<Text dimColor>` — renders safely on both.
- **Never** set `backgroundColor`. Collides with terminal themes and breaks copy/paste.
- **Never** use `whiteBright` / `blackBright` — they invert legibility per theme.
- `ink-select-input` default highlight (inverse video + `›`) is theme-safe — leave it alone.

Manual smoke test matrix before merging Phase 1: macOS Terminal default + Solarized Light + Windows Terminal default dark + PowerShell default. SSH: `ssh host -t … --ui` with `TERM=xterm-256color`.

## Phase 1 implementation order (shippable)

Covers original priorities 1–5:

1. Insert URL, select persona, select device.
2. View all available personas with summary.
3. View the cost at the end of each operation.
4. Allow chat as in `--repl` / `--repl-only`; end chat.
5. Warn if the API key is not set.

Implementation steps:

1. CLI flag plumbing (`--ui`) + dynamic-import dispatch.
2. `tsconfig.json` JSX setup + Ink/React dependencies installed.
3. `runTui()` skeleton with TTY/raw-mode pre-flight check and a hello-world `<App>` to confirm build/publish pipeline still works.
4. `state.ts` reducer + `app.tsx` router + global Ctrl-C handler.
5. `theme.ts`.
6. `screens/form.tsx`: URL input, persona SelectInput from `listPersonas()`, device toggle. API-key banner + block at Run.
7. `screens/personaList.tsx`: list with role summaries, reachable from form via a key hint (e.g. `p`).
8. `screens/review.tsx`: live `<StatusLog>` + `<Spinner>` during run; `<Feedback>` + `<CostLine>` on completion; key hint to enter REPL or quit.
9. `screens/repl.tsx`: scrollback, input, per-turn cost, exit/quit/Ctrl-C.
10. Cross-terminal smoke test on the matrix above.

After step 10, Phase 1 is feature-complete.

## Phase 2 (sketched)

Covers original priorities 6–12 (toggles + numeric settings):

- 6. Enable / disable cross-page-navigation.
- 7. Enable / disable downloads.
- 8. Enable / disable submit forms.
- 9. Select submit-data file.
- 10. Edit cost cap.
- 11. Edit max actions.
- 12. Edit max tokens.

Adds a settings row to `screens/form.tsx` (or a `screens/settings.tsx` if the form gets crowded):

- Toggles: cross-page navigation, downloads, submit.
- Submit-data file picker (reuse `loadSubmitData()`).
- Numeric fields with validation: cost cap, max actions, max tokens.

For `--allow-submit`, port the consent banner from `cli.ts:582-633` into a dedicated `screens/submitConsent.tsx`. **Do not ship `--allow-submit` in the TUI until that confirm screen exists** — otherwise users bypass the CLI's hard-won consent UX.

## Phase 3 (sketched)

Covers original priorities 13–17 (provider, models, keys, snapshot, inspect):

- 13. Select API key providers.
- 14. Select models.
- 15. Add API keys.
- 16. Enable full page snapshot.
- 17. Inspect persona (view YAML file).

Plan:

- Provider picker → drives model picker (use existing model lists in `cost.ts`).
- In-TUI keys.yaml editor: a small screen that writes through a new helper sibling to `lookupApiKey` (e.g. `writeApiKey(envVar, value)` in `keys.ts`, mode 0o600).
- Full-page snapshot toggle.
- Persona YAML inspector: re-reads from `BUILTIN_PERSONAS_DIR` + `USER_PERSONAS_DIR` and shows raw YAML.

Original priority 18 (action/error logs inside `~/.persona-review/`) is **dropped** from this plan because nothing in the current pipeline writes those files. Revisit after the log-writing story is decided separately.

## Risks

1. **Windows PowerShell + Ink raw mode.** Ink needs `stdin.isTTY === true` and raw mode. If `npm run review -- --ui` runs in a piped shell or CI, Ink throws "Raw mode is not supported". `runTui()` must check `process.stdin.isTTY` early and print a graceful fallback message before `render()`. Same concern for `ssh` without `-t`.
2. **`closeConversation` on uncaught error.** `useApp().exit(err)` does not guarantee finally semantics across all crash modes. Add a `process.on('exit', …)` last-chance close, and an Error Boundary at `<App>` that dispatches `QUIT` and awaits `closeConversation(conv)` before unmounting.
3. **React/Ink version pinning.** Ink 5 needs React 18, not 19. Pin both.
4. **`npm-shrinkwrap.json` blast radius.** Lockfile will grow significantly. Surface this in the PR.
5. **JSON output mode.** Reject `--ui --json` at argparse — the TUI owns stdout while running.
6. **Status callback after unmount.** Async callbacks from `agent.ts` can dispatch after the user has exited the screen; guard with a `cancelled` flag in every review/REPL `useEffect` cleanup.

## Verification

End-to-end manual checks (no automated tests exist for the CLI either; keep parity):

1. `npm run build` succeeds; `dist/tui/index.js`, `dist/tui/app.js`, etc. exist.
2. `npm run review -- --ui` opens the form screen with no errors.
3. With `ANTHROPIC_API_KEY` unset and provider=anthropic, the red banner appears and Run is blocked. Setting the env var, restarting, banner is gone.
4. Browse personas via the persona-list screen; verify role summaries match `--list-personas` output.
5. Run a review against a small public page (e.g. `https://example.org`). Status lines stream during the run; final feedback renders with cost. Numbers match what the plain CLI prints for the same inputs (give or take LLM variability).
6. Enter the REPL after the review; ask a question; cost line updates. Type `exit` — clean shutdown. Repeat with Ctrl-C — clean shutdown (browser closed, no orphan Chromium).
7. Repeat #5 with `--ui` over `ssh -t`.
8. Open in macOS Terminal default, Solarized Light, Windows Terminal, PowerShell — confirm readability per the theme matrix.
9. `--ui --json` exits with a clear error.
10. `npx persona-review@<staged-version> --ui` works after `npm pack` + local install — confirms publish surface.

## Critical files

Modified (3):

- `src/cli.ts` — add `--ui` parse + dispatch (~10 lines).
- `tsconfig.json` — `jsx`, `jsxImportSource`.
- `package.json` (+ `npm-shrinkwrap.json`) — deps.

New (~12 files under `src/tui/`):

- `src/tui/index.tsx`, `src/tui/app.tsx`, `src/tui/state.ts`, `src/tui/theme.ts`
- `src/tui/screens/form.tsx`, `personaList.tsx`, `review.tsx`, `repl.tsx`
- `src/tui/components/StatusLog.tsx`, `CostLine.tsx`, `Feedback.tsx`, `KeyHint.tsx`

Reused existing exports (no changes):

- `loadUserDefaults()` — `src/defaults.ts:96`
- `listPersonas()` / `loadPersonaById()` — `src/persona.ts:44,56`
- `lookupApiKey()` — `src/keys.ts:25`
- `openConversation()` / `runReviewLoop()` / `runFollowUpTurn()` / `closeConversation()` — `src/agent.ts:217,309,349,295`
- `conv.costTracker.total() / remaining()` — `src/cost.ts:136`
- `Feedback` shape — `src/review.ts:4`
- `formatUsd()` — already in `cli.ts`; either re-export or duplicate the one-liner.
