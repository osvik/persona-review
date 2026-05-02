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
  - [Configure the LLM provider](#configure-the-llm-provider)
  - [Usage](#usage)
    - [Help](#help)
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

---

## What it does today

1. Loads the URL you give it in a real headless Chromium (Playwright). Waits
   for network idle and a small cushion past `DOMContentLoaded` so the
   persona doesn't critique a half-booted UI.
2. Captures the page's **accessibility tree**, the **page language**
   (`<html lang>`), and a **JPEG screenshot** of the top viewport.
3. Runs an **agent loop** as one of **10 persona archetypes**: observe →
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
   the persona fills the form using a shared test identity (from
   `./submit-data.yaml` or `--submit-data <path>`), clicks submit **once
   per session**, and reacts to the resulting thank-you message or error
   in their final feedback / answer.

It does not: authenticate. Custom personas come from YAML files
in `personas/` — drop your own in there.

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
| **CLI** (`persona-review`) | ✅ done | `npx persona-review <url>` |
| **MCP server** (`persona-review-mcp`) | TBD | Mounts into Claude Code / Codex / Gemini CLI as a tool |

---

## Prerequisites

- **[Git](https://git-scm.com/install/)** - Version control.
- **[Node.js](https://nodejs.org/en/download) 20 or newer**
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
  — or an **OpenAI API key** for `--provider openai` [platform.openai.com](https://platform.openai.com/)
- About 200 MB of disk for Chromium (installed via Playwright)

---

## Install

```bash
git clone https://codeberg.org/osvik/persona-review.git
cd persona-review
npm install
npx playwright install chromium
npm run build
```

`npm install` pulls the dependencies; `npx playwright install chromium`
downloads the browser Playwright drives; `npm run build` compiles TypeScript
to `dist/` and marks the CLI executable.

---

## Configure the LLM provider

The CLI calls Anthropic's API directly. **[Set your key](https://platform.claude.com/dashboard)** in the environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

To use OpenAI instead, set `OPENAI_API_KEY` and pass `--provider openai`:

```bash
export OPENAI_API_KEY=sk-...
npx persona-review https://example.org --provider openai
```

Or put keys in a `.env` and source it before running. The CLI reads only the
key for the selected provider; nothing else leaves your machine except the
HTTP request to the selected LLM provider and the page-load request to the
target URL.

**Model:** Anthropic defaults to `claude-sonnet-4-6`; OpenAI defaults to
`gpt-5.4`. Override either with `--model`, e.g. `--model claude-opus-4-7` or
`--model gpt-5.5`.

---

## Usage

### Help

```bash
npx persona-review --help
```

### Basic review with Anthropic model

```bash
npx persona-review https://example.org/
```

### List the personas

```bash
npx persona-review --list-personas
```

Uses the default persona (`curious-newcomer`).

### Pick a persona

```bash
npx persona-review https://example.org --persona cautious-researcher
npx persona-review https://example.org --persona time-pressed-mobile-reader
```

### Different language

The page's language is detected from `<html lang>` and the LLM responds as a
native speaker of that language. No flag needed:

```bash
npx persona-review https://example.org/es/ --persona engaged-regular-supporter
# Daniel's reactions come back in Spanish
```

### JSON output

```bash
npx persona-review https://example.org --json > review.json
```

`--json` cannot be combined with `--repl` or `--repl-only`.

### Follow-up questions (interactive REPL)

After the review, ask the same persona questions about the same page:

```bash
npx persona-review https://example.org --persona cautious-researcher --repl
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
npx persona-review https://example.org --persona cautious-researcher --repl-only
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

```bash
npx persona-review https://example.org --persona engaged-regular-supporter --allow-submit
```

The CLI prints a consent prompt summarizing the test identity and target
URL, then waits for `y` / `yes` before opening the browser:

```
=== --allow-submit: form submission ENABLED for this run ===

Target URL: https://example.org/petition
Persona:    Daniel (engaged-regular-supporter)

Source: ./submit-data.yaml (default — pass --submit-data <path> to override)
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

Customize the identity by passing
`--submit-data /path/to/your.yaml`. All personas share the same identity
so you don't end up with one CRM record per persona — search the CRM for
`PersonaReview` and the test email after the run, then delete.

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
npx persona-review https://example.org --allow-submit --yes
```

### All flags

```
persona-review <url> [options]
persona-review --list-personas

  --persona <id>           Persona archetype id (default: curious-newcomer).
  --provider <name>        LLM provider: 'anthropic' or 'openai'
                           (default: anthropic).
  --device <m|d>           Override the persona's device: 'mobile' or 'desktop'.
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
  --allow-downloads        Permit browser downloads. Default: downloads are
                           blocked by Playwright.
  --submit-data <path>     Override the test identity (default: ./submit-data.yaml).
  -y, --yes                Skip the --allow-submit consent prompt.
  --model <id>             Provider-specific model id (defaults:
                           Anthropic claude-sonnet-4-6, OpenAI gpt-5.4).
  --cost-cap-usd <n>       Hard cost cap in USD per (URL, persona) session
                           (default: 1.0). Includes review + all REPL turns.
  --max-actions <n>        Soft cap on browser actions per phase (default: 15).
  --max-tokens <n>         Max output tokens per LLM call (default: 4096).
  --full-page-snapshot     Send a full-page screenshot each turn (default:
                           viewport only — the persona must scroll to see more).
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

Liked:       clear purpose, strong imagery, short form
Confused by: what happens after I sign, why they need a phone number
Abandoned:   no — I'd probably sign, but reluctantly

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

Personas live as YAML files in `personas/`. Each file is validated against
the Zod schema in `src/persona.ts`. Example:

```yaml
id: curious-newcomer           # unique slug
name: Aisha                    # illustrative; LLM adapts in any language
age: 27                        # optional
role: Just learning about the cause
cause_engagement: casual       # casual | regular | committed
scrutiny: medium               # low-medium | medium | high
goals:
  - understand what this organization does in 30 seconds
  - decide whether it feels legitimate before doing anything
frustrations:
  - jargon and acronyms
  - vague claims with no evidence
tech_confidence: medium        # low-medium | medium | medium-high (no extremes)
device: mobile                 # mobile | desktop | either
accessibility: []              # e.g. [larger-text, screen-reader]
reading_level: general         # general | detailed
voice: curious, friendly, easily distracted
```

Notes:

- **No `locale` field.** Language is auto-detected from the page's
  `<html lang>` at runtime, so each persona works in any language.
- `tech_confidence` is restricted to a middle band — no zero-tech and no
  power-user, by design.
- We describe **UX-relevant traits** (goals, frustrations, tech confidence,
  device, accessibility needs) and avoid demographic caricature.

You can drop your own custom YAML files into the same `personas/` folder
and they'll be picked up by `--list-personas`. If you edit the existing files they may be overwritten when you update the software.

---

## The persona library

Ten archetypes, all assuming **at least some interest in the cause**:

| id | who | device | tech | engagement | scrutiny |
|---|---|---|---|---|---|
| `curious-newcomer` | Aisha — just learning about the cause | mobile | medium | casual | medium |
| `engaged-regular-supporter` | Daniel — donates to a few causes a year | desktop | medium | regular | medium |
| `cautious-researcher` | Mei — vets organizations carefully | desktop | medium-high | regular | high |
| `time-pressed-mobile-reader` | Lucia — reads on the go | mobile | medium | regular | low-medium |
| `active-advocate` | Femi — volunteers and shares campaigns | desktop | medium-high | committed | medium |
| `plain-language-reader` | Anna — prefers everyday words | mobile | medium | regular | medium |
| `larger-text-reader` | Yusuf — reads at larger zoom levels | desktop | medium | regular | medium |
| `email-campaign-visitor` | Sofia — clicked through from a campaign email | mobile | medium | regular | low-medium |
| `information-thorough-reader` | Marcus — reads everything before deciding | desktop | medium-high | committed | high |
| `recurring-small-amount-giver` | Priya — gives a modest amount monthly | either | medium | regular | medium |

Run `npx persona-review --list-personas` for the same list with full role
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
  consent), the persona fills the form using the shared test identity in
  `submit-data.yaml` and submits **at most once per session**. The same
  test identity is used across all personas so records stay easy to find
  and delete in the target site's CRM.
- **Downloads are opt-in.** Default is no browser downloads. Pass
  `--allow-downloads` to let Playwright accept downloads for the session.
  Accepted downloads stay in Playwright's temporary browser storage; this
  tool does not save them into the project, and they are deleted when the
  browser context closes.
- **Local-only.** No servers we operate. Traffic goes only to the target URL
  and to the selected LLM provider API.
- **Cost cap.** Every session enforces a hard USD cap (default $1, override
  with `--cost-cap-usd`). The cap is **per `(URL, persona)` session** —
  shared across the review and every follow-up REPL turn — and aborts the
  run when exhausted, so a runaway agent cannot burn unbounded spend.

---

## Development

```bash
npm run typecheck    # type-check without emitting
npm run build        # compile to dist/
npm start -- <url>   # run the compiled CLI
```

Source layout:

```
src/
  browser.ts      # BrowserSession: open / observe / scroll / click / type / close
                  #   click() honors session.allowSubmit and reports submitted=true
                  #   downloads are blocked unless allowDownloads=true
  persona.ts      # Zod schema + YAML loader (listPersonas, loadPersonaById)
  submit-data.ts  # Test-identity Zod schema + loader (resolves first_name to
                  #   the persona's name when YAML leaves it null)
  review.ts       # Feedback + answer schemas, tool schemas, system prompt
                  #   builder (conditional submission policy section)
  agent.ts        # Long-lived PersonaConversation:
                  #   openConversation → runReviewLoop → runFollowUpTurn (×N) → close
                  #   tracks submitsTaken (cap = MAX_SUBMITS_PER_SESSION = 1)
  cost.ts         # Per-model pricing + CostTracker (cap enforcement)
  cli.ts          # CLI entry: review, --repl, --repl-only, --allow-submit consent
personas/
  *.yaml          # 10 archetype files; drop your own in here too
submit-data.yaml  # Default shared test identity for --allow-submit
```

