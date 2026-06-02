import { getGoalAtPosition } from './goals'
import { extractGoalInput } from './goal-state'
import { goalContentToAgdaRange, noAgdaRange } from './ranges'

/** @import { EditorState } from '@codemirror/state' */
/** @import { EditorView } from '@codemirror/view' */

/**
 * @typedef GoalInfo
 * @prop {number | string} id
 * @prop {string} [range]
 * @prop {string} [type]
 */

/**
 * @typedef AgdaShortcutGoal
 * @prop {number} id
 * @prop {number} from
 * @prop {number} to
 * @prop {string} text
 */

/**
 * @typedef AgdaShortcutContext
 * @prop {AgdaShortcutGoal | null} goal
 * @prop {string} input
 * @prop {string} range
 */

/**
 * @param {EditorState} state
 * @returns {{from: number, to: number, text: string}[]}
 */
function getTextualHoles(state) {
  const doc = state.doc.toString()
  /** @type {{from: number, to: number, text: string}[]} */
  const holes = []
  let searchFrom = 0

  while (searchFrom < doc.length) {
    const from = doc.indexOf('{!', searchFrom)
    if (from < 0) break

    const close = doc.indexOf('!}', from + 2)
    if (close < 0) break

    const to = close + 2
    holes.push({ from, to, text: doc.slice(from, to) })
    searchFrom = to
  }

  return holes
}

/**
 * @param {EditorState} state
 * @param {number} pos
 */
function getTextualHoleAtPosition(state, pos) {
  return getTextualHoles(state).find(hole => hole.from <= pos && pos <= hole.to) ?? null
}

/** @param {EditorState} state */
function getOnlyTextualHole(state) {
  const holes = getTextualHoles(state)
  return holes.length === 1 ? holes[0] : null
}

/**
 * Agda-mode-vscode stores hole positions first, then assigns interaction point
 * ids in document order. This mirrors that as a fallback when CodeMirror
 * decorations are not available.
 *
 * @param {EditorState} state
 * @param {number} pos
 * @param {GoalInfo[]} goalInfos
 * @returns {AgdaShortcutGoal | null}
 */
function getOrderedTextualGoalAtPosition(state, pos, goalInfos) {
  const holes = getTextualHoles(state)
  const index = holes.findIndex(hole => hole.from <= pos && pos <= hole.to)
  if (index < 0) return null

  const numericGoalInfos = goalInfos.filter(goal => typeof goal.id === 'number')
  if (numericGoalInfos.length !== holes.length) return null

  const goalInfo = numericGoalInfos[index]
  if (!goalInfo || typeof goalInfo.id !== 'number') return null

  return {
    id: goalInfo.id,
    from: holes[index].from,
    to: holes[index].to,
    text: holes[index].text,
  }
}

/**
 * @param {EditorState} state
 * @param {number} pos
 * @param {GoalInfo[]} goalInfos
 * @param {boolean} [allowOnlyGoalFallback]
 * @returns {AgdaShortcutGoal | null}
 */
function getGoalInfoFallback(state, pos, goalInfos, allowOnlyGoalFallback = false) {
  const singleGoal = goalInfos.length === 1 ? goalInfos[0] : null
  if (typeof singleGoal?.id !== 'number') return null

  const textualGoal =
    getTextualHoleAtPosition(state, pos) ??
    (allowOnlyGoalFallback ? getOnlyTextualHole(state) : null)
  if (!textualGoal) return null

  return {
    id: singleGoal.id,
    from: textualGoal.from,
    to: textualGoal.to,
    text: textualGoal.text,
  }
}

/**
 * @param {EditorView} view
 * @param {string} currentFilePath
 * @param {GoalInfo[]} goalInfos
 * @returns {AgdaShortcutContext}
 */
export function getAgdaShortcutContext(view, currentFilePath, goalInfos) {
  const selection = view.state.selection.main
  const selectedText = selection.empty ? '' : view.state.sliceDoc(selection.from, selection.to)
  const docLength = view.state.doc.length
  const previousPos = Math.max(0, selection.head - 1)
  const nextPos = Math.min(docLength, selection.head + 1)
  const goal =
    getGoalAtPosition(view.state, selection.head) ??
    getGoalAtPosition(view.state, previousPos) ??
    getGoalAtPosition(view.state, nextPos) ??
    getOrderedTextualGoalAtPosition(view.state, selection.head, goalInfos) ??
    getOrderedTextualGoalAtPosition(view.state, previousPos, goalInfos) ??
    getOrderedTextualGoalAtPosition(view.state, nextPos, goalInfos) ??
    getGoalInfoFallback(view.state, selection.head, goalInfos, true)

  return {
    goal,
    input: selectedText || (goal ? extractGoalInput(goal.text) : ''),
    range: goal ? goalContentToAgdaRange(view.state, currentFilePath, goal) : noAgdaRange,
  }
}
