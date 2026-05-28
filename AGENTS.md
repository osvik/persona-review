# Terminal UI (TUI) — design and roadmap

## Status

**Phase 1 and Phase 2 shipped.** Launch with `npx persona-review --ui`
or `npm run review -- --ui`.

Phase 1 covers original priorities 1–5:

1. Form with URL, persona, device.
2. Persona browser with role summaries.
3. Cost line at the end of the review and after each REPL turn.
4. REPL chat with the same persona on the same page; `exit` / `quit` /
   `Ctrl-C` leaves.
5. Red banner + Run block when the API key for the selected provider is
   missing.

Phase 2 covers original priorities 6–12 (Settings screen + submit
consent flow):

6. Toggle cross-page navigation.
7. Toggle browser downloads.
8. Toggle form submission + dedicated consent screen before Run.
9. Pick a custom submit-data file (TextInput with parse-on-save).
10. Edit cost cap (positive number).
11. Edit max actions per phase (positive integer).
12. Edit max output tokens (positive integer).

Phase 3 is **not started** — see roadmap below.

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
  at Run. Phase-2 warning indicator when any of allow-submit /
  allow-downloads / allow-cross-page-navigation is on. `handleRun()`
  parses submit-data and routes to `submitConsent` when `allowSubmit`.
  Hotkeys: `p` persona list, `s` settings.
- `screens/personaList.tsx` — paged browse, 4 per page, with role,
  device, tech, engagement, scrutiny, reading, accessibility. `← →`
  paging; `q` / `Esc` back to form.
- `screens/settings.tsx` (Phase 2) — 7-row `SelectInput` menu. Rows 1–3
  flip toggles on Enter (allow-submit, allow-downloads, allow-cross-page
  -navigation). Row 4 (submit-data file path) opens an inline TextInput
  validated with `isSubmitDataYamlPath` + `loadSubmitData` on save —
  empty path means "use bundled submit-data.yaml". Rows 5–7 (cost cap,
  max actions, max tokens) open numeric TextInputs validated with the
  helpers in `validate.ts`. Esc / q returns to form. Settings are
  session-only — no writes to `defaults.yaml`.
- `screens/submitConsent.tsx` (Phase 2) — port of `cli.ts:582-633`.
  Renders target URL, persona, source path, and `describeSubmitData()`
  identity block, then a `SelectInput` with "No, cancel" first and
  "Yes, continue and submit" second. No → form (toggle preserved).
  Yes → `RESET_RUN` + `NAVIGATE review`. Esc cancels.
- `screens/review.tsx` — `<StatusLog>` + `<Spinner>` while running;
  `<Feedback>` + `<CostLine>` when done. Keys: `r` REPL, `n` new
  review, `q` quit.
- `screens/repl.tsx` — scrollback of `{q, a, cost…}` turns;
  `TextInput` for the next question; cap-reached state shows a warning
  and disables input. `exit` / `quit` / `q` leaves.
- `validate.ts` (Phase 2) — `parsePositiveInteger(raw)` and
  `parsePositiveNumber(raw)`. Pure helpers returning
  `{ok: true, value} | {ok: false, error}`. Mirrors `cli.ts:232,241`
  but returns the error instead of calling `process.exit` (which would
  tear down the TUI).
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
| `loadSubmitData()` / `isSubmitDataYamlPath()` / `describeSubmitData()` / `SubmitData` (Phase 2) | `src/submit-data.ts` |

### Dependencies added

In `dependencies` (not devDeps — npx users need them at runtime):

- `ink` ^5.2 — Node 20+ compatible, ESM, matches `"type": "module"`.
- `react` ^18.3 — Ink 5 peer (pin to 18, **not** 19).
- `ink-text-input` ^6 — URL field + REPL input.
- `ink-select-input` ^6 — persona / device pickers, keyboard-only.
- `ink-spinner` ^5 — running-state indicator.

In `devDependencies`: `@types/react` ^18.

`npm-shrinkwrap.json` grew by ~680 lines / 48 packages.

## Phase 2 (shipped) — settings screen + submit consent

Original priorities 6–12 are live. Full file-by-file detail is in the
Architecture section above. This section is the design-decision log so
future-me doesn't relitigate choices.

### Design decisions (locked)

- **Settings are session-only.** No writes to
  `~/.persona-review/defaults.yaml`. Users who want a setting to stick
  edit the file manually. Avoids adding a `writeUserDefaults()`
  round-trip and keeps Phase 2 focused. (Revisit if Phase 3+ adds a
  "Save as default" item.)
- **Booleans flip on Enter** (no sub-screen). The row label re-renders
  with the new value so the change is obvious.
- **No `--yes` consent bypass in the TUI.** TUI users are interactive
  by definition. For automation, use the CLI.
- **Warning indicator on the form** when any of allow-submit /
  allow-downloads / allow-cross-page-navigation is on. Bold magenta,
  formatted as `⚠ submit enabled · downloads enabled · cross-page nav enabled`.
- **Hotkey `s` for Settings**, alongside the menu item, mirroring `p`.
- **Consent screen has "No, cancel" first.** Safer default; matches the
  CLI's prompt that requires explicit `y`/`yes` to proceed.

### State additions (in `src/tui/state.ts`)

```
allowSubmit, allowDownloads, allowCrossPageNavigation: boolean
submitDataPath:                                       string | undefined
submitData:                                           SubmitData | null
```

`Screen` gained `"settings"` and `"submitConsent"`. Eight new actions:
`TOGGLE_ALLOW_*` (3), `SET_SUBMIT_DATA_PATH`, `SET_SUBMIT_DATA`,
`SET_COST_CAP`, `SET_MAX_ACTIONS`, `SET_MAX_TOKENS`.

`TOGGLE_ALLOW_SUBMIT` clears `submitData` when flipping off, so the
file is re-parsed if the toggle is flipped on again later. `handleRun()`
also re-parses on every Run so file edits between Settings-save and Run
are picked up.

### Known UX nuances (not bugs)

1. **Numeric / path editors prefill the current value.** Users may not
   realize they need to backspace the prefilled value before typing a
   new one. Documented in PTY tests where typing `"0"` into the cost-cap
   field ended up saving `10`. Matches the URL editor's behavior.
2. **No `~` expansion in submit-data path.** The CLI doesn't expand it
   either. `~/file.yaml` → `ENOENT`. The placeholder hints at "absolute
   path".
3. **Numeric input validates on Enter, not keystroke.** Pasting `"abc"`
   only fails on submit. Acceptable.
4. **Submit toggle preserved after consent cancel.** Picking "No,
   cancel" does NOT flip the toggle off. Matches CLI per-run semantics.
   User flips it off in Settings if they didn't mean it.

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

Phase 1:

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

Phase 2:

- [x] `s` hotkey opens Settings; 7 rows render with correct values.
- [x] Each of the three toggles flips on Enter; row label re-renders.
- [x] Cost cap editor accepts valid values (saves `$10.0000`).
- [x] Max actions rejects `151.5` with "Must be a positive integer."
- [x] Submit-data path with `.txt` ext → "Path must end in .yaml or .yml."
- [x] Submit-data path pointing at a missing file → `ENOENT` error.
- [x] Form warning indicator shows individual + combined toggles
  (`⚠ submit enabled · downloads enabled · cross-page nav enabled`).
- [x] Submit on + URL + API key → pressing Run opens consent screen
  with target URL, persona, source line, and full identity block from
  `describeSubmitData()` (incl. custom YAML fields).
- [x] "No, cancel" returns to form; submit toggle preserved.

### Pending (manual, requires a real API key + Chromium)

Phase 1:

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

Phase 2:

- [ ] Consent "Yes, continue" runs the review with `allowSubmit=true`;
  persona attempts one form submission; status log shows the line from
  `agent.ts:570`.
- [ ] `allowDownloads=true` + a page with a download link → Playwright
  permits the download.
- [ ] `allowCrossPageNavigation=true` + a same-tab link click →
  navigation succeeds.

## Continuation notes

When picking this up next time, Phase 3 is the next stop. Before
coding, plan with the user the same way Phase 2 was planned (one
clarifying-question round, then a written-up plan).

**Phase 3 scope (priorities 13–17):** provider picker, model picker, in-
TUI API-key editor, full-page snapshot toggle, persona YAML inspector.
Priority 18 (log viewer) stays deferred until log writing is decided.

**Likely clarifying questions to ask the user before Phase 3:**

1. **API-key writer security.** Writing to `~/.persona-review/keys.yaml`
   means handling a secret on screen. Should the TUI mask the key field
   while typing (ink-text-input supports `mask="*"`)? Should keys ever
   be displayed in the UI for editing, or only "add" / "replace"?
2. **Model picker scope.** `availableModelsFor(provider)` returns only
   models with a pricing entry in `src/cost.ts`. Should the picker allow
   typing a custom model id (advanced users) or hard-restrict to the
   priced list?
3. **Persona inspector — read-only or editable?** Read-only is much
   simpler. Editing custom personas under `~/.persona-review/personas/`
   would need a YAML round-trip and schema validation; probably scope it
   out of Phase 3.

**Sketch of where things plug in:**

- `lookupApiKey` lives at `src/keys.ts:25`. The Phase 3 writer should
  sit next to it as `writeApiKey(envVar, value, filePath?)`, preserve
  `ensureUserKeysFile()`'s 0o600 mode (`src/keys.ts:17`), and parse the
  existing YAML so we don't clobber other keys. The TUI should call it
  and then re-run `lookupApiKey` to refresh `state.apiKey`.
- `availableModelsFor(provider)` is at `src/cost.ts:82`,
  `defaultModelForProvider(provider)` at `src/agent.ts:54`. Plug into
  Settings rows analogous to Phase 2's pattern.
- `full_page` toggle is already a `state.fullPage` field; just add a row
  in `settings.tsx` and a `TOGGLE_FULL_PAGE` action.
- For the persona inspector: `BUILTIN_PERSONAS_DIR` and
  `USER_PERSONAS_DIR` are exported from `src/persona.ts` and
  `src/user-config.ts`. The TUI already has all 12 personas in
  `state.personas`; the inspector just needs to read the raw YAML file
  given the id. The path resolver pattern is in `loadPersonasInDir` at
  `src/persona.ts:75`.

**Design plans for completed phases** (reference if needed):

- `/Users/osvaldogago/.claude/plans/hi-please-look-at-rosy-dragonfly.md`
  — Phase 1 original plan.
- Phase 2 plan lived in the chat session that shipped it; the
  "Phase 2 (shipped)" section above captures the locked decisions and
  UX nuances worth remembering.

**Don't re-litigate these settled choices** (they apply to Phase 3 too):

- Session-only changes — don't add writes to `defaults.yaml` unless the
  user explicitly asks.
- Toggles flip on Enter, no sub-screen.
- Light/dark-safe colors from `theme.ts`; never set a background.
- Runtime deps in `package.json` are exact-pinned (no `^`/`~`) for
  supply-chain hygiene. devDeps stay on caret.
