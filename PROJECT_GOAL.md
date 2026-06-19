# Project Goal

This project is a browser-hosted single-file Agda scratchpad for demonstration,
learning, and practice.

It takes a similar approach to the JSCoq scratchpad:

- Open the browser.
- Write or paste a small Agda example.
- Load/check it with Agda/ALS.
- Interactively inspect goals, context, errors, and results.
- Practice basic proof/program construction without setting up a local Agda
  project.

## Product Positioning

The project is not intended to be a full project-oriented IDE.

It should optimize for:

- fast startup for examples and exercises;
- reliable single-file interaction;
- clear goal, context, query, warning, and error display;
- Agda shortcuts that are useful for teaching and practice;
- Cubical Agda and standard library examples;
- shareable demo-friendly behavior;
- browser-only usage without local Agda installation.

It should not prioritize:

- editing multiple files;
- project-wide file explorers;
- an open package management UI (arbitrary user-supplied library formats,
  dependency resolution, a library registry, or letting users point at an
  untrusted external file server) — picking among a small, project-curated
  set of well-known libraries (e.g. agda-categories, plfa, agda-unimath,
  1lab, in addition to stdlib/cubical) is a planned, scoped exception, since
  every option in that set is still built and served from this project's own
  trusted origin; see "Curated Multi-Library Support" in `ROADMAP.md`;
- version switching unless multiple WASM runtimes are intentionally supported;
- full VSCode feature parity;
- compiling or deploying Agda projects;
- advanced workspace management.

## Scope Boundaries

The core unit of work is one source buffer backed by `/source.agda`.

Library support should be treated as runtime environment setup, not as a file
management feature. Cubical Agda and the standard library are useful because
they make examples richer, but the UI should remain a scratchpad rather than a
project editor.

When considering new features, prefer the option that improves single-file
learning workflows. Reject or defer features that primarily serve large-project
development.

## Development Priorities

1. Correctness of the Agda interaction lifecycle.
2. Clear goal and context display.
3. Reliable Agda shortcuts for exercises.
4. Good diagnostics and query output.
5. Unicode input suitable for Agda practice.
6. Browser regression coverage for common teaching examples.
7. UI polish that keeps the scratchpad simple.

## Reference Behavior

`banacorn/agda-mode-vscode` is a reference for interaction commands and Agda
workflow behavior, not a target for complete VSCode parity.

`https://coq.vercel.app/scratchpad.html` is a reference for product positioning:
a focused browser scratchpad for learning and demonstrations.

