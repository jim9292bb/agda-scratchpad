import { offsetTable, utf16PosToUtf8 } from '$lib/codemirror/offsets'

/** @import { EditorState } from '@codemirror/state' */

export const noAgdaRange = 'noRange'

/**
 * @typedef AgdaPointOptions
 * @prop {number} [utf8Delta]
 * @prop {number} [columnDelta]
 */

/**
 * Clamp offsets to both the current document and the committed offset table
 * document. Agda ranges are computed against committed UTF-8 offsets.
 *
 * @param {EditorState} state
 * @param {number} offset
 */
export function clampOffsetToCommittedDoc(state, offset) {
  const committedDocLength = state.field(offsetTable).doc.length
  return Math.max(0, Math.min(offset, state.doc.length, committedDocLength))
}

/**
 * @param {EditorState} state
 * @param {number} offset
 * @param {AgdaPointOptions} [options]
 */
export function cmOffsetToAgdaPoint(state, offset, options = {}) {
  const clampedOffset = clampOffsetToCommittedDoc(state, offset)
  const line = state.doc.lineAt(clampedOffset)
  const utf8Offset = utf16PosToUtf8(state, clampedOffset)
  if (utf8Offset < 0) {
    throw new RangeError(`Cannot convert UTF-16 offset ${clampedOffset} inside a surrogate pair to an Agda UTF-8 position.`)
  }

  return {
    index: utf8Offset + (options.utf8Delta ?? 0),
    row: line.number,
    column: clampedOffset - line.from + (options.columnDelta ?? 0),
  }
}

/**
 * @param {string} filepath
 * @param {ReturnType<typeof cmOffsetToAgdaPoint>} start
 * @param {ReturnType<typeof cmOffsetToAgdaPoint>} end
 */
export function formatAgdaRange(filepath, start, end) {
  return `(intervalsToRange (Just (mkAbsolute ${JSON.stringify(filepath)})) ` +
    `[Interval () (Pn () ${start.index} ${start.row} ${start.column}) ` +
    `(Pn () ${end.index} ${end.row} ${end.column})])`
}

/**
 * @param {EditorState} state
 * @param {string} filepath
 * @param {number} from
 * @param {number} to
 * @param {{start?: AgdaPointOptions, end?: AgdaPointOptions}} [options]
 */
export function cmOffsetsToAgdaRange(state, filepath, from, to, options = {}) {
  return formatAgdaRange(
    filepath,
    cmOffsetToAgdaPoint(state, from, options.start),
    cmOffsetToAgdaPoint(state, to, options.end),
  )
}

/**
 * Mirrors banacorn/agda-mode-vscode's Goal.makeHaskellRange for Agda 2.8.
 * The range covers only the content inside `{!` and `!}`.
 *
 * @param {EditorState} state
 * @param {string} filepath
 * @param {{outerFrom: number, outerTo: number} | {from: number, to: number}} goal
 */
export function goalContentToAgdaRange(state, filepath, goal) {
  const from = 'outerFrom' in goal ? goal.outerFrom : goal.from
  const to = 'outerTo' in goal ? goal.outerTo : goal.to
  return cmOffsetsToAgdaRange(state, filepath, from, to, {
    start: { utf8Delta: 3, columnDelta: 3 },
    end: { utf8Delta: -3, columnDelta: -1 },
  })
}

