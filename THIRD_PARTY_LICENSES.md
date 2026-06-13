# Third-Party Licenses

This file documents third-party code included or derived from in this project.

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
