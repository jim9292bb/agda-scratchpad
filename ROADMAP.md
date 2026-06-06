# Agda Scratchpad IDE Roadmap

This roadmap tracks work for a browser-hosted, single-file Agda IDE for
teaching, demonstrations, and practice. The product positioning is close to the
JSCoq scratchpad: focused interaction with one source buffer, not development of
a multi-file Agda project.

`banacorn/agda-mode-vscode` is a reference for Agda interaction behavior,
shortcut semantics, and request/response handling. It is not the product
roadmap, and this project does not aim for complete VSCode parity.

Use `PROJECT_GOAL.md` for product scope and `docs/AGDA_MODE_VSCODE_MAPPING.md`
for researched Agda command mappings.

## Scope Boundaries

- [x] Preserve the single-file scratchpad model backed by `/source.agda`.
- [x] Treat Cubical Agda and the standard library as preloaded runtime assets, not as project-management features.
- [ ] Do not add multi-file editing.
- [ ] Do not add a file explorer.
- [ ] Do not add package manager UI.
- [ ] Do not add project/workspace configuration UI.
- [ ] Do not port Agda executable download or version switching unless multiple WASM runtimes are intentionally supported.
- [ ] Do not port VSCode-specific Markdown preview or editor-workspace keybindings.

## Runtime and Library Support

Goal: examples should load reliably in a browser without local Agda installation.

- [x] Load ALS/Agda `2.8.0` from WASM.
- [x] Preserve existing standard-library behavior.
- [x] Add Cubical Agda `v0.9` as a static runtime asset.
- [x] Extract Cubical into the virtual filesystem at startup.
- [x] Register Cubical in Agda library configuration.
- [x] Set the default source to a minimal Cubical example.
- [x] Show Cubical `v0.9` in startup configuration.
- [x] Add a scripted Cubical regression that loads `Cubical.Foundations.Prelude`.
- [x] Add a scripted standard-library regression that loads `Data.Nat.Base`.
- [x] Show a read-only runtime summary for Agda, ALS, stdlib, and Cubical versions.

## Runtime and Library Performance

Goal: make ALS/WASM startup and library loading measurable before changing the
runtime architecture.

- [x] Add timing instrumentation for WASM response fetch, ALS worker initialization, library zip fetch, library extraction, Agda setup, source sync, `Cmd_load`, and token highlighting.
- [x] Add drive proxy call and byte counters around Agda load commands.
- [x] Add drive proxy method timing, top path, and `.agda` / `.agdai` profiling around `Cmd_load`.
- [x] Show collected performance timings in the runtime/info panel.
- [x] Browser-test that startup and library preparation timings are visible.
- [ ] Evaluate pathStat-heavy lookup optimization in the WASI drive proxy.
- [ ] Evaluate persistent IndexedDB caching for extracted stdlib and Cubical files.
- [ ] Evaluate lazy library extraction instead of eager JSZip inflation.
- [ ] Evaluate prebuilt `.agdai` interface caches for selected teaching examples.
- [ ] Evaluate direct in-memory FS or memfs-style architecture experiments against Runno drive proxy overhead.

## Goal Lifecycle and Editor State

Goal: Agda goals should remain correct after load, edits, case split, give,
refine, auto, and asynchronous ALS responses.

- [x] Create a centralized goal state module.
- [x] Track each goal by Agda interaction point id.
- [x] Store each goal's outer range, inner range, input, and document version.
- [x] Map CodeMirror offsets to Agda UTF-8 ranges through one shared utility.
- [x] Update goal ranges after every CodeMirror document transaction.
- [x] Reject or rebase async Agda responses when the document version is stale.
- [x] Rebuild goal ids from Agda `InteractionPoints` after `Load`.
- [x] Merge existing and newly generated goals after `Give` and `Refine`.
- [x] Remove goal boundaries after successful `Give`.
- [x] Add defensive handling for damaged or partially edited goal boundaries.
- [x] Verify `Load` updates highlighting, diagnostics, warnings, and goals after the goal-state refactor.
- [x] Add browser regression coverage for damaged or partially edited goal boundaries.

## Core Practice Commands

Goal: common Agda exercise workflows should work from the editor with familiar
Agda shortcuts.

- [x] Keep `C-c C-l` wired to `Cmd_load`.
- [x] Wire `C-c C-Space` Give using `Cmd_give WithoutForce goalId range content`.
- [x] Wire `C-c C-c` Case split using `Cmd_make_case goalId range content`.
- [x] After Case split, replace the old goal with returned clauses and immediately reload.
- [x] Wire `C-c C-r` Refine using `Cmd_refine_or_intro False goalId range content`.
- [x] Replace provisional Auto behavior with real `Cmd_autoOne normalization goalId range content`.
- [x] Implement `C-c C-m` Elaborate and give using `Cmd_elaborate_give`.
- [x] Implement `C-c C-h` Helper function type using `Cmd_helper_function`.
- [x] Show a clear error when a command requires content but the current goal is empty.
- [x] Show a clear error when the cursor is not inside a goal.
- [x] Extract core command construction into `src/lib/agda/commands.js`.
- [x] Browser-test Load, Give, Case split, Refine, Auto, Elaborate and give, and Helper function type with `agent-browser` scripts.

## Goal Queries and Exploration

Goal: learners should be able to inspect goal type, context, inferred types,
normal forms, scope, and module contents without leaving the scratchpad.

- [x] Implement `C-c C-t` Goal type using `Cmd_goal_type`.
- [x] Implement `C-c C-e` Context using `Cmd_context`.
- [x] Wire `C-c C-,` Goal type and context using `Cmd_goal_type_context`.
- [x] Wire `C-c C-.` Goal type, context, and inferred type using `Cmd_goal_type_context_infer`.
- [x] Align `C-c C-,` and `C-c C-.` semantics with `agda-mode-vscode` naming and expected output.
- [x] Implement `C-c C-;` Goal type, context, and checked type using `Cmd_goal_type_context_check`.
- [x] Wire `C-c C-d` Infer type using `Cmd_infer`.
- [x] Wire `C-c C-n` Compute normal form using `Cmd_compute`.
- [x] Implement `C-c C-z` Search about using `Cmd_search_about_toplevel`.
- [x] Implement `C-c C-o` Module contents using `Cmd_show_module_contents`.
- [x] Implement `C-c C-w` Why in scope using `Cmd_why_in_scope`.
- [x] Extract query command construction into `src/lib/agda/commands.js`.
- [ ] Move query results from the raw log into a structured Queries panel.
- [ ] Render query results without losing Agda formatting.
- [ ] Browser-test query shortcuts with reusable fixtures.

## Goals Panel and Navigation

Goal: the Goals panel should be the main practice aid for single-file proof and
program construction.

- [x] Show current goals below the editor.
- [x] Make Goals panel entries clickable.
- [x] Move the editor cursor into the selected goal when a goal is clicked.
- [x] Add Next goal command.
- [x] Add Previous goal command.
- [x] Show goal ids in the editor as CodeMirror decorations.
- [x] Highlight the active goal.
- [x] Keep the Goals panel synchronized after edits, Load, Give, Refine, and Case split.
- [x] Display goal type and context for the active goal.
- [x] Add a browser regression for active goal type/context display.
- [ ] Consider a compact mode for examples with many goals.

## Command Input Panel

Goal: when a command needs text and the active goal is empty, users should be
able to type the required content in a panel, similar to the useful parts of
`agda-mode-vscode`'s goal input workflow.

- [x] Add a panel prompt for commands that require input when the active goal is empty.
- [x] Use the prompt result as command content for Case split, Give, Refine, Elaborate and give, Helper function type, Infer, Compute, Search, Module contents, Why in scope, and checked-type queries.
- [x] Allow cancelling the prompt without sending an Agda command.
- [x] Restore editor focus after prompt submit or cancel.
- [ ] Support Agda Unicode input method inside the prompt after the Unicode input method exists.
- [x] Add browser regressions for prompt submit, cancel, and focus restore.

## Shortcut Configuration

Goal: Agda shortcuts should work for learners by default, while still allowing
users to replace bindings that conflict with their browser, operating system, or
keyboard layout.

- [x] Centralize shortcut definitions in a data-driven registry instead of scattering hard-coded key checks through UI event handlers.
- [x] Keep the default bindings aligned with familiar Agda mode shortcuts where practical.
- [x] Add a floating Settings dialog with a shortcut settings section.
- [x] Add a lightweight shortcut settings UI for replacing command bindings.
- [x] Validate replacement bindings and warn about duplicate Agda command shortcuts.
- [x] Persist shortcut overrides in browser local storage.
- [x] Add a reset-to-default-shortcuts action.
- [x] Make shortcut help render from the same registry used by the dispatcher.
- [x] Add a collapsible, scrollable Commands panel rendered from the shortcut registry.
- [x] Browser-test overridden shortcuts for representative command classes.
- [x] Browser-test an overridden Load shortcut.
- [x] Browser-test an overridden goal command shortcut.
- [x] Browser-test an overridden query command shortcut.

## Diagnostics and Output Panels

Goal: errors, warnings, logs, and query results should be readable for learners
and not buried in raw transport output.

- [x] Parse Agda errors into structured diagnostics.
- [x] Show file, line, and column for errors.
- [x] Allow clicking an error to jump to its source position.
- [x] Handle `JumpToError` responses by moving the editor cursor to the reported position.
- [x] Add a Messages panel with switchable Log and Errors views.
- [ ] Separate output into Log, Goals, Queries, Warnings, and Errors.
- [ ] Preserve raw Agda output behind a debug view.
- [ ] Add an internal debug panel for request/response tracing.
- [x] Add teaching-oriented examples for syntax errors and semantic errors.

## Unicode Input Method

Goal: learners should be able to type Agda symbols in the browser without an
external editor setup.

- [ ] Add Agda input method triggered by backslash.
- [ ] Use `../references/agda-web-agda-input` as the primary browser-compatible reference.
- [ ] Provide CodeMirror completion candidates for Agda symbols.
- [ ] Support selecting candidates with keyboard navigation.
- [ ] Replace the input sequence with the chosen Unicode symbol.
- [ ] Add a lookup command similar to `C-x C-=`.
- [ ] Ensure Agda shortcuts still have priority while the editor is focused.

## Normalization and Command Variants

Goal: expose useful Agda command variants without copying VSCode's exact prefix
UI when it does not fit the browser scratchpad.

- [ ] Support AsIs normalization.
- [ ] Support Simplified normalization.
- [ ] Support Instantiated normalization where supported.
- [ ] Support Normalised normalization.
- [ ] Support HeadNormal normalization.
- [ ] Add a browser-friendly alternative to VSCode's `C-u` prefix flow.
- [ ] Apply normalization variants to Goal type, Context, Auto, Compute, Search, and Constraints.

## Constraints and Metas

Goal: expose constraints and metas only where they help learning and debugging
single-file exercises.

- [ ] Implement Show constraints using `Cmd_constraints`.
- [ ] Implement Solve one constraint using `Cmd_solveOne`.
- [ ] Implement Solve all constraints using `Cmd_solveAll`.
- [ ] Implement Show goals/metas using `Cmd_metas`.
- [ ] Display constraints in a structured panel.
- [ ] Handle Agda version differences in command syntax.

## Scratchpad UX and Teaching Examples

Goal: the default experience should support demos and short practice sessions.

- [x] Add a small example picker for built-in single-file examples.
- [x] Move the example picker into the editor header as a compact selector.
- [x] Include examples for natural numbers, case split, auto, refine, queries, Cubical import, and standard-library import.
- [x] Keep examples as single buffers, not as multi-file projects.
- [x] Apply selected examples immediately without a separate example load or reset button.
- [ ] Keep debug output hidden by default.
- [ ] Make shortcut help easier to scan for beginners.

## Browser Regression Suite

Goal: common scratchpad workflows should be repeatable by Codex and humans.

- [x] Add reusable Agda fixtures under `test-fixtures/agda/`.
- [x] Add shared `agent-browser` helper functions.
- [x] Add browser regression script for goal lifecycle basics.
- [x] Add browser regression script for damaged or partially edited goal boundaries.
- [x] Add browser regression script for Load state refresh across highlighting, diagnostics, warnings, and goals.
- [x] Add browser regression script for the collapsible Commands panel.
- [x] Add browser regression script for the Settings dialog shell.
- [x] Add browser regression script for Auto.
- [x] Add browser regression script for query shortcuts.
- [x] Add browser regression script for command input panel submit, cancel, and focus restore.
- [x] Add browser regression script for active Goals panel details.
- [x] Add browser regression script for Cubical load.
- [x] Add browser regression script for standard-library load.
- [x] Add browser regression script for syntax and semantic error display.
- [x] Expose browser regressions through `package.json` scripts where practical.

## Codex Workflow and Methodology

Goal: keep Codex-assisted development predictable without making the repository
depend on agent-specific tooling.

- [x] Document plugin and MCP usage for this workspace.
- [x] Document lightweight Superpowers-inspired development practices.
- [x] Add spec-first, systematic debugging, verification, and review checklists.
- [ ] Keep workflow documentation synchronized when new browser regressions or
      major development phases are added.

## Implementation Notes

- Prioritize single-file learning workflows over project-oriented IDE features.
- Prioritize goal lifecycle correctness before adding more shortcuts.
- Treat `InteractionPoints` as the source of truth for Agda goal ids.
- Treat CodeMirror document changes as the source of truth for current ranges.
- Always reload after Case split so new holes receive real Agda interaction point ids.
- Avoid command-specific hacks that search raw `{! !}` text without consulting goal state.
- Route all keyboard shortcuts through the shortcut registry once shortcut configuration exists.
- Keep request construction separate from UI event handling.
- Keep response handling separate from editor mutation.
- Use `agda-mode-vscode` as an interaction reference, not as a parity checklist.
- Include browser tests for any editor, shortcut, goal, or panel behavior change.

## References

- `PROJECT_GOAL.md`
- `docs/AGDA_MODE_VSCODE_MAPPING.md`
- https://coq.vercel.app/scratchpad.html
- https://github.com/banacorn/agda-mode-vscode/blob/master/package.json
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/Request.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/Goals.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/State/State__Command.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/State/State__Response.res
