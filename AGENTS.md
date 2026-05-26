# Adding an interactive terminal app

To make it easier and more confortable to use persona-review, we want to build a TUI. It's important to keep it simple, maintainable and don't over engineer it.

## Requirements

- Works on MacOS, Linux and if possible also on Windows.
- At least Bash and Zsh. And PowerShell for Windows.
- With the same requirements as the CLI (Node.js 20 or newer).
- Uses the same defaults, user settings, personas and api keys than the CLI.
- Works in both production mode (npx persona-review --ui) or development mode (npm run review -- --ui)
- Usable trough SSH
- Views well in dark or light background terminals.
- If it's necessary to store temporary information or extra settings, use the ~/.persona-review/ folder, when possible compatible with the CLI.
- Should auto-update when used in production mode, with npx, just as the CLI. In developer mode, updates are controlled by the user with git.

## Suggestions

- Based on INK https://github.com/vadimdemedes/ink
- Being able to use a mouse is not required but, if it can be added easily and it works across platforms, it's great.
- Avoid tightly coupling TUI logic directly into CLI code.

## Priorities

From most to least important.

### Phase 1:

1. Insert an URL, select the persona, select the device
2. View all the available personas with the summary as with --list-personas
3. View the cost at the end of each operation.
4. Allow chat as in --repl or --repl-only and end chat.
5. Warn if the API key is not set.

### Phase 2:

6. Enable / disable cross-page-navigation
7. Enable / disable downloads
8. Enable / disable submit forms
9. Select submit-data file
10. Edit cost cap
11. Edit max actions
12. Edit max tokens

### Phase 3:

13. Select API key providers
14. Select models
15. Add API keys
16. Enable full page snapshot
17. Inspect persona (view yaml file)
18. Actions log and errors log, inside ~/.persona-review/
