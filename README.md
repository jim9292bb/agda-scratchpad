# Agda Scratchpad

A browser-hosted, single-file Agda scratchpad for demonstrations, learning, and
practice.

The project is positioned close to the JSCoq scratchpad: open a browser, write
or paste a small Agda example, load it with Agda/ALS, and interact with goals,
context, commands, and diagnostics without setting up a local Agda project.

## Scope

This is intentionally not a full project-oriented IDE.

In scope:

- one source buffer backed by `/source.agda`;
- Agda/ALS interaction in the browser;
- Cubical Agda and standard-library examples;
- goal display, context display, and Agda practice shortcuts;
- browser-friendly teaching and exercise workflows.

Out of scope:

- multi-file editing;
- file explorers;
- package manager UI;
- project/workspace configuration UI;
- full VSCode feature parity.

See `PROJECT_GOAL.md` for the full product positioning.

## Development

This workspace uses `nvm`; load Node before running project commands:

```sh
source /usr/share/nvm/init-nvm.sh
npm run check
npm run build
```

For roadmap and agent workflow details, see:

- `PROJECT_GOAL.md`
- `ROADMAP.md`
- `AGENTS.md`
- `CODEX_WORKFLOWS.md`

