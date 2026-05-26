# Terminal UI (TUI) — design and roadmap

## Status

**Phase 1 shipped.** Launch with `npx persona-review --ui` or
`npm run review -- --ui`.

Phase 1 covers the original priorities 1–5:

1. Form with URL, persona, device.
2. Persona browser with role summaries.
3. Cost line at the end of the review and after each REPL turn.
4. REPL chat with the same persona on the same page; `exit` / `quit` /
   `Ctrl-C` leaves.
5. Red banner + Run block when the API key for the selected provider is
   missing.

Phase 2 and Phase 3 are still **not started** — see roadmap below.

## Constraints (from the original brief)

- Cross-platform: macOS, Linux, Windows (Bash / Zsh / PowerShell).
- Node.js 20+ (same as the CLI).
- Reuses the CLI's `~/.persona-review/defaults.yaml`, personas (built-in +
  `~/.persona-review/personas/`), and API keys (env vars or
  `~/.persona-review/keys.yaml`).
- Works in production (`npx persona-review --ui`) and dev
  (`npm run review -- --ui`).
- Usable over SSH (no mouse required).
- Reads well on both dark and light terminal backgrounds.
- Don't tightly couple TUI logic into the CLI code.
- Auto-update in production is npx's job; dev is git's job. No special
  TUI code needed for either.

## Architecture

Self-contained `src/tui/` module loaded by `src/cli.ts` via dynamic
`import()` when `--ui` is passed. No changes to `agent.ts`, `browser.ts`,
`cost.ts`, `persona.ts`, `defaults.ts`, `keys.ts`, or `review.ts`. The TUI
is a pure consumer of their existing exports.

CLI surface added (≈20 lines in `src/cli.ts`):

- `--ui` / `--tui` parse branch → `command = "ui"`.
- Dispatch in `main()`: rejects `--ui --json`, then
  `await (await import("./tui/index.js")).runTui({ userDefaults })`.

`tsconfig.json` gained `jsx: "react-jsx"` + `jsxImportSource: "react"`.

### `src/tui/` layout

- `index.tsx` — `runTui()`. TTY pre-flight; loads personas + API key;
  renders `<App/>`. Registers SIGINT and `process.on("exit")` handlers
  that best-effort close the browser session for crash paths.
- `app.tsx` — top-level component. Holds the reducer; routes by
  `state.screen`; owns the review-pipeline `useEffect` keyed on screen
  transition; global Ctrl-C handler via `useApp().exit()`. Mirrors
  `state.conv` into a ref so the unmount cleanup can close it.
- `state.ts` — `State`, `Action`, `reducer`, `initialState()`. Status
  log capped at 200 entries (sliced in reducer).
- `theme.ts` — safe color constants. Cyan accent, green success, red
  error + bold, magenta warning. Never sets a background.
- `screens/form.tsx` — menu-driven form (`ink-select-input`). Three edit
  sub-modes: URL (`ink-text-input`), persona (`SelectInput` over the 12
  archetypes), device (auto / mobile / desktop). API-key banner + block
  at Run. `p` hotkey opens persona list.
- `screens/personaList.tsx` — paged browse, 4 per page, with role,
  device, tech, engagement, scrutiny, reading, accessibility. `← →`
  paging; `q` / `Esc` back to form.
- `screens/review.tsx` — `<StatusLog>` + `<Spinner>` while running;
  `<Feedback>` + `<CostLine>` when done. Keys: `r` REPL, `n` new
  review, `q` quit.
- `screens/repl.tsx` — scrollback of `{q, a, cost…}` turns;
  `TextInput` for the next question; cap-reached state shows a warning
  and disables input. `exit` / `quit` / `q` leaves.
- `components/StatusLog.tsx` — tail of N (default 12) lines, `dimColor`.
- `components/CostLine.tsx` — formats provider/model/tokens/$used/$cap
  using `formatUsd()` from `src/cost.ts`.
- `components/Feedback.tsx` — port of `renderProse()` in `cli.ts`,
  rendered as `<Box>`/`<Text>` instead of `console.log`. Severity
  coloring: high=red, medium=magenta, low=cyan.
- `components/KeyHint.tsx` — footer hint row.

### Reused upstream exports (no changes)

| Export | File:line |
|---|---|
| `loadUserDefaults()` | `src/defaults.ts:96` |
| `listPersonas()` / `loadPersonaById()` | `src/persona.ts:44,56` |
| `lookupApiKey()` | `src/keys.ts:25` |
| `openConversation()` / `runReviewLoop()` / `runFollowUpTurn()` / `closeConversation()` | `src/agent.ts:217,309,349,295` |
| `conv.costTracker.total()` / `remaining()` | `src/cost.ts:166,170` |
| `Feedback` shape | `src/review.ts:4` |
| `formatUsd()` | `src/cost.ts:179` |
| `PROVIDER_ENV_VARS` | `src/agent.ts:48` |

### Dependencies added

In `dependencies` (not devDeps — npx users need them at runtime):

- `ink` ^5.2 — Node 20+ compatible, ESM, matches `"type": "module"`.
- `react` ^18.3 — Ink 5 peer (pin to 18, **not** 19).
- `ink-text-input` ^6 — URL field + REPL input.
- `ink-select-input` ^6 — persona / device pickers, keyboard-only.
- `ink-spinner` ^5 — running-state indicator.

In `devDependencies`: `@types/react` ^18.

`npm-shrinkwrap.json` grew by ~680 lines / 48 packages.

## Phase 2 (next)

Covers original priorities 6–12. Adds a settings sub-screen reachable
from the form's menu (or a settings row on the form itself if it stays
small):

- 6. Toggle: cross-page navigation.
- 7. Toggle: downloads.
- 8. Toggle + consent flow: form submission.
- 9. Pick submit-data file (reuse `loadSubmitData()` from
  `src/submit-data.ts`; default to the bundled path).
- 10. Edit cost cap (TextInput with positive-number validation).
- 11. Edit max actions (positive integer).
- 12. Edit max tokens (positive integer).

For `--allow-submit`, port the consent banner from `cli.ts:582-633` into
a dedicated `src/tui/screens/submitConsent.tsx`. Render
`describeSubmitData(submitData, persona)` and require an explicit
confirmation before transitioning into the review. **Do not enable
`--allow-submit` in the TUI until that screen exists** — otherwise users
bypass the CLI's hard-won consent UX.

## Phase 3 (later)

Covers original priorities 13–17:

- 13. Pick provider. On change, re-run `lookupApiKey(PROVIDER_ENV_VARS[provider])`
  and update `state.apiKey`.
- 14. Pick model. Use `availableModelsFor(provider)` from `src/cost.ts`;
  default to `defaultModelForProvider(provider)` from `src/agent.ts`.
- 15. Add / edit API keys. Add a new helper `writeApiKey(envVar, value)`
  next to `lookupApiKey` in `src/keys.ts`. Preserve the existing 0o600
  file mode (`ensureUserKeysFile`).
- 16. Full-page snapshot toggle.
- 17. Inspect persona YAML. Re-read from `BUILTIN_PERSONAS_DIR` and
  `USER_PERSONAS_DIR` (both exported from `src/persona.ts`) and show
  the raw YAML in a scroll view.

Original priority 18 (action / error log viewer) is **deferred** — the
current pipeline doesn't write logs to `~/.persona-review/`. Decide the
log-writing story (where? rotation? format?) before adding a viewer.

## Known risks / limitations

1. **No raw-mode fallback.** `runTui()` exits early with a friendly error
   if `process.stdin.isTTY === false`. Confirmed working in piped shells.
   Manual smoke test still needed for non-TTY SSH (`ssh host npm run
   review -- --ui` without `-t` → should land in the same error path).
2. **React/Ink pinning.** Ink 5 requires React 18. `react` is pinned at
   `^18.3` deliberately. Bumping to 19 will break Ink.
3. **`closeConversation` on crash.** Three layers of cleanup:
   the `<App>` unmount effect (closes via convRef); the SIGINT handler in
   `runTui()`; a `process.on("exit")` last-chance call. Async close may
   not fully resolve on crash paths — best effort.
4. **Persona-name column width.** Long persona ids may push the menu
   labels close to the right margin on 80-column terminals. Acceptable
   for Phase 1; Phase 3's persona inspector can split id and name onto
   separate lines.
5. **`npm-shrinkwrap.json` size.** The Ink/React tree adds ~48 packages.
   Surfaced in the commit.

## Verification

### Done (automated, captured in repo state)

- [x] `npm run typecheck` — clean.
- [x] `npm run build` — clean, produces `dist/tui/*.js` and
  `dist/tui/{components,screens}/*.js`.
- [x] `--ui` without TTY → friendly error + exit 1.
- [x] `--ui --json` → rejected at argparse + exit 1.
- [x] Boots under PTY, form renders with header, menu, key hints.
- [x] Missing-API-key banner appears (HOME redirected to a temp dir so
  the keys.yaml lookup misses).
- [x] `p` hotkey opens the persona list (12 personas across 3 pages).
- [x] Menu navigation via ↑ / ↓ / Enter; URL editor (TextInput) saves
  and returns to menu.
- [x] Run with empty URL → inline "URL is required." error.
- [x] Run with URL but no API key → inline `<ENV_VAR>` not set error.

### Pending (manual, requires a real API key + Chromium)

- [ ] End-to-end review on a small public page (e.g. `https://example.org/`):
  status streams, feedback renders, cost line shows.
- [ ] REPL turn: ask a question, see the answer and cost line update,
  type `exit` → clean shutdown (no orphan Chromium).
- [ ] `Ctrl-C` during a running review → browser closed, exit code 0
  or 130, no orphan Chromium.
- [ ] Cross-terminal pass: macOS Terminal default + Solarized Light +
  Windows Terminal default + PowerShell.
- [ ] SSH: `ssh -t host npm run review -- --ui`.
- [ ] Publish surface: `npm pack` + `npx persona-review-<staged>.tgz --ui`
  works — confirms `dist/tui/` is included via the existing
  `files: ["dist", ...]` entry.

## Continuation notes

When picking this up next time:

- The plan file used during design is at
  `/Users/osvaldogago/.claude/plans/hi-please-look-at-rosy-dragonfly.md`
  (Phase 1 details).
- For Phase 2, the natural first step is the cost-cap / max-actions /
  max-tokens numeric fields — they don't touch `--allow-submit`'s
  consent UX, so they're a clean warm-up. Add them to `state.ts` (already
  there as state, just not editable in the form), wire a settings
  sub-screen with three `TextInput` fields validated against
  `parsePositiveNumber` / `parsePositiveInteger` helpers (mirror the CLI
  helpers in `cli.ts:232,241`).
- For Phase 3's API key writer, look at `ensureUserKeysFile()`
  (`src/keys.ts:17`) for the file-creation pattern (mode 0o600). Add a
  sibling `writeApiKey(envVar, value)` there rather than reaching into
  YAML serialization from the TUI.
