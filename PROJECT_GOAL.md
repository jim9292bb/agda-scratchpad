# Project Goal

This project is a browser-hosted single-file Agda playground for demonstration,
learning, and practice.

It takes a similar approach to the JSCoq scratchpad:

- Open the browser.
- Write or paste a small Agda example.
- Load/check it with Agda/ALS.
- Interactively inspect goals, context, errors, and results.
- Practice basic proof/program construction without setting up a local Agda
  project.

## Who this is for, and what it isn't

For teachers, students, and anyone trying Agda without a local install.
It's not a project-oriented IDE: there's one source buffer, not a
workspace — if you need multi-file editing, a package manager, or full
VSCode parity, this isn't the tool for that. Library support (Cubical
Agda, the standard library, and a small curated set of others) is
treated as runtime environment setup, not a file-management feature.

## Scope

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
  trusted origin; see "Curated Multi-Library Support" in [ROADMAP.md](ROADMAP.md);
- version switching unless multiple WASM runtimes are intentionally supported;
- full VSCode feature parity;
- compiling or deploying Agda projects;
- advanced workspace management.

When considering new features, prefer the option that improves single-file
learning workflows. Reject or defer features that primarily serve large-project
development.

## Inspiration

`banacorn/agda-mode-vscode` is a reference for interaction commands and Agda
workflow behavior, not a target for complete VSCode parity.

`https://coq.vercel.app/scratchpad.html` is a reference for product positioning:
a focused browser scratchpad for learning and demonstrations.
