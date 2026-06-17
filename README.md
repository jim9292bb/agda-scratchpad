# Agda Scratchpad

A browser-hosted, single-file Agda scratchpad for demonstrations, learning, and
practice. **[Try it on GitHub Pages →](https://jim9292bb.github.io/agda-scratchpad/)**

Forked from [agda-web/als-demo](https://github.com/agda-web/als-demo).
Developed with AI pair-programming assistance (OpenAI Codex and Claude Code).

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

### Prerequisites

Node.js 18–24 (the `engines` field in `package.json` specifies `>=18.0.0 <25.0.0`).

### First-time setup

```sh
npm install         # install dependencies
npm run setup       # download ALS WASM binaries and library archives (~300 MB)
```

`npm run setup` fetches:
- ALS WASM binaries (Agda 2.6, 2.7, 2.8) from [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server/releases/tag/nightly-20260407)
- Standard library and Cubical source zips from upstream Agda releases
- Pre-built `.agdai` cache zips for Agda 2.8.0

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

Browser tests require `agent-browser` to be available on `PATH`.

For roadmap details, see `PROJECT_GOAL.md` and `ROADMAP.md`.

## Related projects

- [agda-web/als-demo](https://github.com/agda-web/als-demo) — upstream project this is forked from
- [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server) — source of the ALS WASM binaries downloaded by `npm run setup`
- [banacorn/agda-mode-vscode](https://github.com/banacorn/agda-mode-vscode) — reference for Agda interaction commands and shortcut behavior
- [agda-web/browser_wasi_shim](https://github.com/agda-web/browser_wasi_shim) — browser WASI shim used by the runtime backend

## Acknowledgments

This project embeds and redistributes the following academic software. Each
project requests a citation if you use it; see the linked `CITATION.cff` files
for full citation details.

- **Agda** — Agda Developers. [agda/agda](https://github.com/agda/agda),
  [CITATION.cff](https://github.com/agda/agda/blob/master/CITATION.cff)
- **Agda Standard Library** — The Agda Community.
  [agda/agda-stdlib](https://github.com/agda/agda-stdlib),
  [CITATION.cff](https://github.com/agda/agda-stdlib/blob/master/CITATION.cff)
- **Cubical Agda Library** — The Agda Community.
  [agda/cubical](https://github.com/agda/cubical),
  [CITATION.cff](https://github.com/agda/cubical/blob/master/CITATION.cff)

## License

MIT — see [LICENSE](LICENSE). Third-party code included or derived from elsewhere is documented in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
