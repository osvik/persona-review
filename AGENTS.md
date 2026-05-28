# Terminal UI (TUI) — design and roadmap

## Status

**All three planned phases shipped.** Launch with
`npx persona-review --ui` or `npm run review -- --ui`.

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

Phase 3 covers original priorities 13–17 (provider/model picker, in-TUI
API-key editor, full-page snapshot toggle, persona YAML inspector):

13. Pick LLM provider (anthropic / openai / google); resets the model
    to the new provider's default.
14. Pick model from the priced list (`availableModelsFor(provider)`),
    with `(default)` marker.
15. Add / edit / clear API keys via a masked editor (Tab peek). Writes
    to `~/.persona-review/keys.yaml` at mode 0o600.
16. Full-page snapshot toggle in Settings.
17. Inspect any persona's raw YAML from the persona list (Enter on a
    row), with arrow / PgUp / PgDn / `g` / `G` scrolling.

Original priority 18 (action / error log viewer) is **deferred** — the
current pipeline doesn't write logs to `~/.persona-review/`. The
log-writing story (where? rotation? format?) needs to be decided
before a viewer makes sense. See "Phase 4 (if any)" below.

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
`import()` when `--ui` is passed. The TUI is a pure consumer of the
existing pipeline's exports, with two thin additions in Phase 3:

- `src/keys.ts` gained `writeApiKey()` (writes to `keys.yaml` with
  0o600, round-trips other entries, deletes on empty value).
- `src/persona.ts` gained `findPersonaSource()` (returns the raw YAML
  + path for a persona id, used by the inspector).

No changes to `agent.ts`, `browser.ts`, `cost.ts`, `defaults.ts`,
or `review.ts`.

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
  `state.conv` into a ref so the unmount cleanup can close it. Phase 3
  added a second `useEffect` keyed on `state.provider` that re-runs
  `lookupApiKey()` and dispatches `SET_API_KEY` so the form banner
  refreshes when the user switches provider.
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
- `screens/personaList.tsx` — cursor-based `SelectInput` over the 12
  personas; each row is `id — name — role`. Enter dispatches
  `OPEN_PERSONA_INSPECTOR`; `q` / `Esc` back to form. Phase 1's paged
  detail view was replaced by the inspector in Phase 3.
- `screens/personaInspector.tsx` (Phase 3) — async-loads via
  `findPersonaSource()`. Header: `<id> — <name>` + role + either
  `built-in` or `custom — <path>`. Body: raw YAML lines, paged at 18
  per screen. Input: ↑↓ scroll one line, PgUp/PgDn page, `g` / `G`
  jump top/bottom, `q` / `Esc` back to persona list.
- `screens/settings.tsx` (Phase 2 + 3) — 11-row `SelectInput` menu.
  Rows 1–3 (Phase 3): Provider (sub-mode SelectInput with key status
  per provider), Model (sub-mode SelectInput with priced list and
  `(default)` marker; top row is `(use default — X)`), Manage API
  keys → navigates to `apiKeys` screen. Rows 4–7 are toggles
  (allow-submit, allow-downloads, allow-cross-page-navigation,
  full-page-snapshot — last one Phase 3); flip on Enter. Row 8
  (submit-data file path) opens an inline TextInput validated with
  `isSubmitDataYamlPath` + `loadSubmitData` on save — empty path
  means "use bundled". Rows 9–11 (cost cap, max actions, max tokens)
  open numeric TextInputs validated with `validate.ts`. Esc / q
  returns to form. Settings are session-only — no writes to
  `defaults.yaml`. API keys (managed via the `apiKeys` screen) are
  the only Phase 1–3 setting that persists.
- `screens/apiKeys.tsx` (Phase 3) — three rows (per provider) showing
  `set (source, last 4: …xxxx)` or `missing`. `source` is `env`,
  `keys.yaml`, or `missing`. Enter opens an inline masked editor
  (`mask="*"`). **Tab** (not a letter — letters get captured by
  `ink-text-input`) toggles peek. Enter with a value calls
  `writeApiKey()`; Enter with empty input clears the entry; Esc
  cancels. If the edited key matches `state.provider`, also
  dispatches `SET_API_KEY` so the form banner refreshes immediately.
  Warns when the current source is `environment` (env vars override
  file writes).
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
| `writeApiKey()` (Phase 3 — new helper next to `lookupApiKey`) | `src/keys.ts` |
| `findPersonaSource()` / `PersonaSource` (Phase 3 — new helper) | `src/persona.ts` |
| `availableModelsFor()` / `defaultModelForProvider()` (Phase 3) | `src/cost.ts:82`, `src/agent.ts:54` |

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

## Phase 3 (shipped) — provider/model picker, API-key editor, full-page snapshot, persona inspector

Original priorities 13–17 are live. Full file-by-file detail is in the
Architecture section above. This section is the design-decision log so
future-me doesn't relitigate choices.

### Design decisions (locked)

- **API key entry is masked with a peek toggle.** TextInput uses
  `mask="*"`; pressing **Tab** swaps to the unmasked view. The API
  keys menu shows status only — `set (source, last 4: …a7b3)` or
  `missing` — never the full value.
- **The peek hotkey is Tab, not a printable letter.** During Phase 3
  implementation, a `v` peek was tried first but `ink-text-input`
  captures `v` and appends it to the draft, so the keystroke double-
  fired. Tab works because `ink-text-input` doesn't add it to the
  value. Same pattern applies for any future "secondary action while
  TextInput is focused" — bind to a key that lives on `key.<flag>`,
  not the `input` string.
- **Model picker is hard-restricted to the priced list** from
  `availableModelsFor(provider)` in `src/cost.ts`. No "type custom"
  escape hatch. Adding a new model means a PR to `src/cost.ts` first.
  CLI users still have `--model <id>` for ad-hoc experiments.
- **Persona inspector is read-only.** Raw YAML with simple arrow /
  PgUp / PgDn / `g` / `G` scroll. No `$EDITOR` shell-out, no in-TUI
  YAML editor.
- **Provider change resets `state.model = undefined`** so the new
  provider's `defaultModelForProvider()` kicks in. Users who want a
  specific model re-pick it after switching. Avoids carrying an
  Anthropic model id over to OpenAI/Google by mistake.
- **API-key writes are persistent.** They go to
  `~/.persona-review/keys.yaml` via `writeApiKey()` at mode 0o600.
  Other keys in the file round-trip cleanly. This is the only TUI
  setting that persists across sessions — everything else stays
  session-only.

### State additions (`src/tui/state.ts`)

```
inspectingPersonaId: string | null   // which persona's YAML to show
```

`Screen` gained `"apiKeys"` and `"personaInspector"`. Four new
actions: `SET_PROVIDER` (also resets `model`), `SET_MODEL`,
`TOGGLE_FULL_PAGE`, `OPEN_PERSONA_INSPECTOR`.

### Known UX nuances (not bugs)

1. **`v` would not work as a peek hotkey.** See above. `ink-text-input`
   inserts any printable character into the draft; the only way to
   bind a secondary action is via a special key (Tab, PgUp/Dn, F-keys,
   escape, ctrl+letter). Tab is what we shipped.
2. **Peek surfaces the key in terminal scrollback.** A user who
   pressed Tab during edit will leave the full value in the terminal
   buffer (and potentially in screen-sharing capture). Documented;
   user takes responsibility.
3. **`writeApiKey` clobbers comments and key order.** Round-tripping
   via `yaml.parse` + `yaml.stringify` normalizes formatting. A user
   who hand-edited `keys.yaml` with comments will lose them on the
   next TUI save. Acceptable for a credentials file.
4. **Env vars still override file writes.** If a key is set via env
   and the user writes a different value through the TUI, the env
   value still wins at next `lookupApiKey()`. The editor warns about
   this in bold magenta before saving.
5. **Inspector scrolling caps at 18 lines per page.** Hard-coded
   `PAGE_SIZE` in `personaInspector.tsx`. The built-in personas are
   30–60 lines so this is enough to see a full persona in 2–3 pages.
   Very long custom personas could feel cramped; revisit if it comes
   up.

## Phase 4 (if any) — log viewer

Original priority 18 (action / error log viewer) is the only roadmap
item left, and it's still deferred. The current pipeline doesn't
write logs anywhere — adding a viewer first means deciding the
log-writing story:

- **Where to write?** Likely `~/.persona-review/runs/<timestamp>.log`.
- **What to write?** At minimum the persona id, URL, status callback
  messages, final feedback (or error), cost line, model usage.
- **Rotation?** Keep last N runs, prune older?
- **Format?** JSONL (machine-readable) or plain text (human-readable)?

These need user input before any coding. When/if Phase 4 starts:
- Add log writing to `agent.ts` (probably in `runReviewLoop` /
  `runFollowUpTurn` / `openConversation`) gated behind a config option
  so users who don't want disk writes can opt out.
- Add a TUI screen `screens/logs.tsx` listing past runs with date,
  URL, persona, cost, status (success / error / cost-cap-hit).
- Enter on a row opens a viewer (similar to the persona inspector but
  for log content).

The Phase 1–3 architecture supports this cleanly: add a `logs` screen
to the `Screen` union, a `Browse run logs` row in Settings (or a `l`
hotkey on the form), and a new file under `src/tui/screens/`. No
state restructuring needed.

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

Phase 3:

- [x] Settings menu shows all 11 rows in the planned order (Provider,
  Model, Manage API keys, four toggles, submit-data path, three
  numeric editors).
- [x] Provider sub-mode renders 3 rows with `set`/`missing` annotations;
  selecting a different provider returns to Settings, model auto-resets
  to that provider's default, and the form's API-key banner refreshes
  accordingly (verified via the `useEffect` keyed on `state.provider`).
- [x] Model sub-mode lists priced models with `(default)` marker; first
  row is `(use default — X)` which maps to `model: undefined`.
- [x] Manage API keys → apiKeys screen with all 3 providers.
- [x] Writing a key: masked TextInput → save → `~/.persona-review/keys.yaml`
  created with mode **0o600** containing `ANTHROPIC_API_KEY: sk-…`.
  UI flashes "Saved …" and menu re-renders with
  `set (keys.yaml, last 4: …xxxx)`.
- [x] **Tab** peek toggles mask without contaminating the draft
  (initial `v` attempt was rejected — `ink-text-input` captures the
  letter and adds it to the value).
- [x] Empty submit clears the key — file becomes empty, UI flashes
  "Cleared …", menu re-renders with `missing`.
- [x] Full-page snapshot toggle flips `off → on` in place.
- [x] Persona list is cursor-based (`id — name — role` per row);
  Enter opens inspector.
- [x] Inspector renders raw YAML with header `<id> — <name>` + role +
  `built-in` or `custom — <path>`; lines window starts at `1–18 of N`.
- [x] PgDn advances the window; `G` jumps to bottom; `g` jumps to top.

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

Phase 3:

- [ ] Picking a different provider and running a review uses the
  newly-selected provider/model end to end (status log shows
  `<persona> (…, <provider>/<model>) is loading …`).
- [ ] Full-page snapshot on + a tall page → `agent.ts` requests the
  full-page screenshot (`screenshotBytes` larger than the viewport-only
  case; visible in the status line).
- [ ] Editing a custom persona file under `~/.persona-review/personas/`
  between sessions → inspector header shows `custom — <path>`.

## Continuation notes

**Phases 1–3 are shipped.** All original priorities except #18 (action
/ error log viewer) are live in the TUI. The only roadmap item left is
the log viewer, which is sketched in the "Phase 4 (if any)" section
above. It can't start until the user decides on the log-writing story
(see the questions there).

**If the user invokes "start Phase 4"**, ask the four log-writing
questions first (where to write, what to write, rotation policy,
format), then write a `Phase 4 (planned)` section the same way Phase 2
and Phase 3 plans were written. The Architecture is set up for it: add
a `logs` screen to the `Screen` union, a new file under
`src/tui/screens/`, and a "Browse run logs" entry in Settings.

**Design plans for completed phases** (reference only):

- `/Users/osvaldogago/.claude/plans/hi-please-look-at-rosy-dragonfly.md`
  — Phase 1 original plan.
- Phase 2 and Phase 3 plans lived in the chat sessions that shipped
  them; the "Phase 2 (shipped)" and "Phase 3 (shipped)" sections above
  capture the locked decisions and UX nuances worth remembering.

**Settled choices that apply to any future phase:**

- Session-only changes for everything except secrets — don't add writes
  to `defaults.yaml` unless the user explicitly asks. (API keys persist
  via `writeApiKey()` to `~/.persona-review/keys.yaml` because a TUI
  without a key writer is incomplete; other settings would just be
  convenience.)
- Toggles flip on Enter, no sub-screen.
- Sub-modes (provider, model, persona pickers) use Ink's `SelectInput`
  inline inside the parent screen — not a separate top-level screen.
- Light/dark-safe colors from `theme.ts`; never set a background.
- Secondary actions while a `TextInput` is focused must bind to a
  non-printable key (Tab, PgUp/Dn, escape, ctrl+letter). Printable
  letters get captured by `ink-text-input` and appended to the draft.
- Runtime deps in `package.json` are exact-pinned (no `^` / `~`) for
  supply-chain hygiene. devDeps stay on caret. New runtime deps need
  exact pins + `npm shrinkwrap` regeneration.
- Keep `AGENTS.md` from growing unbounded: when a phase ships, its
  detailed walkthrough should move into Architecture (`src/tui/`
  layout) and the phase section collapses to just the design-decision
  log and any UX nuances.
