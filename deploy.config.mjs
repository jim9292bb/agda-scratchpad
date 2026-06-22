/**
 * Single source of truth for which Agda environment combinations this
 * deployment offers. Self-deployers: fork this repo and edit this file,
 * then run `npm run setup && npm run build`.
 *
 * Default reproduces this project's own deployment (ALS 2.8.0 with
 * Standard Library v2.3 + Cubical v0.9) unchanged.
 *
 * Schema: a flat list of `profiles`. Each profile is a complete, ready-to-use
 * combination — one ALS/Agda version plus the library set that goes with it.
 * There is deliberately no separate "pick an ALS version" + "pick a library
 * set" pair of independent choices: every option in `profiles` is valid by
 * construction, so the UI only needs a single profile selector (shown below
 * the ALS status card when more than one profile is configured) and can
 * never present an incompatible pairing.
 *
 *   - id: stable identifier, used for local storage; not shown to users —
 *     safe to bake in exact versions, e.g. 'stdlib-2.3-cubical-0.9-als-2.8.0'.
 *   - label: shown directly in the profile selector to end users, most of
 *     whom are not expected to know Agda/ALS version numbers or what they
 *     mean — keep it short and capability-focused (e.g. "Standard Library +
 *     Cubical"), not a version-pinned string. Exact versions are already
 *     surfaced separately in Settings → Runtime's read-only summary for
 *     anyone who wants them.
 *   - alsVersion: must have a matching entry in file-server/als-catalog.mjs.
 *   - libraries: name+version pairs, each must have a matching entry in
 *     file-server/libraries.mjs.
 *
 * You are responsible for verifying that the libraries within one profile
 * are actually compatible with each other (same underlying type theory —
 * e.g. don't mix a Cubical library with a non-Cubical one — and no
 * conflicting transitive version requirements, e.g. two different stdlib
 * versions) and that they work with the chosen alsVersion. Nothing here
 * checks this automatically. See ROADMAP.md "Curated Multi-Library Support"
 * for context and known compatibility concerns between candidate libraries
 * (agda-categories, plfa, agda-unimath, 1lab).
 */

export const DEPLOY_CONFIG = {
  profiles: [
    {
      id: 'stdlib-2.3-cubical-0.9-als-2.8.0',
      label: 'Standard Library + Cubical',
      alsVersion: '2.8.0',
      libraries: [
        { name: 'stdlib', version: '2.3' },
        { name: 'cubical', version: '0.9' },
      ],
    },
    {
      id: 'stdlib-2.3-agda-categories-0.3.0-als-2.8.0',
      label: 'Standard Library + Category Theory',
      alsVersion: '2.8.0',
      libraries: [
        { name: 'stdlib', version: '2.3' },
        { name: 'agda-categories', version: '0.3.0' },
      ],
    },
  ],
}
