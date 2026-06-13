# AGENTS.md

## Project Goal

This project is a browser-hosted single-file Agda scratchpad for demonstration,
learning, and practice. Its positioning is close to the JSCoq scratchpad:
focused interaction with one source buffer, not project-oriented development.

For a new development session, read `DEVELOPMENT_HANDOFF.md` first. It records
the current branch direction, runtime evidence, immediate next task, and later
work.

Use `PROJECT_GOAL.md` as the source of truth for product positioning.

Follow `ROADMAP.md` as the source of truth for planned work and progress.
Use `CODEX_WORKFLOWS.md` for repeatable development, browser regression, Cubical regression, and commit workflows.

## Development Rules

- Do not push unless explicitly requested.
- Prefer small commits after each completed phase or self-contained feature.
- Preserve the single-file scratchpad model. Do not add multi-file editing,
  file explorers, or project management features unless the project goal changes
  explicitly.
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
- In this workspace, load Node tools with `source /usr/share/nvm/init-nvm.sh` before running `npm` or `agent-browser`.
- Browser tests should edit CodeMirror with `EditorView.dispatch()`, not direct `contenteditable` DOM mutation.

## Codex Tooling

- Use `agent-browser` as the primary browser verification tool for UI, editor,
  shortcut, goal lifecycle, and panel behavior changes.
- Use `context7` for current Svelte, Vite, CodeMirror, and other library
  documentation when API details or version behavior matter.
- Use OpenAI docs MCP for OpenAI API, Codex, or OpenAI product documentation.
- Use the GitHub plugin for repository metadata, issues, pull requests, and CI
  inspection when working with GitHub state. Do not let it replace local
  `git status`, `git diff`, `npm run check`, or `npm run build`.
- Canva is not part of normal development for this repository. Use it only if a
  future task explicitly asks for presentation, teaching, or visual assets.

## Superpowers

`obra/superpowers` is treated as a lightweight agent-side methodology reference,
not as a runtime dependency or a mandatory workflow for this repository.

Apply the parts that fit this project:

- Clarify intent and write a decision-complete plan before large or ambiguous
  changes.
- Prefer spec-first and plan-first work for new features or risky refactors.
- Use systematic debugging for complex failures instead of speculative edits.
- Verify before reporting completion, using the project-specific checks in
  `CODEX_WORKFLOWS.md`.

Do not make Superpowers-specific worktrees, subagents, or strict TDD mandatory
unless the user explicitly asks for that workflow.

## Important Files

- `ROADMAP.md`: feature plan and progress.
- `DEVELOPMENT_HANDOFF.md`: current development handoff for new Codex sessions.
- `PROJECT_GOAL.md`: product positioning and scope boundaries.
- `CODEX_WORKFLOWS.md`: repeatable Codex workflows and regression checklists.
- `docs/AGDA_MODE_VSCODE_MAPPING.md`: researched shortcut and `Cmd_*` mappings from `agda-mode-vscode`.
- `test-fixtures/agda/`: reusable Agda snippets for browser and load regressions.
- `scripts/browser-test-*.sh`: reusable `agent-browser` regressions.
- `src/lib/agda/goal-state.js`: centralized goal state.
- `src/lib/agda/goals.js`: goal decorations and interaction point handling.
- `src/lib/agda/shortcut-context.js`: shortcut goal lookup and fallback logic.
- `src/lib/agda/editor-mutations.js`: editor mutations after Agda responses.
- `src/lib/agda/handlers.js`: ALS response handling.
- `src/routes/+page.svelte`: UI wiring and editor setup.

## Reference Repositories

Reference repositories live outside this repo at `../references/`.

Use them for research only. Do not edit or commit changes inside reference repositories unless explicitly requested.

Useful references:

- `../references/agda-mode-vscode`: primary source for VSCode Agda mode behavior.
- `../references/cubical`: Cubical Agda library layout and compatibility.
- `../references/agda`: upstream Agda implementation and interaction commands.
- `../references/agda-stdlib`: standard library layout.
- `../references/agda-web-agda`: Agda WASM patch source.
- `../references/agda-web-agda-language-server`: ALS reference.
- `../references/agda-web-agda-wasm-dist`: WASM distribution reference.
- `../references/agda-web-browser_wasi_shim`: browser WASI reference.
- `../references/agda-web-agda-input`: Agda Unicode input reference.
- `../references/vscode-als-wasm-loader`: VSCode web ALS/WASM loading reference.

## Verification

After code changes, run:

```sh
source /usr/share/nvm/init-nvm.sh && npm run check
source /usr/share/nvm/init-nvm.sh && npm run build
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

Current positioning: build a continuously improving single-file Agda scratchpad
IDE for demonstrations, learning, and practice.

Cubical Agda support is implemented and should be preserved as part of the
scratchpad runtime environment.

The roadmap in `ROADMAP.md` is product-oriented rather than a
VSCode porting checklist. Runtime support, goal lifecycle, core practice
commands, goal queries, and Goals panel/navigation are substantially complete,
with remaining browser regression coverage tracked in the TODO.

Current branch: `agda-scratchpad`. The `browser-wasi-shim-memfs` runtime
backend is fully integrated as the default. See `DEVELOPMENT_HANDOFF.md` for
current state and next tasks.

Next priorities: Diagnostics and Output Panel interaction, structured
Queries/Warnings views, Unicode input method browser regressions and prompt
integration, and then normalization variants. These improve the single-file
learning workflow without expanding into project management.

For larger feature work, use the Superpowers-inspired workflows in
`CODEX_WORKFLOWS.md`: clarify the intended learner workflow, write a concise
plan, change one coherent layer at a time, and verify with the matching
browser regression before reporting completion.

Before adding command behavior, inspect existing `Cmd_*` usage and prefer adding command builders in `src/lib/agda/commands.js` instead of duplicating request strings in `src/routes/+page.svelte`.

## Known Warnings

`npm run build` currently emits existing Rollup circular dependency and chunk size warnings. Do not treat them as new failures unless they change or runtime behavior breaks.
