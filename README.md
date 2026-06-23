# Agda Playground

A browser-hosted, single-file Agda playground for demonstrations, learning, and
practice. [Try it live](https://jim9292bb.github.io/agda-playground/).

The project takes a similar approach to the [JSCoq scratchpad](https://coq.vercel.app/scratchpad.html): open a browser, write
or paste a small Agda example, load it with Agda/ALS, and interact with goals,
context, commands, and diagnostics without setting up a local Agda project.

Forked from [agda-web/als-demo](https://github.com/agda-web/als-demo); developed
with AI pair-programming assistance (OpenAI Codex and Claude Code).

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

See [PROJECT_GOAL.md](PROJECT_GOAL.md) for the full product positioning.

## Configuring your deployment

Self-deployers (forking this repo to host their own version) configure
which Agda/ALS version and library combinations to bundle in
**[`deploy.config.mjs`](deploy.config.mjs)** (repo root) — see that file's
comments for the schema. The default reproduces this project's own
deployment unchanged.

See [file-server/README.md](file-server/README.md) for the full
deployment flow: placing raw library/ALS files (the only way to use
anything beyond this project's own shipped defaults), adding a library or
ALS version, and regenerating the dependency graph.

## Development

### Prerequisites

Node.js 18–24 (the `engines` field in `package.json` specifies `>=18.0.0 <25.0.0`).

### First-time setup

```sh
npm install              # install dependencies
npm run auto-configure   # fetch this project's own shipped default assets (~300 MB)
npm run setup            # prepare static/ for serving (~600 MB on disk after extraction)
```

`npm run auto-configure` fetches exactly this project's own shipped
defaults — it's a hardcoded script, not driven by `deploy.config.mjs`:
- ALS 2.8.0 WASM binary from [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server/releases/tag/nightly-20260407)
- Standard library 2.3, Cubical 0.9, and agda-categories 0.3.0 source
  archives from upstream Agda releases
- Pre-built `.agdai` cache zips and the dependency graph for Agda 2.8.0

— extracted raw (no zips) into `file-server/library/`/`file-server/als/`.
`npm run setup` then zips/copies them into `static/library/`/`static/als/`
for serving, and copies the prebuilt `.agdai` files into `static/agdai/`
so individual `.agdai` files can be fetched on demand at runtime (see
`static/agdai-manifest.json` for the dependency manifest used to prefetch
them). A self-deployer who has changed `deploy.config.mjs` or wants
different library/ALS versions must place their own raw files in
`file-server/library/<name>/`/`file-server/als/` by hand instead — see
[file-server/README.md](file-server/README.md).

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

See `package.json` for the full list of targeted `test:browser:*` scripts.

Browser tests require `agent-browser` to be available on `PATH`.

For roadmap details, see [PROJECT_GOAL.md](PROJECT_GOAL.md) and [ROADMAP.md](ROADMAP.md).

## Related projects

Tooling and dependencies this project builds on:

- [agda-web/als-demo](https://github.com/agda-web/als-demo) — upstream project this is forked from
- [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server) — source of the ALS WASM binary downloaded by `npm run auto-configure`
- [banacorn/agda-mode-vscode](https://github.com/banacorn/agda-mode-vscode) — reference for Agda interaction commands and shortcut behavior
- [agda-web/browser_wasi_shim](https://github.com/agda-web/browser_wasi_shim) — browser WASI shim used by the runtime backend

## Acknowledgments

This project embeds and redistributes the following academic software (see
[Related projects](#related-projects) above for tooling-level dependencies).
Each project requests a citation if you use it; see the linked `CITATION.cff`
files for full citation details.

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
