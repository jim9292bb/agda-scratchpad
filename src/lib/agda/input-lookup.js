import keymapData from '$lib/agda/input-keymap.js'

// Build reverse map at module load: char → [input sequences that produce it]
/** @param {Record<string, any>} trie */
function buildReverseMap(trie) {
  const map = new Map()

  /** @param {Record<string, any>} node @param {string} prefix */
  function dfs(node, prefix) {
    const chars = node['>>']
    if (chars) {
      for (const char of chars) {
        const seqs = map.get(char)
        if (seqs) seqs.push(prefix)
        else map.set(char, [prefix])
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== '>>') dfs(child, prefix + key)
    }
  }

  dfs(trie, '')
  return map
}

const reverseMap = buildReverseMap(keymapData)

/**
 * Returns all Agda input sequences (without leading \) that produce `char`.
 * @param {string} char
 * @returns {string[]}
 */
export function lookupChar(char) {
  return reverseMap.get(char) ?? []
}

/**
 * Format a Unicode code point as U+XXXX.
 * @param {number} cp
 * @returns {string}
 */
export function formatCodePoint(cp) {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
}
