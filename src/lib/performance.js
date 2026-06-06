/**
 * @typedef PerformanceEntry
 * @prop {string} label
 * @prop {number} durationMs
 * @prop {Record<string, unknown>} [detail]
 * @prop {boolean} [failed]
 */

/** @param {number} durationMs */
export function formatDurationMs(durationMs) {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  if (durationMs < 10000) return `${(durationMs / 1000).toFixed(2)}s`
  return `${(durationMs / 1000).toFixed(1)}s`
}

/** @param {PerformanceEntry} entry */
export function formatPerformanceEntry(entry) {
  return `${entry.label}${entry.failed ? ' failed' : ''}: ${formatDurationMs(entry.durationMs)}`
}

/** @param {number} durationMs */
function normalizeDuration(durationMs) {
  return Math.round(durationMs * 1000) / 1000
}

/**
 * @param {{now?: () => number}} [options]
 */
export function createPerformanceTrace(options = {}) {
  const now = options.now ?? (() => performance.now())
  /** @type {PerformanceEntry[]} */
  const entries = []

  return {
    entries,

    /**
     * @template T
     * @param {string} label
     * @param {() => Promise<T>} callback
     * @param {Record<string, unknown>} [detail]
     * @returns {Promise<T>}
     */
    async measure(label, callback, detail) {
      const start = now()
      try {
        const value = await callback()
        entries.push({ label, durationMs: normalizeDuration(now() - start), ...(detail ? { detail } : {}) })
        return value
      } catch (err) {
        entries.push({ label, durationMs: normalizeDuration(now() - start), ...(detail ? { detail } : {}), failed: true })
        throw err
      }
    },
  }
}
