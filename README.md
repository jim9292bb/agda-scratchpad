# Agda Scratchpad

A browser-hosted, single-file Agda scratchpad for demonstrations, learning, and
practice.

Forked from [agda-web/als-demo](https://github.com/agda-web/als-demo).

The project is positioned close to the [JSCoq scratchpad](https://coq.vercel.app/scratchpad.html): open a browser, write
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

### First-time setup

Download the ALS WASM binaries and library archives:

```sh
npm run setup
```

### Common commands

```sh
npm run check       # type-check
npm run build       # production build
npm run dev         # dev server (http://localhost:8099)
npm run test        # unit tests (Vitest)
```

### Browser regression tests

A dev server must be running before executing browser tests:

```sh
npm run dev -- --host 0.0.0.0 --force
```

Then in another terminal:

```sh
npm run test:browser                    # full suite
npm run test:browser:core-commands      # targeted
```

For roadmap details, see `PROJECT_GOAL.md` and `ROADMAP.md`.

## Related projects

- [agda-web/als-demo](https://github.com/agda-web/als-demo) — upstream project this is forked from
- [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server) — source of the ALS WASM binaries downloaded by `npm run setup`
- [banacorn/agda-mode-vscode](https://github.com/banacorn/agda-mode-vscode) — reference for Agda interaction commands and shortcut behavior
- [agda-web/browser_wasi_shim](https://github.com/agda-web/browser_wasi_shim) — browser WASI shim used by the runtime backend
