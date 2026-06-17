# Third-Party Licenses

This file documents third-party code copied into, or derived from elsewhere
and adapted for, this project. It also documents third-party binaries and
source archives that this project fetches and re-serves to every visitor of
the deployed site (the ALS WASM binary and the standard-library/Cubical source
archives downloaded by `npm run setup` and fetched into the browser at
runtime).

---

## Agda compiler

**Used as:** The ALS WASM binaries (`static/als-*.wasm`, downloaded by `npm run setup`
from [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server))
are built from the Agda compiler. The binaries are served to every visitor of the
deployed site.

**Source:** [agda/agda](https://github.com/agda/agda)

**License:** MIT

```
Copyright (c) 2005-2025 remains with the authors.
Agda 2 was originally written by Ulf Norell, partially based on code from
Agda 1 by Catarina Coquand and Makoto Takeyama, and from Agdalight by Ulf
Norell and Andreas Abel. Cubical Agda was originally contributed by Andrea
Vezzosi. The full list of contributors is available at
https://github.com/agda/agda/graphs/contributors or from the git repository
via `git shortlog -sne`.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Agda Language Server (ALS)

**Used as:** The ALS WASM binaries (`static/als-*.wasm`) are built from this project
and served to every visitor of the deployed site.

**Source:** [banacorn/agda-language-server](https://github.com/banacorn/agda-language-server)
(distributed via [agda-web/agda-language-server](https://github.com/agda-web/agda-language-server) releases)

**License:** MIT

```
MIT License

Copyright (c) 2017 - 2020 Luā Tîng-Giān

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Agda standard library

**Used as:** `static/agda-stdlib-2.3.zip` (source archive) and the `.agdai` cache
derived from it. Both are downloaded by `npm run setup` and fetched into the
browser at runtime for every visitor of the deployed site.

**Source:** [agda/agda-stdlib](https://github.com/agda/agda-stdlib)

**License:** MIT

```
Copyright (c) 2007-2025 Nils Anders Danielsson, Ulf Norell, Shin-Cheng Mu,
Bradley Hardy, Samuel Bronson, Dan Doel, Patrik Jansson, Liang-Ting Chen,
Jean-Philippe Bernardy, Andrés Sicard-Ramírez, Nicolas Pouillard, Darin
Morrison, Peter Berry, Daniel Brown, Simon Foster, Dominique Devriese,
Andreas Abel, Alcatel-Lucent, and other contributors. The full list of
contributors is available at
https://github.com/agda/agda-stdlib/graphs/contributors or from the git
repository via `git shortlog -sne`.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Cubical Agda library

**Used as:** `static/agda-cubical-0.9.zip` (source archive) and the `.agdai` cache
derived from it. Both are downloaded by `npm run setup` and fetched into the
browser at runtime for every visitor of the deployed site.

**Source:** [agda/cubical](https://github.com/agda/cubical)

**License:** MIT, with a small number of individual files licensed under
BSD-3-Clause instead (per the upstream `LICENSE` file's stated exceptions).
This project redistributes the library as-is (source archive and compiled
`.agdai` cache) without modifying individual files, so the per-file exceptions
carry through unchanged; see the upstream
[`LICENSE`](https://github.com/agda/cubical/blob/master/LICENSE) file for which
files are affected.

```
MIT License (with exceptions for individual files, see below)

Copyright (c) 2018 github.com/agda/cubical contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

-------------------------------------

A couple of files were completely or partially copied from sources which use
different licenses. The files exempted from the MIT license are marked with
the SPDX identifier for their license. See https://spdx.org/licenses/ for a
list of SPDX identifiers. Specifically, some files are licensed under the
BSD-3-Clause license: https://opensource.org/license/bsd-3-clause/
```

---

## browser_wasi_shim

**Used as:** npm dependency (`@agda-web/browser_wasi_shim`), bundled into the
worker JS output served to every visitor of the deployed site.

**Source:** [agda-web/browser_wasi_shim](https://github.com/agda-web/browser_wasi_shim)

**License:** Dual-licensed under MIT and Apache-2.0; this project uses it under
the MIT option (no NOTICE file is present upstream, so no NOTICE propagation
is required).

```
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## TC39 proposal-arraybuffer-base64 playground polyfill

**File:** `src/lib/worker/util-base64.js`

**Source:** [`tc39/proposal-arraybuffer-base64`](https://github.com/tc39/proposal-arraybuffer-base64),
file [`playground/polyfill-core.mjs`](https://github.com/tc39/proposal-arraybuffer-base64/blob/main/playground/polyfill-core.mjs)

**Modification:** Converted from ES module playground format to a CommonJS-compatible
export style and adapted for use in the ALS worker environment. The file already
carries a `// modified from` comment linking to the original.

**License:** The TC39 proposal repository uses the Ecma International Software
License (a permissive license allowing use, reproduction, and distribution with
attribution). See
[`https://github.com/tc39/proposal-arraybuffer-base64/blob/main/LICENSE`](https://github.com/tc39/proposal-arraybuffer-base64/blob/main/LICENSE)
for the authoritative text.

---

## agda-mode-vscode keymap

**File:** `src/lib/agda/input-keymap.js`

**Source:** [`banacorn/agda-mode-vscode`](https://github.com/banacorn/agda-mode-vscode),
file [`asset/keymap.js`](https://github.com/banacorn/agda-mode-vscode/blob/master/asset/keymap.js)

**Modification:** Converted from CommonJS (`module.exports.default = ...`) to
ESM (`export default ...`) for use in this Vite/SvelteKit project. No other
changes.

**License:** MIT

```
MIT License

Copyright (c) 2020 Ting-gian LUA

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
