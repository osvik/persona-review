# persona-review

AI persona feedback for **non-profit, advocacy, charity, and social-cause web
pages**. You give it a URL and a persona; it visits the page and tells you
what that persona noticed, liked, found confusing, and where they'd give up.
Reactions are written in the page's own language, as a native speaker.

- [persona-review](#persona-review)
  - [What it does today](#what-it-does-today)
  - [Architecture](#architecture)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
    - [1. Install via npm (use with npx)](#1-install-via-npm-use-with-npx)
    - [2. Install the development version](#2-install-the-development-version)
    - [3. Install using Docker](#3-install-using-docker)
  - [Configure the LLM provider](#configure-the-llm-provider)
  - [Usage](#usage)
    - [Help](#help)
    - [Version](#version)
    - [Status](#status)
    - [User defaults](#user-defaults)
    - [Basic review with Anthropic model](#basic-review-with-anthropic-model)
    - [List the personas](#list-the-personas)
    - [Pick a persona](#pick-a-persona)
    - [Different language](#different-language)
    - [JSON output](#json-output)
    - [Follow-up questions (interactive REPL)](#follow-up-questions-interactive-repl)
    - [Allow form submission (`--allow-submit`)](#allow-form-submission---allow-submit)
    - [All flags](#all-flags)
    - [Device profile per persona](#device-profile-per-persona)
    - [Example output (prose)](#example-output-prose)
    - [Example output (JSON)](#example-output-json)
  - [Persona file format](#persona-file-format)
  - [The persona library](#the-persona-library)
  - [Reproducibility](#reproducibility)
  - [Scope and safety](#scope-and-safety)
  - [Development](#development)
    - [Build it](#build-it)

---

## What it does today

1. Loads the URL you give it in a real headless Chromium (Playwright). Waits
   for network idle and a small cushion past `DOMContentLoaded` so the
   persona doesn't critique a half-booted UI.
2. Captures the page's **accessibility tree**, the **page language**
   (`<html lang>`), and a **JPEG screenshot** of the top viewport.
3. Runs an **agent loop** as one of the built-in **persona archetypes**: observe →
   choose an action (scroll / click / type) → observe again → repeat. Form
   submission is blocked. The persona narrates only at the end.
4. Prints a final review — summary in the persona's voice (in the page's
   language), plus structured lists of what they liked, what confused them,
   where the friction is, and whether they'd abandon.
5. **Optional follow-up Q&A** (`--repl`): after the review, you can ask the
   same persona questions about the same page in an interactive prompt. The
   persona may scroll/click/type to look again before answering. Or use
   `--repl-only` to skip the review and go straight to questions.
6. **Hard cost cap:** $1 (configurable) per `(URL, persona)` session,
   shared across the review and every follow-up turn. The session aborts
   when exhausted. A soft action cap (15 actions per phase) is also enforced.

7. **Opt-in form submission** (`--allow-submit`): with explicit consent,
   the persona fills the form using a shared test identity, clicks submit
   **once per session**, and reacts to the resulting thank-you message or
   error in their final feedback / answer. Copy `./submit-data.yaml` to
   your own file and pass it with `--submit-data <path>`; editing the
   bundled `submit-data.yaml` directly may be overwritten when the software
   is updated.

It does not: authenticate. Custom personas come from YAML files in your
personal `.persona-review/personas/` directory.

**Scope:** every persona assumes some interest in the cause. This tool is
not designed for commercial / SaaS pages — for that, the personas would need
different goals and frustrations.

---

## Architecture

```
┌─────────────────┐        ┌──────────────────┐        ┌──────────────┐
│  CLI            │  ───▶  │  Playwright      │  ───▶  │  Target URL  │
│  (persona-      │        │  headless        │        │  (public     │
│   review)       │  ◀──   │  Chromium        │  ◀──   │   page)      │
└────────┬────────┘  snap  └──────────────────┘        └──────────────┘
         │ persona + snapshot
         ▼
┌─────────────────┐        ┌──────────────────┐
│  LLM provider   │  ◀──▶  │  Anthropic API   │
│  adapter        │        │  or OpenAI API   │
└─────────────────┘        └──────────────────┘
```

Entry points planned:

| Entry point | Status | How to run |
|---|---|---|
| **CLI** (`persona-review`) | ✅ done | `npx persona-review <url>` or `npm run review -- <url>` |
| **MCP server** (`persona-review-mcp`) | TBD | Mounts into Claude Code / Codex / Gemini CLI as a tool |

---

## Prerequisites

- **[Node.js](https://nodejs.org/en/download) 20 or newer**
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
  — or an **OpenAI API key** for `--provider openai` [platform.openai.com](https://platform.openai.com/)
  — or a **Google Gemini API key** for `--provider google` [aistudio.google.com](https://aistudio.google.com/)
- About 200 MB of disk for Chromium (installed via Playwright)

---

## Install

Choose ONE of the methods bellow. If you prefer you can use the **[free Google Cloud Shell](https://shell.cloud.google.com/?pli=1&show=terminal)** instead of installing to your computer.

### 1. Install via npm (use with npx)

You just need to have installed [Nodejs version 20 or more](https://nodejs.org/en/download).

To install the browser dependency, run this once:

```bash
npx persona-review --install-browsers
```

This downloads the Chromium artifacts needed by the Playwright version bundled
with `persona-review`, including the headless shell used for reviews. On Linux,
it also installs the system packages Chromium needs. Do not use plain
`npx playwright install chromium` for this npm/npx install method; it can
install Chromium for a different Playwright package.

To use you need an API key from Anthropic, Open AI or Google:

```bash
# Use the export command to add your API key. See bellow for more info. 
export ANTHROPIC_API_KEY=sk-ant...

npx persona-review https://example.org/
```

`npx` downloads and runs the latest published version automatically. All
options described in [Usage](#usage) work the same way — replace
`npm run review --` with `npx persona-review` throughout.

---

### 2. Install the development version

Use this if you want to modify the source or contribute:

```bash
git clone https://codeberg.org/osvik/persona-review.git
cd persona-review
npm install
npx playwright install chromium
npm run build
```

`npm install` pulls the dependencies; `npx playwright install chromium`
downloads the browser for the local Playwright dependency; `npm run build`
compiles TypeScript to `dist/` and marks the CLI executable.

To use you need an API key from Anthropic, Open AI or Google:

```bash
# Use the export command to add your API key. See bellow for more info. 
export ANTHROPIC_API_KEY=sk-ant...

npm run review -- https://example.org/
```


---

### 3. Install using Docker

If you can't use another method, you can use this software inside a Docker container. You need to install [Docker](https://www.docker.com/get-started/) first!

This method takes much longer to install, as you have to download the Docker image, but it's reliable.

Create the container from the terminal (just once):

```bash
docker run -it --init --ipc=host --name persona-review node:20-bookworm /bin/bash
```

**Install inside your container (just once):**

```bash
npx persona-review --install-browsers
```

The official `node:20-bookworm` image runs as root by default, so this command
can install both the browser artifacts and the Linux packages Chromium needs.

Test it with your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant...
npx persona-review https://example.org
```

**Use:**

Now you can use it by opening Docker desktop's terminal in the conainer `persona-review`:

```bash
bash
export ANTHROPIC_API_KEY=sk-ant...
npx persona-review http://example.org
```

---

## Configure the LLM provider

By default the CLI calls Anthropic's API directly. [Create your API key](https://platform.claude.com/settings/workspaces/default/keys) and add it to the console with:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

To use **OpenAI** instead, [create your API key](https://platform.openai.com/api-keys) set `OPENAI_API_KEY` and pass `--provider openai`:

```bash
export OPENAI_API_KEY=sk-...
npm run review -- https://example.org --provider openai
```

To use **Google Gemini** instead, [create your API key](https://aistudio.google.com/api-keys), set `GEMINI_API_KEY`, and pass `--provider google`:

```bash
export GEMINI_API_KEY=...
npm run review -- https://example.org --provider google
```

Environment variables take precedence, but you can also store API keys in
`~/.persona-review/keys.yaml`. The file is created empty the first time
persona-review looks for an API key and it does not already exist.

```yaml
ANTHROPIC_API_KEY: sk-ant-...
OPENAI_API_KEY: sk-...
GEMINI_API_KEY: ...
```

Use the same key names as the environment variables. You only need to fill in
the providers you use.

The CLI reads only the key for the selected provider; nothing else leaves your
machine except the HTTP request to the selected LLM provider and the page-load
request to the target URL.

Check which providers are ready, which model ids are built in, and where
defaults come from:

```bash
npm run review -- --status
```

This checks whether each provider has a key in the environment or
`~/.persona-review/keys.yaml`; it does not print API key values.

**Model:** Anthropic defaults to `claude-sonnet-4-6`; OpenAI defaults to
`gpt-5.4`; Google defaults to `gemini-3.1-pro-preview-customtools`. Override
any provider with `--model`, e.g. `--model claude-opus-4-7`,
`--model gpt-5.5`, or `--model gemini-3.1-pro-preview`.

---

## Usage

**Important:** All examples below use the development `npm run review --` form. If you
installed via npm, replace that prefix with `npx persona-review`:

```bash
npm run review -- https://example.org/   # development install
npx persona-review https://example.org/  # npm install
```

### Help

```bash
npm run review -- --help
# or
npx persona-review --help
```

### Version

```bash
npm run review -- --version
# or
npx persona-review --version
```

### Status

```bash
npm run review -- --status
# or
npx persona-review --status
```

Prints whether `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`
are available from the environment or `~/.persona-review/keys.yaml`, without
showing their values. It also lists the model ids accepted by `--model` with
built-in pricing, then shows every effective default and whether it came from
the software or the user defaults file.

### User defaults

On first run, persona-review creates an empty defaults file and an empty
personal personas directory:

- macOS / Linux: `$HOME/.persona-review/defaults.yaml`
- macOS / Linux: `$HOME/.persona-review/personas/`
- Windows: `%USERPROFILE%\.persona-review\defaults.yaml`
- Windows: `%USERPROFILE%\.persona-review\personas\`

Leave it empty to use the built-in defaults. Add YAML keys there to change
your normal defaults without editing source code or rebuilding, which is
especially useful with `npx persona-review`.

Precedence is:

1. Built-in software defaults.
2. User defaults from `defaults.yaml`.
3. Options passed on the command line.

Example:

```yaml
persona: evidence-and-accountability-checker
provider: openai
model: gpt-5.4
device: desktop
cost_cap_usd: 2
max_actions: 20
max_tokens: 4096
full_page_snapshot: true
allow_downloads: true
allow_cross_page_navigation: false  # set true to let personas follow links to other pages
submit_data: /Users/me/.persona-review/submit-data.local.yaml
```

Then a shorter command uses those defaults:

```bash
npx persona-review https://example.org/
```

Command-line options still win for that run:

```bash
npx persona-review https://example.org/ --persona time-pressed-task-completer --provider anthropic
```

For boolean defaults set to `true`, use the matching `--no-...` flag to
turn them off for one run, for example `--no-json`, `--no-repl`,
`--no-allow-submit`, `--no-allow-downloads`, `--no-full-page-snapshot`, or
`--no-allow-cross-page-navigation`.

Supported defaults keys are `persona`, `provider`, `model`, `device`,
`json`, `repl`, `repl_only`, `allow_submit`, `allow_downloads`,
`allow_cross_page_navigation`, `submit_data`, `yes`, `max_tokens`,
`max_actions`, `cost_cap_usd`, and `full_page_snapshot`. The equivalent long
flag names with hyphens, such as `max-tokens` and `allow-downloads`, are also
accepted.

### Basic review with Anthropic model

```bash
npm run review -- https://example.org/
```

### List the personas

```bash
npm run review -- --list-personas
```

Uses the default persona (`newcomer-orientation-seeker`).

### Pick a persona

```bash
npm run review -- https://example.org --persona evidence-and-accountability-checker
npm run review -- https://example.org --persona time-pressed-task-completer
```

### Different language

The page's language is detected from `<html lang>` and the LLM responds as a
native speaker of that language. No flag needed.

### JSON output

```bash
npm run review -- https://example.org --json > review.json
```

`--json` cannot be combined with `--repl` or `--repl-only`.

### Follow-up questions (interactive REPL)

After the review, ask the same persona questions about the same page:

```bash
npm run review -- https://example.org --persona evidence-and-accountability-checker --repl
```

```
── Mei's feedback ── (review prose…)

[follow-up REPL — ask Mei a question. Type "exit" or press Ctrl-D to leave.
 Cost cap shared with the review: $0.78 of $1.00 remaining.]

> Ask Mei: would a clearer financial breakdown change your mind?

Mei: Probably yes — what I want is a single page that shows where the money
goes. The current "About" section gestures at it but the numbers aren't there.

[1 action(s) — $0.27 of $1.00 cap — $0.73 remaining]
```

Skip the review entirely and go straight to questions:

```bash
npm run review -- https://example.org --persona evidence-and-accountability-checker --repl-only
```

The browser session, page state, and conversation history are reused across
every question, so the persona can scroll/click/type to look again. The cost
cap is **per `(URL, persona)` session** and accumulates across the review
plus every follow-up turn.

### Allow form submission (`--allow-submit`)

By default, form-submit buttons are blocked at the browser layer. Pass
`--allow-submit` to let the persona fill the form, click submit **once**,
and react to the resulting thank-you / error / validation page. Submission
is hard-capped at one per `(URL, persona)` session.

Before submitting real forms, copy the bundled identity template and pass
your copy with `--submit-data`. Do not edit `submit-data.yaml` in place:
updates may overwrite that file.

```bash
cp submit-data.yaml submit-data.local.yaml
npm run review -- https://example.org --persona regular-supporter-donor --allow-submit --submit-data ./submit-data.local.yaml
```

The CLI prints a consent prompt summarizing the test identity and target
URL, then waits for `y` / `yes` before opening the browser:

```
=== --allow-submit: form submission ENABLED for this run ===

Target URL: https://example.org/petition
Persona:    Daniel (regular-supporter-donor)

Source: ./submit-data.local.yaml (pass --submit-data <path> to use your copy)
Test identity that will be typed into form fields:

  Name:    Daniel PersonaReview
  Email:   persona-review+test@example.com
  Phone:   +49 30 12345678
  Address: Teststrasse 1, PersonaReview test record, 10115 Berlin, Germany
  Card:    4242 4242 4242 4242 (exp 12/2030)
  IBAN:    DE89 3704 0044 0532 0130 00
  Donation: 5 EUR (one-off)
  ...

This may create a real record in the target site's CRM, marketing
automation, or analytics. Records will be findable by the name and email
above; delete them after the run.
Hard limit: at most one successful submission per session.

Continue and submit the form? [y/N]
```

Customize the identity by duplicating `submit-data.yaml`, editing your
copy, and passing it with `--submit-data /path/to/your.yaml` or
`--submit-data /path/to/your.yml`. Do not edit
the bundled `submit-data.yaml` directly because software updates may
overwrite it. All personas share the same identity so you don't end up with
one CRM record per persona — search the CRM for `PersonaReview` and the test
email after the run, then delete.

**Country-specific fields.** The four typed sub-sections (`identity`,
`address`, `payment`, `donation`) accept extra keys beyond the documented
ones, so you can add a Spanish DNI, a German VAT number, a US SSN, etc.
without changing the code. They're surfaced to the LLM with their YAML
key as the label:

```yaml
identity:
  first_name: null            # falls back to the persona's name
  last_name: "PersonaReview"
  email: "persona-review+test@example.com"
  phone: "666666666"
  dni_o_nie: "08966195J"      # custom Spain field — picked up automatically

address:
  line1: "Calle de las pruebas"
  line2: "66 ESC INT 1A"
  city: "Madrid"
  postcode: "28007"
  country_code: "ES"
  country_name: "España"
```

The persona will use these values verbatim when filling form fields it
recognizes by label.

For automated runs (CI etc.) pass `--yes` to skip the prompt:

```bash
npm run review -- https://example.org --allow-submit --submit-data ./submit-data.local.yaml --yes
```

### All flags

```
npm run review -- <url> [options]
npm run review -- --status
npm run review -- --list-personas
npm run review -- --version

  --persona <id>           Persona archetype id (default: newcomer-orientation-seeker).
  --provider <name>        LLM provider: 'anthropic', 'openai', or 'google'
                           (default: anthropic).
  --device <m|d>           Override the persona's device: 'mobile' or 'desktop'.
  --status                 Show provider readiness, available --model ids,
                           and default sources.
  --list-personas          Print available personas and exit.
  --json                   Emit JSON instead of prose. Mutually exclusive
                           with --repl / --repl-only.
  --repl                   After the review, enter an interactive prompt for
                           follow-up questions. Cost cap is shared.
  --repl-only              Skip the review; load the page and go straight
                           to the interactive prompt.
  --allow-submit           Permit ONE form submission this session. Persona
                           fills the form with the shared test identity and
                           reacts to the resulting page. Requires consent.
                           Copy submit-data.yaml and pass the copy with
                           --submit-data; edits to the bundled file may be
                           overwritten by updates.
  --allow-downloads        Permit browser downloads. Default: downloads are
                           blocked by Playwright.
  --allow-cross-page-navigation
                           Permit persona clicks to navigate away from the
                           reviewed URL. Default: blocked; same-page anchors
                           and non-link UI controls still work.
  --submit-data <path>     Use your copied .yaml/.yml test identity file
                           (default template: ./submit-data.yaml).
  -y, --yes                Skip the --allow-submit consent prompt.
  --model <id>             Provider-specific model id (defaults:
                           Anthropic claude-sonnet-4-6, OpenAI gpt-5.4,
                           Google gemini-3.1-pro-preview-customtools).
  --cost-cap-usd <n>       Hard cost cap in USD per (URL, persona) session
                           (default: 1.0). Includes review + all REPL turns.
  --max-actions <n>        Soft cap on browser actions per phase (default: 15).
  --max-tokens <n>         Max output tokens per LLM call (default: 4096).
  --full-page-snapshot     Send a full-page screenshot each turn (default:
                           viewport only — the persona must scroll to see more).
  --no-<boolean-flag>      Disable a boolean option set in user defaults
                           for this run, e.g. --no-json or --no-repl.
  -v, --version            Show the package version.
  -h, --help               Show help.
```

### Device profile per persona

Each persona has a `device` field which determines the viewport and user
agent:

| `device` value | Viewport | User agent | Touch |
|---|---|---|---|
| `mobile` | 390×844 (iPhone-class) | iOS Safari 18 | yes |
| `desktop` | 1280×800 | Chrome 126 on macOS | no |
| `either` | resolves to desktop | Chrome 126 on macOS | no |

Pass `--device mobile` or `--device desktop` to override the persona's
default.

### Example output (prose)

```
── Marta's feedback ──

I came here because a friend sent the link and said I should sign. The big
photo of the forest is beautiful, and the headline is clear. I like that I
can tell within two seconds what this is about and what they want from me.
But the form asks for my phone number and I don't love giving that out —
especially without a clear word on what they'll do with it.

Liked: clear purpose, strong imagery, short form

Confused by: what happens after I sign, why they need a phone number.

Abandoned:   no — I'd probably sign, but reluctantly.

Friction:
  - [medium] phone number field: "I don't want calls from an organisation"
  - [low] privacy link in the footer: "it's far away from the form itself"
```

(Illustrative — actual output varies, because persona reactions are not
seeded. See "Reproducibility" below.)

### Example output (JSON)

```json
{
  "persona_id": "marta-smb-owner",
  "url": "https://example.com",
  "summary": "...",
  "liked": ["..."],
  "confused_by": ["..."],
  "friction": [{"where": "...", "severity": "high", "quote": "..."}],
  "abandoned_at": null,
  "accessibility_issues": ["..."],
  "trust_signals": {"positive": ["..."], "negative": ["..."]},
  "trace": [{"step": "...", "reaction": "..."}]
}
```

---

## Persona file format

Built-in personas live as YAML files in this package's `personas/` directory.
Custom user personas live in `$HOME/.persona-review/personas/` on macOS/Linux
or `%USERPROFILE%\.persona-review\personas\` on Windows. Each file is
validated against the Zod schema in `src/persona.ts`. Example:

```yaml
id: newcomer-orientation-seeker # unique slug
name: Aisha                    # illustrative; LLM adapts in any language
age: 27                        # optional
role: New to the cause and deciding whether to engage
cause_engagement: casual       # neutral | casual | regular | committed
scrutiny: low-medium           # low-medium | medium | high
goals:
  - understand what this organization does in 30 seconds
  - decide whether it feels legitimate before doing anything
motivations:
  - wants to feel their small action could make a concrete difference
  - responds to human stories when they are backed by clear proof
frustrations:
  - jargon and acronyms
  - vague claims with no evidence
behaviours:
  - scans the headline, first call to action, and first proof point before reading
  - hesitates if commitment is requested before impact or legitimacy is clear
tech_confidence: medium        # low-medium | medium | medium-high (no extremes)
device: either                 # mobile | desktop | either
accessibility: []              # e.g. [larger-text, screen-reader]
reading_level: general         # general | detailed
voice: curious, open-minded, easily discouraged by unclear entry points
```

Notes:

- **No `locale` field.** Language is auto-detected from the page's
  `<html lang>` at runtime, so each persona works in any language.
- `motivations` and `behaviours` are optional for custom personas. If omitted,
  they default to empty arrays, so older custom persona files still load.
- `tech_confidence` is restricted to a middle band — no zero-tech and no
  power-user, by design.
- We describe **UX-relevant traits** (goals, motivations, frustrations,
  behaviours, tech confidence, device, accessibility needs) and avoid
  demographic caricature.

You can drop your own custom YAML files into your personal personas directory
and they'll be picked up by `--list-personas` and `--persona <id>`. If a custom
persona uses the same `id` as a built-in persona, the custom persona wins. If
you edit the package's built-in files, they may be overwritten when you update
the software.

---

## The persona library

Built-in archetypes, most assuming **at least some interest in the cause**.
The deadline journalist is neutral toward the organization and cause, but has
a practical reason to use press material accurately. The fundraising and visual
design specialists are expert lenses for teams that want a more professional
critique.

| id | who | device | tech | engagement | scrutiny |
|---|---|---|---|---|---|
| `newcomer-orientation-seeker` | Aisha — new to the cause and deciding whether to engage | either | medium | casual | low-medium |
| `time-pressed-task-completer` | Sofia — arrives with intent and wants to finish quickly | either | medium | regular | low-medium |
| `regular-supporter-donor` | Daniel — gives occasionally and may consider recurring support | either | medium | regular | medium |
| `evidence-and-accountability-checker` | Mei — checks evidence, transparency, and accountability | either | medium-high | regular | high |
| `deadline-journalist` | Nadia — needs accurate, usable material on deadline | either | medium-high | neutral | high |
| `advocate-and-sharer` | Femi — wants to act, share, and bring others in | either | medium-high | committed | medium |
| `plain-language-reader` | Anna — prefers everyday words | either | medium | regular | medium |
| `accessibility-focused-reader` | Yusuf — uses assistive and adaptive settings | either | medium | regular | medium |
| `help-seeker` | Rosa — needs support for themselves or someone close | either | medium | regular | medium |
| `legacy-and-planned-giving-prospect` | Margaret — considers major or planned giving | either | low-medium | committed | high |
| `marketing-fundraising-specialist` | Ines — reviews fundraising and engagement pages | either | medium-high | committed | high |
| `visual-design-specialist` | Kenji — reviews visual composition | either | medium-high | committed | high |

Run `npm run review -- --list-personas` for the same list with full role
descriptions.

---

## Reproducibility

Two runs against the same URL with the same persona will produce different
reactions. That is intentional — it simulates natural human variability.
Don't treat a single review as canonical; run it twice, look at what both
reviews agree on, and treat the overlap as the signal.

---

## Scope and safety

- **Public pages only.** Authenticated pages are out of scope.
- **Form submission is opt-in.** Default is no submission — submit buttons
  are blocked at the browser layer. With `--allow-submit` (and confirmed
  consent), the persona fills the form using the shared test identity and
  submits **at most once per session**. Copy `submit-data.yaml`, edit your
  copy, and pass it with `--submit-data`; direct edits to the bundled file
  may be overwritten by software updates. The same test identity is used
  across all personas so records stay easy to find and delete in the target
  site's CRM.
- **Downloads are opt-in.** Default is no browser downloads. Pass
  `--allow-downloads` to let Playwright accept downloads for the session.
  Accepted downloads stay in Playwright's temporary browser storage; this
  tool does not save them into the project, and they are deleted when the
  browser context closes.
- **Cross-page navigation is opt-in.** Default reviews stay on the URL being
  reviewed. Links that would leave that URL are blocked at the browser layer,
  while same-page anchors, cookie banners, tabs, accordions, and other
  non-link controls still work. Pass `--allow-cross-page-navigation` when a
  review should intentionally follow links to other pages.
- **Local-only.** No servers we operate. Traffic goes only to the target URL
  and to the selected LLM provider API.
- **Cost cap.** Every session enforces a hard USD cap (default $1, override
  with `--cost-cap-usd`). The cap is **per `(URL, persona)` session** —
  shared across the review and every follow-up REPL turn — and aborts the
  run when exhausted, so a runaway agent cannot burn unbounded spend.

---

## Development

Important: before you do any development, note that this software is licensed
under the GNU Affero General Public License v3.0. Any modification of the
software, or cloud use such as providing access through a graphical user
interface or MCP server, must comply with the
**[requirements of this license](https://choosealicense.com/licenses/agpl-3.0/)**.

### Build it

```bash
npm run typecheck    # type-check without emitting
npm run build        # compile to dist/
npm run review -- <url>   # run the compiled CLI
```

Source layout:

```
src/
  agent.ts        # PersonaConversation orchestration, review loop, REPL turns,
                  #   provider/model selection, action caps, and submit cap.
  browser.ts      # Playwright browser session: open, observe, scroll, click,
                  #   type, close; blocks submits, downloads, and cross-page
                  #   navigation unless enabled.
  cli.ts          # CLI entry: flags, persona loading, provider key checks,
                  #   --allow-submit consent, JSON/prose output, REPL.
  cost.ts         # Per-provider/model pricing and CostTracker cap enforcement.
  defaults.ts     # User defaults file creation/loading and option validation.
  persona.ts      # Persona Zod schema + YAML loader/listing helpers.
  review.ts       # Feedback/follow-up schemas, tool schemas, and system prompt
                  #   builder including conditional submission policy.
  submit-data.ts  # Test-identity Zod schema + loader; resolves first_name to
                  #   the persona's name when YAML leaves it null.
  user-config.ts  # Cross-platform paths for ~/.persona-review resources.
  llm/
    types.ts      # Shared provider-neutral message, tool, usage, and client
                  #   interfaces.
    anthropic.ts  # Anthropic Messages adapter.
    google.ts     # Google Gemini generateContent adapter.
    openai.ts     # OpenAI Responses API adapter.
personas/
  *.yaml          # 12 archetype files; drop your own in here too
submit-data.yaml  # Default shared test identity template for --allow-submit
                  #   copy it and pass the copy with --submit-data
package.json      # Package metadata, CLI bin, npm scripts, dependencies.
tsconfig.json     # TypeScript compiler settings.
LICENSE           # GNU Affero General Public License v3.0.
```
