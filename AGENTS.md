# AGENTS.md

## Project Goal

This project is a browser-hosted Agda/ALS demo. The current development goal is to support Cubical Agda and port suitable browser-compatible features from `banacorn/agda-mode-vscode`.

Follow `AGDA_MODE_VSCODE_TODO.md` as the source of truth for planned work and progress.
Use `CODEX_WORKFLOWS.md` for repeatable development, browser regression, Cubical regression, and commit workflows.

## Development Rules

- Do not push unless explicitly requested.
- Prefer small commits after each completed phase or self-contained feature.
- Preserve Cubical Agda support and existing standard-library behavior.
- Prioritize Agda goal lifecycle correctness over adding new shortcuts.
- Treat Agda interaction point ids as the source of truth for goals.
- Do not rely on raw `{! !}` text scanning except as a fallback.
- Keep request construction separate from UI event handling.
- Keep response handling separate from editor mutation.
- Keep UI/layout changes minimal unless explicitly requested.
- Before implementing a TODO item, search the current codebase first; some shortcuts may already be wired inline.
- Do not duplicate existing `Cmd_*` shortcut handling in `src/routes/+page.svelte`; extract or refactor it instead.
- Treat unchecked TODO items as planning state, not proof that no implementation exists.
- For common development, testing, browser regression, and commit flows, follow `CODEX_WORKFLOWS.md`.

## Important Files

- `AGDA_MODE_VSCODE_TODO.md`: feature plan and progress.
- `CODEX_WORKFLOWS.md`: repeatable Codex workflows and regression checklists.
- `src/lib/agda/goal-state.js`: centralized goal state.
- `src/lib/agda/goals.js`: goal decorations and interaction point handling.
- `src/lib/agda/shortcut-context.js`: shortcut goal lookup and fallback logic.
- `src/lib/agda/editor-mutations.js`: editor mutations after Agda responses.
- `src/lib/agda/handlers.js`: ALS response handling.
- `src/routes/+page.svelte`: UI wiring and editor setup.

## Verification

After code changes, run:

```sh
npm run check
npm run build
```

For editor, shortcut, goal, or browser behavior changes, also verify with `agent-browser`.

Test shortcut flows with examples such as:

```agda
data N : Set where
  z : N
  s : N -> N

_+_ : N -> N -> N
a + b = ?
```

Verify `C-c C-l`, `C-c C-c`, and `C-c C-Space` preserve valid goals and update the editor correctly.

## Current Status

Phase 1 in `AGDA_MODE_VSCODE_TODO.md` is complete.

Next priority: Phase 2, Core Agda Commands.

Some Phase 2 and Phase 3 shortcut commands are already wired inline in `src/routes/+page.svelte`. Before adding command behavior, inspect existing `Cmd_*` usage and prefer extracting it into reusable modules.

## Known Warnings

`npm run build` currently emits existing Rollup circular dependency and chunk size warnings. Do not treat them as new failures unless they change or runtime behavior breaks.
