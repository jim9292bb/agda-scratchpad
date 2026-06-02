# CODEX_WORKFLOWS.md

## Purpose

This file documents repeatable Codex workflows for this repository. Use it together with `AGENTS.md` and `AGDA_MODE_VSCODE_TODO.md`.

`AGENTS.md` defines rules. `AGDA_MODE_VSCODE_TODO.md` defines the roadmap. This file defines how to execute common tasks.

## Default Development Workflow

1. Read `AGENTS.md`.
2. Read the relevant section of `AGDA_MODE_VSCODE_TODO.md`.
3. Search existing implementation before editing:
   ```sh
   rg "Cmd_|runAgdaShortcut|handleAgdaChord|InteractionPoints|GiveAction|MakeCase" src
   ```
4. Make the smallest coherent change.
5. Run:
   ```sh
   npm run check
   npm run build
   ```
6. For editor, shortcut, goal, or browser behavior changes, run an `agent-browser` regression.
7. Summarize changed files, tests, and residual risk.
8. Commit only when requested. Never push unless explicitly requested.

## Phase 2 Command Refactor Workflow

Use this when working on Core Agda Commands.

Goal: move command construction out of `src/routes/+page.svelte` without changing behavior.

Recommended steps:

1. Inspect current inline command strings in `src/routes/+page.svelte`.
2. Add or update a reusable command module, for example `src/lib/agda/commands.js`.
3. Move command string construction into named functions.
4. Keep shortcut key handling in `+page.svelte` until command construction is fully extracted.
5. Preserve existing labels, logs, pending goal behavior, and error messages.
6. Run `npm run check` and `npm run build`.
7. Browser-test at least Load, Give, Case split, and Refine.

Do not implement new shortcuts in the same commit as the extraction unless explicitly requested.

## Browser Regression Workflow

Use `agent-browser` for any CodeMirror, shortcut, or goal lifecycle change.

Start the dev server:

```sh
npm run dev -- --host 0.0.0.0 --force
```

Open the app in the browser and test this Agda source:

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
npm run check
npm run build
```

Use a focused commit message:

```sh
git commit -m "Extract Agda command builders"
```

Do not push unless explicitly requested.

## Known Build Warnings

`npm run build` currently emits Rollup circular dependency and chunk size warnings. These are known warnings. Treat them as failures only if new runtime behavior breaks or the warning text materially changes.
