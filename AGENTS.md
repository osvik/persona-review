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

## Phase 2 (next) — settings screen + submit consent

Covers original priorities 6–12. Adds a settings sub-screen with the
seven editable fields, plus a dedicated submit-consent screen for
`--allow-submit`.

### Design decisions (already made — do not re-ask)

- **Settings are session-only.** No writes to `~/.persona-review/defaults.yaml`
  in Phase 2. Users who want a setting to stick edit the file manually.
  This avoids adding a `writeUserDefaults()` round-trip and keeps Phase 2
  focused. (Reconsider for Phase 3+ if there's demand.)
- **Booleans flip on Enter.** No sub-screen. The menu row shows the
  current value (e.g. `Downloads  off`); pressing Enter flips it. Faster
  than persona/device-style sub-screens and unambiguous because the label
  re-renders.
- **No `--yes`-style consent bypass in the TUI.** TUI users are interactive
  by definition. For automation, use the CLI.
- **Keep the warning indicator on the form** when any of allow-submit /
  allow-downloads / allow-cross-page-navigation is on. It's worth the
  screen real estate because all three change browser behaviour in ways
  users should notice before pressing Run.
- **Hotkey `s` for Settings** alongside the menu item, mirroring `p` for
  personas.

### State changes (`src/tui/state.ts`)

Add to `State`, initialized from `userDefaults`:

```
allowSubmit:              boolean
allowDownloads:           boolean
allowCrossPageNavigation: boolean
submitDataPath:           string | undefined   // undefined = bundled default
submitData:               SubmitData | null    // lazy-loaded for consent
```

`fullPage`, `maxOutputTokens`, `maxActions`, `costCapUsd` are already on
`State`; Phase 2 just makes the last three editable. `fullPage` stays
deferred to Phase 3 (priority 16).

New actions:

- `TOGGLE_ALLOW_SUBMIT`, `TOGGLE_ALLOW_DOWNLOADS`, `TOGGLE_ALLOW_CROSS_PAGE_NAVIGATION`
- `SET_SUBMIT_DATA_PATH` (path: string | undefined)
- `SET_SUBMIT_DATA` (data: SubmitData | null)
- `SET_COST_CAP` (n: number), `SET_MAX_ACTIONS` (n: number), `SET_MAX_TOKENS` (n: number)

`Screen` gains `"settings"` and `"submitConsent"`.

### New screen: `src/tui/screens/settings.tsx`

Reachable from the form's main menu via a new "Settings" item and the
hotkey `s`. Single `SelectInput` menu, seven items, each showing the
current value:

```
persona-review · Settings

  Submit forms          off
  Allow downloads       off
  Cross-page nav        off
  Submit-data file      (bundled submit-data.yaml)
  Cost cap              $1.0000
  Max actions           15
  Max tokens            4096

[Enter toggle / edit  •  Esc back to form  •  Ctrl-C quit]
```

Behavior per row:

- **Rows 1–3 (toggles)** — Enter dispatches the matching `TOGGLE_*`
  action. No sub-screen. Cursor stays put so the change is obvious.
- **Submit-data file** — Enter opens an inline `TextInput` sub-mode
  prefilled with the current path (empty for "use bundled"). On Enter:
  - Empty string → `SET_SUBMIT_DATA_PATH(undefined)`,
    `SET_SUBMIT_DATA(null)`, return to menu.
  - Non-empty path failing `isSubmitDataYamlPath()` → inline red error,
    stay in edit mode.
  - Non-empty + parses (`loadSubmitData(p)` succeeds) →
    `SET_SUBMIT_DATA_PATH(p)`, `SET_SUBMIT_DATA(parsed)`, return.
  - Non-empty + parse throws (file missing, schema error) → inline error.
- **Cost cap / Max actions / Max tokens** — `TextInput` sub-mode.
  Validate on submit: `parsePositiveNumber` for cost cap,
  `parsePositiveInteger` for the other two. Bad input → inline error,
  stay editing.

`Esc` (or `q` when not in TextInput) returns to form.

### New screen: `src/tui/screens/submitConsent.tsx`

Direct port of `cli.ts:582-633`. Renders the consent banner using
existing helpers from `src/submit-data.ts` — no new logic there:

```
=== --allow-submit: form submission ENABLED for this run ===

Target URL: <state.url>
Persona:    <persona.name> (<persona.id>)

Source: <state.submitDataPath ?? "bundled submit-data.yaml">
Test identity that will be typed into form fields:

  <describeSubmitData(state.submitData, persona) — indented>

This may create a real record in the target site's CRM, marketing
automation, or analytics. Records will be findable by the name and
email above; delete them after the run.
Hard limit: at most one successful submission per session.

  ▶ No, cancel
    Yes, continue and submit
```

`SelectInput` with the two options, **"No" first** (safer default). On
No → `NAVIGATE form` (submit toggle stays on; user can re-run or flip
it off). On Yes → `NAVIGATE review`.

### Form changes (`src/tui/screens/form.tsx`)

1. Insert "Settings" between "Device" and "Browse" in the main menu.
2. Add hotkey `s` (parallel to `p`) → `NAVIGATE settings`.
3. Render a warning indicator row when any Phase 2 toggle is on:
   ```
   ⚠ submit enabled · downloads enabled · cross-page nav enabled
   ```
   Style: bold + `colors.warning` (magenta) from `theme.ts`.
4. Update `handleRun()`:
   - Keep existing checks (URL, API key, persona).
   - **New:** if `state.allowSubmit`:
     - If `state.submitData == null`, call `loadSubmitData(state.submitDataPath)`
       synchronously; dispatch `SET_SUBMIT_DATA`. On error → inline message,
       abort Run.
     - Then `NAVIGATE submitConsent` instead of `NAVIGATE review`.

### App routing (`src/tui/app.tsx`)

- Add cases for `"settings"` and `"submitConsent"` in the screen-routing
  JSX.
- Extend the review `useEffect`'s `openConversation()` call to pass
  `allowSubmit`, `allowDownloads`, `allowCrossPageNavigation`, `submitData`.
  The signature already accepts them (see `agent.ts:62`).
- No change to the side-effect trigger — still keyed on
  `state.screen === "review"`.

### Validation helpers (`src/tui/validate.ts`, new)

Two pure functions, no Ink dependency:

```ts
parsePositiveInteger(raw: string): { ok: true; value: number } | { ok: false; error: string }
parsePositiveNumber (raw: string): { ok: true; value: number } | { ok: false; error: string }
```

Mirrors `cli.ts:232,241`, but **returns** the error instead of calling
`process.exit` (which would kill the TUI).

### Files touched

Modified:

- `src/tui/state.ts` — new fields, actions, initialState picks up new
  userDefaults keys.
- `src/tui/screens/form.tsx` — Settings menu entry, `s` hotkey, warning
  indicator, submit-data parsing on Run, route to consent.
- `src/tui/app.tsx` — new screen routing, extra `openConversation`
  options.

New:

- `src/tui/screens/settings.tsx`
- `src/tui/screens/submitConsent.tsx`
- `src/tui/validate.ts`

Reused (no changes):

- `loadSubmitData`, `describeSubmitData`, `isSubmitDataYamlPath`,
  `SubmitData` from `src/submit-data.ts`.
- All Phase 1 components.

### Risks / known considerations

1. **No `~` expansion in submit-data path.** The CLI doesn't expand it
   either. If a user types `~/file.yaml`, they get `ENOENT`. Mention this
   in the TextInput placeholder.
2. **Numeric input validates on Enter, not keystroke.** Pasting "abc"
   only fails when the user submits. Acceptable.
3. **Submit-data path could change between Settings save and Run.** The
   `handleRun()` re-parse covers it.
4. **Submit toggle preserved after cancel.** Picking "No, cancel" on
   the consent screen does NOT flip the toggle off. Matches CLI per-run
   semantics. User flips off in Settings if they didn't mean it.

### Verification

Automatable under PTY:

- [ ] Settings menu renders with seven items + correct current values.
- [ ] Each toggle flips on Enter; menu label re-renders.
- [ ] Numeric editor rejects "0", "-1", "abc", "1.5" for max-actions
  (positive integer).
- [ ] Numeric editor accepts "0.5", "2", "10" for cost cap (positive
  number).
- [ ] Submit-data path: invalid extension → error.
- [ ] Submit-data path: nonexistent file → error.
- [ ] Submit-data path: valid file → parses, returns to menu.
- [ ] Form warning line appears iff any Phase 2 toggle is on.
- [ ] With submit toggle on and a valid file, pressing Run shows the
  consent screen with the test identity rendered.
- [ ] Picking "No, cancel" returns to form; submit toggle still on.

Requires real API key + Chromium (manual):

- [ ] Picking "Yes, continue" runs the review with `allowSubmit=true`;
  persona attempts one form submission; status log shows the line from
  `agent.ts:570`.
- [ ] `allowDownloads=true` + a page with a download link → Playwright
  permits the download.
- [ ] `allowCrossPageNavigation=true` + a same-tab link click →
  navigation succeeds.

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
2. **React/Ink pinning.** Ink 5 requires React 18. All runtime deps in
   `package.json` are pinned exact (no `^` / `~`) for supply-chain
   hygiene — npx publishes `npm-shrinkwrap.json`, so end users get the
   exact tree. Bumping to React 19 will break Ink.
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

- **Phase 2 is fully planned in this file** — section "Phase 2 (next)"
  above is implementation-ready. Two design decisions are already locked
  (session-only persistence, flip-on-Enter toggles); don't re-ask the
  user about those.
- **Suggested implementation order for Phase 2** (each step is
  independently testable, so the working tree stays green between them):
  1. `src/tui/validate.ts` — pure helpers, no UI. Easiest start.
  2. State changes in `src/tui/state.ts` — fields, actions, initialState.
  3. `src/tui/screens/settings.tsx` with only the three numeric editors
     wired (cost cap, max actions, max tokens). Add "Settings" menu
     item + `s` hotkey on the form. This is fully testable under PTY.
  4. Add the three toggle rows (cross-page nav, downloads, submit).
  5. Submit-data file row (TextInput with parse-on-save).
  6. Warning indicator on the form.
  7. `src/tui/screens/submitConsent.tsx` + the `handleRun()` route to it.
  8. Extend the `openConversation()` call in `app.tsx` to pass the new
     options.
- **Phase 1 design plan** lives at
  `/Users/osvaldogago/.claude/plans/hi-please-look-at-rosy-dragonfly.md`
  if you need to cross-reference the original Phase 1 reasoning.
- **For Phase 3's API key writer**: look at `ensureUserKeysFile()`
  (`src/keys.ts:17`) for the file-creation pattern (mode 0o600). Add a
  sibling `writeApiKey(envVar, value)` there rather than reaching into
  YAML serialization from the TUI.
