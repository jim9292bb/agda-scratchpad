# CODEX_WORKFLOWS.md

## Purpose

This file documents repeatable Codex workflows for this repository. Use it together with `AGENTS.md`, `PROJECT_GOAL.md`, and `ROADMAP.md`.

`PROJECT_GOAL.md` defines product positioning. `AGENTS.md` defines rules.
`ROADMAP.md` defines the roadmap. This file defines how to
execute common tasks.

## Default Development Workflow

1. Read `AGENTS.md`.
2. Read `PROJECT_GOAL.md` when the task could affect product scope.
3. Read the relevant section of `ROADMAP.md`.
4. Reject or defer features that primarily support multi-file or project-level
   development.
5. Search existing implementation before editing:
   ```sh
   rg "Cmd_|runAgdaShortcut|handleAgdaChord|InteractionPoints|GiveAction|MakeCase" src
   ```
6. Make the smallest coherent change.
7. Run:
   ```sh
   source /usr/share/nvm/init-nvm.sh && npm run check
   source /usr/share/nvm/init-nvm.sh && npm run build
   ```
8. For editor, shortcut, goal, or browser behavior changes, run an `agent-browser` regression.
9. Summarize changed files, tests, and residual risk.
10. Commit only when requested. Never push unless explicitly requested.

## Local Tooling

This workspace uses `nvm`. Load Node tools before running `npm` or `agent-browser`:

```sh
source /usr/share/nvm/init-nvm.sh
```

Use one-shot commands when possible:

```sh
source /usr/share/nvm/init-nvm.sh && npm run check
source /usr/share/nvm/init-nvm.sh && npm run build
```

`agent-browser` is also installed through the nvm-managed Node environment:

```sh
source /usr/share/nvm/init-nvm.sh && agent-browser --version
```

## Plugin/MCP Usage

Use plugins and MCP servers as support tools. They do not replace this repo's
local checks, roadmap, or product scope.

- `agent-browser`: use for browser regressions and manual UI inspection. Prefer
  the npm scripts under `test:browser:*` before ad hoc browser commands.
- `context7`: use for current Svelte, Vite, CodeMirror, and other
  library/framework documentation when API behavior is uncertain.
- OpenAI docs MCP: use for Codex, OpenAI API, or OpenAI product documentation.
- GitHub plugin: use for PRs, issues, repository metadata, and CI inspection.
  Still verify local work with `git status`, `git diff`, `npm run check`, and
  `npm run build`.
- Canva plugin: outside the normal engineering workflow. Use only for explicit
  presentation, teaching, or visual-asset requests.

If a plugin answer conflicts with local repository files, treat the local
repository as the source of truth and investigate before editing.

## Superpowers-Inspired Workflow

Use `obra/superpowers` as a lightweight methodology reference, not as a
mandatory dependency.

For large features, risky refactors, or ambiguous requests:

1. Clarify the product intent against `PROJECT_GOAL.md`.
2. Check `ROADMAP.md` and existing implementation before deciding what to do.
3. Write or confirm a handoff-quality plan before editing.
4. Make the smallest coherent implementation that satisfies the plan.
5. Verify before completion with the checks required by the change type.
6. Summarize what changed, what was tested, and any remaining risk.

For complex bugs:

1. Reproduce or inspect the failing behavior first.
2. Form a concrete hypothesis from code, logs, or browser state.
3. Change one layer at a time.
4. Add or update a regression when the bug is fixed.

Do not require Superpowers-specific worktrees, subagents, or strict TDD unless
the user explicitly asks for them. This repo's primary workflow remains
`AGENTS.md`, `PROJECT_GOAL.md`, `ROADMAP.md`, and this file.

## Core Practice Command Refactor Workflow

Use this when working on Core Agda Commands.

Goal: move command construction out of `src/routes/+page.svelte` without changing behavior.

Recommended steps:

1. Inspect current inline command strings in `src/routes/+page.svelte`.
2. Add or update a reusable command module, for example `src/lib/agda/commands.js`.
3. Move command string construction into named functions.
4. Keep shortcut key handling in `+page.svelte` until command construction is fully extracted.
5. Preserve existing labels, logs, pending goal behavior, and error messages.
6. Run `source /usr/share/nvm/init-nvm.sh && npm run check`.
7. Run `source /usr/share/nvm/init-nvm.sh && npm run build`.
8. Browser-test at least Load, Give, Case split, and Refine.

Do not implement new shortcuts in the same commit as the extraction unless explicitly requested.

## Reference Research Workflow

Use this before porting behavior from another project.

1. Search this repo first:
   ```sh
   rg "Cmd_|InteractionPoints|GiveAction|MakeCase" src
   ```
2. Search relevant reference repositories:
   ```sh
   rg "Cmd_make_case|Cmd_give|Cmd_autoOne" ../references/agda-mode-vscode ../references/agda-web-agda-language-server ../references/agda
   ```
3. Summarize the source behavior before editing.
4. Prefer small ports that preserve browser constraints.
5. Do not modify files under `../references/`.

Before researching `agda-mode-vscode` shortcuts, check:

```sh
docs/AGDA_MODE_VSCODE_MAPPING.md
```

That file records keybinding and `Cmd_*` mappings that have already been researched.

## Browser Regression Workflow

Use `agent-browser` for any CodeMirror, shortcut, or goal lifecycle change.

Prefer the npm regression entry points first:

```sh
npm run test:browser
npm run test:browser:core-commands
npm run test:browser:goal-lifecycle
npm run test:browser:auto
npm run test:browser:queries
npm run test:browser:command-input
npm run test:browser:goal-details
npm run test:browser:libraries
npm run test:browser:errors
npm run test:browser:examples
```

Run browser regressions with a dev server already running:

Start the dev server:

```sh
source /usr/share/nvm/init-nvm.sh && npm run dev -- --host 0.0.0.0 --force
```

Open the app:

```sh
source /usr/share/nvm/init-nvm.sh && XDG_RUNTIME_DIR=/tmp/agent-browser-runtime agent-browser open http://127.0.0.1:8099/
```

If `agent-browser` fails with a daemon socket, bind, or read-only filesystem error inside the sandbox, rerun the browser command with escalated execution. The browser daemon needs to create sockets outside the restricted sandbox.

The npm scripts delegate to `scripts/browser-test-*.sh`. Use the shell scripts directly only when debugging the test helper itself.

Use fixtures from `test-fixtures/agda/` instead of rewriting Agda snippets in prompts whenever possible:

- `plus-case-split.agda`: Load, case split, give lifecycle, active goal details, and command input panel prompt behavior.
- `idN-auto.agda`: Auto fills a simple identity function.
- `idN-elaborate.agda`: Elaborate and give fills a simple identity function.
- `query-goal.agda`: Goal query fixture.
- `query-bool.agda`: Search/module/why-in-scope query fixture.
- `cubical-prelude.agda`: Cubical load regression.
- `stdlib-nat.agda`: standard-library load regression.
- `error-syntax.agda`: syntax error display regression.
- `error-not-in-scope.agda`: semantic error display regression.

For manual testing, use this Agda source:

```agda
data N : Set where
  z : N
  s : N -> N

_+_ : N -> N -> N
a + b = ?
```

Minimum checks:

1. Click `Start`.
2. Click `Load` or press `C-c C-l`.
3. Verify `?` becomes `{! !}` and a goal is shown.
4. Type `a` in the goal and press `C-c C-c`.
5. Verify case split produces:
   ```agda
   z + b = {!   !}
   s a + b = {!   !}
   ```
6. Type `b` in the first goal and press `C-c C-Space`.
7. Verify the first goal is replaced by `b` and the second goal remains valid.
8. Inspect `.agda-hole` DOM if behavior looks wrong.
9. Check the log panel for unexpected Agda or ALS errors.

When setting editor content from `agent-browser`, use CodeMirror's `EditorView.dispatch()` through the exposed internal view:

```sh
source /usr/share/nvm/init-nvm.sh && XDG_RUNTIME_DIR=/tmp/agent-browser-runtime agent-browser eval '(() => {
  const source = `data N : Set where
  z : N
  s : N -> N

idN : N -> N
idN n = {! !}
`
  const view = document.querySelector(".cm-content")?.cmTile?.view
  if (!view) return { ok: false, error: "missing CodeMirror view" }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: source },
    selection: { anchor: source.indexOf("{! !}") + 3 },
  })
  view.focus()
  return { ok: true, text: view.state.doc.toString() }
})()'
```

Do not use `document.execCommand()` or direct `.cm-content` DOM mutation for tests. Direct DOM mutation can corrupt CodeMirror widgets and make goal marker text appear in the editor content.

## Cubical Regression Workflow

Use this after changes to startup, worker drive setup, static assets, or load behavior.

Test source:

```agda
{-# OPTIONS --cubical --guardedness #-}

open import Cubical.Foundations.Prelude
```

Expected result:

- Load finishes without library lookup errors.
- No `module not found` error for `Cubical.Foundations.Prelude`.

Also test standard library still works:

```agda
open import Data.Nat.Base
```

`Data.Nat` can be used as a heavier manual check, but it is too slow for the
regular browser regression script.

## Commit Workflow

Before committing:

```sh
git status --short
source /usr/share/nvm/init-nvm.sh && npm run check
source /usr/share/nvm/init-nvm.sh && npm run build
```

Use a focused commit message:

```sh
git commit -m "Extract Agda command builders"
```

Do not push unless explicitly requested.

## Known Build Warnings

`npm run build` currently emits Rollup circular dependency and chunk size warnings. These are known warnings. Treat them as failures only if new runtime behavior breaks or the warning text materially changes.
