# agda-mode-vscode Porting TODO

This TODO tracks features from `banacorn/agda-mode-vscode` that are suitable for
this browser-hosted ALS demo.

References:

- https://github.com/banacorn/agda-mode-vscode/blob/master/package.json
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/Request.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/Goals.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/State/State__Command.res
- https://github.com/banacorn/agda-mode-vscode/blob/master/src/State/State__Response.res

## Phase 1: Goal Lifecycle Foundation

- [x] Create a centralized goal state module.
- [x] Track each goal by Agda interaction point id.
- [x] Store each goal's outer range, inner range, and document version.
- [x] Map CodeMirror offsets to Agda UTF-8 ranges through one shared utility.
- [x] Update goal ranges after every CodeMirror document transaction.
- [x] Reject or rebase async Agda responses when the document version is stale.
- [x] Rebuild goal ids from Agda `InteractionPoints` after `Load`.
- [x] Merge existing and newly generated goals after `Give` and `Refine`.
- [x] Remove goal boundaries after successful `Give`.
- [x] Add defensive handling for damaged or partially edited goal boundaries.

## Phase 2: Core Agda Commands

- [x] Keep `C-c C-l` wired to `Cmd_load`.
- [ ] Verify `Load` updates highlighting, diagnostics, warnings, and goals after the Phase 1 goal-state refactor.
- [x] Wire `C-c C-Space` Give using `Cmd_give WithoutForce goalId range content`.
- [x] Wire `C-c C-c` Case split using `Cmd_make_case goalId range content`.
- [x] After Case split, replace the old goal with returned clauses and immediately reload.
- [x] Wire `C-c C-r` Refine using `Cmd_refine_or_intro False goalId range content`.
- [x] Replace the current `C-c C-a` provisional refine behavior with real Auto using `Cmd_autoOne normalization goalId range content`.
- [x] Implement `C-c C-m` Elaborate and give using `Cmd_elaborate_give`.
- [x] Implement `C-c C-h` Helper function type using `Cmd_helper_function`.
- [x] Show a clear error when a command requires content but the current goal is empty.
- [x] Show a clear error when the cursor is not inside a goal.
- [x] Extract core command construction from `src/routes/+page.svelte` into a reusable Agda command module.
- [ ] Browser-test Load, Give, Case split, Refine, and Auto with `agent-browser`.

## Phase 3: Goal Queries

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
- [x] Extract query command construction from `src/routes/+page.svelte` into a reusable Agda command module.

## Phase 4: Goal Navigation and Display

- [ ] Add Next goal command.
- [ ] Add Previous goal command.
- [ ] Make the Goals panel entries clickable.
- [ ] Move the editor cursor into the selected goal when a goal is clicked.
- [ ] Show goal ids in the editor as CodeMirror decorations.
- [ ] Highlight the active goal.
- [ ] Keep the Goals panel synchronized after edits, Load, Give, Refine, and Case split.
- [ ] Display goal type and context for the active goal.

## Phase 5: Panel and Diagnostics

- [ ] Add a panel prompt for commands that require input when the active goal is empty.
- [ ] Use the prompt result as command content for Case split, Give, Refine, Auto, Elaborate and give, Helper function type, Infer, Compute, and related query commands.
- [ ] Allow cancelling the prompt without sending an Agda command.
- [ ] Restore editor focus after prompt submit or cancel.
- [ ] Support Agda Unicode input method inside the prompt after Phase 6 input method exists.
- [ ] Parse Agda errors into structured diagnostics.
- [ ] Show file, line, and column for errors.
- [ ] Allow clicking an error to jump to its source position.
- [ ] Separate output into Log, Goals, Queries, Warnings, and Errors.
- [ ] Render query results without losing Agda formatting.
- [ ] Preserve raw Agda output behind a debug view.
- [ ] Add an internal debug panel for request/response tracing.

## Phase 6: Unicode Input Method

- [ ] Add Agda input method triggered by backslash.
- [ ] Provide CodeMirror completion candidates for Agda symbols.
- [ ] Support selecting candidates with keyboard navigation.
- [ ] Replace the input sequence with the chosen Unicode symbol.
- [ ] Add a lookup command similar to `C-x C-=`.
- [ ] Ensure Agda shortcuts still have priority while the editor is focused.

## Phase 7: Normalization Prefix Variants

- [ ] Support AsIs normalization.
- [ ] Support Simplified normalization.
- [ ] Support Instantiated normalization where supported.
- [ ] Support Normalised normalization.
- [ ] Support HeadNormal normalization.
- [ ] Add a browser-friendly alternative to VSCode's `C-u` prefix flow.
- [ ] Apply normalization variants to Goal type, Context, Auto, Compute, Search, and Constraints.

## Phase 8: Constraints and Metas

- [ ] Implement Show constraints using `Cmd_constraints`.
- [ ] Implement Solve one constraint using `Cmd_solveOne`.
- [ ] Implement Solve all constraints using `Cmd_solveAll`.
- [ ] Implement Show goals/metas using `Cmd_metas`.
- [ ] Display constraints in a structured panel.
- [ ] Handle Agda version differences in command syntax.

## Phase 9: Optional or Browser-Specific Features

- [ ] Add a read-only display for current Agda/ALS runtime version.
- [ ] Add a browser debug log for ALS transport messages.
- [ ] Consider an experimental Compile button only if the WASM runtime supports it.
- [ ] Do not port Agda executable download or version switching unless multiple WASM runtimes are available.
- [ ] Do not port VSCode-specific Markdown preview keybindings.

## Implementation Notes

- Prioritize goal lifecycle correctness before adding more shortcuts.
- Treat `InteractionPoints` as the source of truth for Agda goal ids.
- Treat CodeMirror document changes as the source of truth for current ranges.
- Always reload after Case split so new holes receive real Agda interaction point ids.
- Avoid command-specific hacks that search raw `{! !}` text without consulting goal state.
- Keep request construction separate from UI event handling.
- Keep response handling separate from editor mutation.
- Include browser tests for Give, Case split, Refine, Auto, and goal navigation.
