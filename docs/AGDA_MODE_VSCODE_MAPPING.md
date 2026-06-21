# agda-mode-vscode Mapping

This document records the `banacorn/agda-mode-vscode` behavior already researched
for this browser-hosted single-file Agda playground IDE. Use it before searching
`../references/`.

## References

- `../references/agda-mode-vscode/package.json`: keybindings.
- `../references/agda-mode-vscode/src/Request.res`: Agda request encoding.
- `../references/agda-mode-vscode/src/State/State__Command.res`: command input and fallback behavior.
- `../references/agda-mode-vscode/test/tests`: behavior fixtures and expected responses.

## Core Commands

| Shortcut | agda-mode-vscode command | Browser command |
| --- | --- | --- |
| `C-c C-l` | Load | `Cmd_load` through ALS load flow |
| `C-c C-Space` | Give | `Cmd_give WithoutForce goalId range content` |
| `C-c C-c` | Case split | `Cmd_make_case goalId range content` |
| `C-c C-r` | Refine | `Cmd_refine_or_intro False goalId range content` |
| `C-c C-a` | Auto `[AsIs]` | `Cmd_autoOne AsIs goalId range content` |
| `C-c C-m` | Elaborate and give `[Simplified]` | `Cmd_elaborate_give Simplified goalId noRange content` |
| `C-c C-h` | Helper function type `[AsIs]` | `Cmd_helper_function AsIs goalId noRange content` |
| `C-c C-f` | Next goal | browser-side focus next goal |
| `C-c C-b` | Previous goal | browser-side focus previous goal |

## Query Commands

| Shortcut | agda-mode-vscode command | Browser command |
| --- | --- | --- |
| `C-c C-t` | Goal type `[Simplified]` | `Cmd_goal_type Simplified goalId noRange ""` |
| `C-c C-e` | Context `[Simplified]` | `Cmd_context Simplified goalId noRange ""` |
| `C-c C-,` | Goal type and context `[Simplified]` | `Cmd_goal_type_context Simplified goalId noRange ""` |
| `C-c C-.` | Goal type, context, inferred type `[Simplified]` | `Cmd_goal_type_context_infer Simplified goalId noRange content` |
| `C-c C-;` | Goal type, context, checked type `[Simplified]` | `Cmd_goal_type_context_check Simplified goalId noRange content` |
| `C-c C-d` | Infer type `[Normalised]` | `Cmd_infer Normalised goalId noRange content` |
| `C-c C-n` | Compute normal form | `Cmd_compute DefaultCompute goalId noRange content` |
| `C-c C-z` | Search about `[Simplified]` | `Cmd_search_about_toplevel Simplified content` |
| `C-c C-o` | Module contents `[Simplified]` | `Cmd_show_module_contents Simplified goalId noRange content` or top-level variant |
| `C-c C-w` | Why in scope | `Cmd_why_in_scope goalId noRange content` or top-level variant |

## Important Behavior

- `C-c C-.` falls back to `Cmd_goal_type_context` when the active goal content is empty.
- Commands that need content use the command input panel when the active goal or selection is empty.
- `C-c C-z` is naturally prompt-based in agda-mode-vscode. In this playground, it uses selected text or the command input panel.
- `C-c C-o` and `C-c C-w` support top-level selected text when the cursor is not inside a goal.
- `C-u` normalization prefix variants are not implemented yet; they are tracked in the roadmap.
- Always keep command string construction in `src/lib/agda/commands.js`.
- Keep shortcut definitions in `src/lib/agda/shortcuts.js`; UI code should dispatch by shortcut id rather than hard-coded key branches.

## Browser Constraints

- Use CodeMirror `EditorView.dispatch()` for automated tests.
- Do not use `document.execCommand()` or direct `.cm-content` mutation; it can corrupt widgets and insert goal marker text into editable content.
- Run browser tests through `scripts/browser-test-*.sh` where possible.
