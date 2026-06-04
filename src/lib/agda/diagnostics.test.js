/// <reference types="vitest/globals" />

import { parseAgdaDiagnostic } from './diagnostics'

describe('parseAgdaDiagnostic', () => {
  it('parses same-line Agda errors with a code', () => {
    expect(parseAgdaDiagnostic('/source.agda:7.16-17: error: [NotInScope]\nNot in scope:\n  a')).toEqual({
      filepath: '/source.agda',
      line: 7,
      column: 16,
      endLine: 7,
      endColumn: 17,
      severity: 'error',
      code: 'NotInScope',
      message: 'Not in scope:\n  a',
    })
  })

  it('parses multi-line ranges', () => {
    expect(parseAgdaDiagnostic('/source.agda:3.4-4.5: warning: [CoverageIssue]\nMissing cases')).toEqual({
      filepath: '/source.agda',
      line: 3,
      column: 4,
      endLine: 4,
      endColumn: 5,
      severity: 'warning',
      code: 'CoverageIssue',
      message: 'Missing cases',
    })
  })

  it('returns null for unstructured output', () => {
    expect(parseAgdaDiagnostic('Loading /source.agda...')).toBeNull()
  })
})
