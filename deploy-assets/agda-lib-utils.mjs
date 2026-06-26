/**
 * Tiny shared parsers for raw `.agda-lib` file content — plain text, no
 * `agda` binary needed. Used by both generate-library-info.mjs (to learn
 * includeSubpath/libraryName) and dot-to-manifest.mjs (to learn
 * includeSubpath for module-scanning).
 */

/** @param {string} src - raw .agda-lib file content */
export function parseAgdaLibInclude(src) {
  const m = src.match(/^include:\s*(.+)/m)
  const include = (m ? m[1].trim().split(/\s+/)[0] : '.').replace(/\/+$/, '')
  return include === '.' ? '' : include
}

/** @param {string} src - raw .agda-lib file content */
export function parseAgdaLibName(src) {
  const m = src.match(/^name:\s*(.+)/m)
  if (!m) throw new Error('no `name:` field found in .agda-lib content')
  return m[1].trim()
}
