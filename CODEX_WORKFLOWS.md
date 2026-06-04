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

Prefer the scripted regressions first:

```sh
scripts/browser-test-goal-lifecycle.sh
scripts/browser-test-auto.sh
scripts/browser-test-query-shortcuts.sh
```

Run the scripts with a dev server already running:

Start the dev server:

```sh
source /usr/share/nvm/init-nvm.sh && npm run dev -- --host 0.0.0.0 --force
```

Open the app:

```sh
source /usr/share/nvm/init-nvm.sh && XDG_RUNTIME_DIR=/tmp/agent-browser-runtime agent-browser open http://127.0.0.1:8099/
```

If `agent-browser` fails with a daemon socket, bind, or read-only filesystem error inside the sandbox, rerun the browser command with escalated execution. The browser daemon needs to create sockets outside the restricted sandbox.

Use fixtures from `test-fixtures/agda/` instead of rewriting Agda snippets in prompts whenever possible:

- `plus-case-split.agda`: Load, case split, and give lifecycle.
- `idN-auto.agda`: Auto fills a simple identity function.
- `idN-elaborate.agda`: Elaborate and give fills a simple identity function.
- `query-goal.agda`: Goal query fixture.
- `query-bool.agda`: Search/module/why-in-scope query fixture.
- `cubical-prelude.agda`: Cubical load regression.
- `stdlib-nat.agda`: standard-library load regression.

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
open import Data.Nat
```

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
