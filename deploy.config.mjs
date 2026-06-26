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
 *   - id, label: identify the profile in the profile selector / local storage.
 *   - alsVersion: must have a matching entry in deploy-assets/als-catalog.mjs.
 *   - libraries: this *is* the library catalog now — there's no separate
 *     deploy-assets/libraries.mjs to cross-reference.
 *       - folderName (required): the directory name under
 *         deploy-assets/library/ — also this library's identity for every
 *         internal purpose (cache keys, asset paths, VFS folder name). Must
 *         be unique; if the same folderName is referenced from more than one
 *         profile, every reference must agree on agdaLibFile/name/version
 *         (it's the same library, not a second one).
 *       - agdaLibFile (required): the `.agda-lib` filename at that
 *         library's root. `npm run setup` reads this file directly to learn
 *         its `include:`/`name:` (written to deploy-assets/generated-libraries.mjs
 *         — see deploy-assets/generate-library-info.mjs) — neither is
 *         hand-maintained here, so they can't drift from the real file.
 *       - name, version (optional): cosmetic only (e.g. shown in the UI) —
 *         nothing reads these to build a path or a cache key.
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
      label: 'Standard Library v2.3 + Cubical v0.9 (ALS 2.8.0)',
      alsVersion: '2.8.0',
      libraries: [
        { folderName: 'stdlib-2.3', agdaLibFile: 'standard-library.agda-lib', name: 'stdlib', version: '2.3' },
        { folderName: 'cubical-0.9', agdaLibFile: 'cubical.agda-lib', name: 'cubical', version: '0.9' },
      ],
    },
    {
      id: 'stdlib-2.3-agda-categories-0.3.0-als-2.8.0',
      label: 'Standard Library v2.3 + agda-categories v0.3.0 (ALS 2.8.0)',
      alsVersion: '2.8.0',
      libraries: [
        { folderName: 'stdlib-2.3', agdaLibFile: 'standard-library.agda-lib', name: 'stdlib', version: '2.3' },
        { folderName: 'agda-categories-0.3.0', agdaLibFile: 'agda-categories.agda-lib', name: 'agda-categories', version: '0.3.0' },
      ],
    },
  ],
}
