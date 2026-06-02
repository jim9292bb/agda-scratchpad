import { EditorState, ChangeSet } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { mapUtf8Range } from '$lib/codemirror/offsets'
import { setGoals, setGoalsAfterChanges, setGoalInfo } from './effects'
import {
  agdaGoalState,
  getAgdaGoalAtPosition,
  getAgdaGoalById,
  getAgdaGoals,
  goalToLegacyRange,
} from './goal-state'

/** @import { Range, TransactionSpec, RangeValue, Transaction } from '@codemirror/state' */

/** @param {Agda._Range | undefined} range */
function formatInteractionRange(range) {
  if (!range) return undefined
  const { start, end } = range
  if (start.line === end.line) return `${start.line}:${start.col}-${end.col}`
  return `${start.line}:${start.col}-${end.line}:${end.col}`
}

/** @param {Agda._InteractionPoint} interactionPoint */
function summarizeInteractionPoint(interactionPoint) {
  return {
    id: interactionPoint.id,
    range: formatInteractionRange(interactionPoint.range?.[0]),
  }
}

/**
 * @param {Range<Decoration>[]} decos
 * @param {(number | string)[]} ids
 * @param {EditorState} state
 */
function summarizeLegacyInteractionPoints(decos, ids, state) {
  return decos.map((deco, idx) => {
    const line = state.doc.lineAt(deco.from)
    return {
      id: ids[idx] ?? deco.value.spec.id ?? '?',
      range: `${line.number}:${deco.from - line.from + 1}`,
    }
  })
}

/**
 * @param {number} id
 * @param {Record<string, any>} [baseSpec]
 */
function makeGoalMark(id, baseSpec = {}) {
  return Decoration.mark({
    ...baseSpec,
    class: baseSpec.class ?? 'agda-hole',
    id,
    attributes: {
      ...(baseSpec.attributes ?? {}),
      'data-goal-id': String(id),
      'aria-label': `Goal ${id}`,
    },
  })
}

/** @param {EditorState} state */
function buildDecorationsFromGoalState(state) {
  return getAgdaGoals(state).map(goal =>
    makeGoalMark(goal.id).range(goal.outerFrom, goal.outerTo))
}

/**
 * @param {EditorState} state
 * @param {Agda._InteractionPoint[]} ips
 * @returns {TransactionSpec} */
export function buildGoalTransaction(state, ips) {
  /** @type {Range<Decoration>[]} */
  const arr = []

  for (const ip of ips) {
    const { start, end } = ip.range[0]
    const [from, to] = mapUtf8Range(state, start.pos - 1, end.pos - 1)
    if (from >= to) continue

    arr.push(makeGoalMark(ip.id).range(from, to))
  }

  if (arr.length == 0) return {}

  const { changes, goals } = expandGoalRanges(state, arr)

  return {
    changes,
    effects: [
      setGoalsAfterChanges.of(goals),
      setGoalInfo.of(ips.map(summarizeInteractionPoint)),
    ],
  }
}

/**
 * Rebuild goal ids from legacy ALS `ResponseInteractionPoints`, where only ids
 * are provided. The corresponding hole ranges come from token highlighting.
 *
 * @param {EditorState} state
 * @param {import('@codemirror/state').RangeSet<Decoration>} holes
 * @param {number[]} ids
 * @returns {TransactionSpec}
 */
export function buildLegacyGoalTransaction(state, holes, ids) {
  /** @type {Range<Decoration>[]} */
  const decos = []

  for (let it = holes.iter(); it.value !== null; it.next()) {
    const { value, from, to } = it
    decos.push(makeGoalMark(ids[decos.length], value.spec).range(from, to))
  }

  if (decos.length !== ids.length) {
    throw new Error(`mismatched numbers of interaction points ${ids.length} and holes ${decos.length}`)
  }

  return {
    effects: [
      setGoals.of(decos),
      setGoalInfo.of(summarizeLegacyInteractionPoints(decos, ids, state)),
    ],
  }
}

const expandedQuestionMarkGoal = '{!  !}'

/**
 * @param {EditorState} state
 * @param {Range<Decoration>[]} goals
 * @returns {{changes: ChangeSet, goals: Range<Decoration>[]}}
 */
function expandGoalRanges(state, goals) {
  /** @type {{from: number, to: number, insert: string}[]} */
  const replacements = []
  /** @type {Range<Decoration>[]} */
  const expandedGoals = []
  let offsetDelta = 0

  for (const goal of [...goals].sort((a, b) => a.from - b.from)) {
    const { from, to, value } = goal
    const currentText = state.doc.sliceString(from, to)
    const mappedFrom = from + offsetDelta

    if (currentText == '?') {
      replacements.push({ from, to, insert: expandedQuestionMarkGoal })
      expandedGoals.push(value.range(mappedFrom, mappedFrom + expandedQuestionMarkGoal.length))
      offsetDelta += expandedQuestionMarkGoal.length - (to - from)
    } else {
      expandedGoals.push(value.range(mappedFrom, to + offsetDelta))
    }
  }

  return {
    changes: ChangeSet.of(replacements, state.doc.length),
    goals: expandedGoals,
  }
}

/**
 * @param {EditorState} state
 * @param {Range<RangeValue>[]} goals */
export function expandGoals(state, goals) {
  const ret = []
  for (const {from, to} of goals) {
    if (state.doc.sliceString(from, to) == '?') {
      ret.push({ from, to, insert: '{!  !}' })
    }
  }
  return ChangeSet.of(ret, state.doc.length)
}

const goalsDecorations = EditorView.decorations.compute([agdaGoalState], state =>
  Decoration.set(buildDecorationsFromGoalState(state), true))

/**
 * @param {EditorState} state
 * @param {number} id
 * @returns {{from: number, to: number} | null}
 */
export function getGoalRangeById(state, id) {
  const goal = getAgdaGoalById(state, id)
  return goal ? { from: goal.outerFrom, to: goal.outerTo } : null
}

/**
 * @param {EditorState} state
 * @param {number} pos
 * @returns {{id: number, from: number, to: number, text: string} | null}
 */
export function getGoalAtPosition(state, pos) {
  const goal = getAgdaGoalAtPosition(state, pos)
  return goal ? goalToLegacyRange(goal) : null
}

export function agdaGoals() {
  return [
    // the order matters!
    agdaGoalState,
    goalsDecorations,
  ]
}
