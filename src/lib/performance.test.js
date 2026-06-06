/// <reference types="vitest/globals" />

import { createPerformanceTrace, formatDurationMs, formatPerformanceEntry } from './performance'

describe('performance tracing', () => {
  it('formats short and long durations consistently', () => {
    expect(formatDurationMs(12.345)).toBe('12ms')
    expect(formatDurationMs(1234.4)).toBe('1.23s')
    expect(formatDurationMs(12345.6)).toBe('12.3s')
  })

  it('records measured async operations with labels and metadata', async () => {
    let now = 100
    const trace = createPerformanceTrace({ now: () => now })
    const result = await trace.measure('Load source', async () => {
      now = 142.6
      return 'ok'
    }, { file: '/source.agda' })

    expect(result).toBe('ok')
    expect(trace.entries).toEqual([{
      label: 'Load source',
      durationMs: 42.6,
      detail: { file: '/source.agda' },
    }])
    expect(formatPerformanceEntry(trace.entries[0])).toBe('Load source: 43ms')
  })

  it('records failed operations before rethrowing', async () => {
    let now = 10
    const trace = createPerformanceTrace({ now: () => now })
    const error = new Error('boom')

    await expect(trace.measure('Agda setup', async () => {
      now = 510
      throw error
    })).rejects.toThrow('boom')

    expect(trace.entries).toEqual([{
      label: 'Agda setup',
      durationMs: 500,
      failed: true,
    }])
    expect(formatPerformanceEntry(trace.entries[0])).toBe('Agda setup failed: 500ms')
  })
})
