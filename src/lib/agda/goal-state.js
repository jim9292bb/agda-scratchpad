import { StateField } from '@codemirror/state'
import {
  addGoals,
  clearGoals,
  removeGoalInfo,
  setGoalInfo,
  setGoals,
  setGoalsAfterChanges,
} from './effects'

/** @import { EditorState, Range } from '@codemirror/state' */
/** @import { Decoration } from '@codemirror/view' */

/**
 * @typedef AgdaGoal
 * @prop {number} id
 * @prop {number} outerFrom
 * @prop {number} outerTo
 * @prop {number} innerFrom
 * @prop {number} innerTo
 * @prop {number} documentVersion
 * @prop {string} text
 * @prop {string} input
 * @prop {string} [range]
 * @prop {string} [type]
 */

/**
 * @typedef GoalInfo
 * @prop {number | string} id
 * @prop {string} [range]
 * @prop {string} [type]
 */

/**
 * @typedef GoalState
 * @prop {number} documentVersion
 * @prop {AgdaGoal[]} goals
 */

const goalStart = '{!'
const goalEnd = '!}'

/**
 * @param {string} text
 * @returns {{innerStart: number, innerEnd: number, input: string} | null}
 */
function parseGoalText(text) {
  if (!text.startsWith(goalStart) || !text.endsWith(goalEnd)) return null

  let innerStart = goalStart.length
  let innerEnd = text.length - goalEnd.length

  if (text[innerStart] === ' ') innerStart++
  if (text[innerEnd - 1] === ' ') innerEnd--

  return {
    innerStart,
    innerEnd,
    input: text.slice(innerStart, innerEnd),
  }
}

/**
 * @param {EditorState} state
 * @param {number} id
 * @param {number} from
 * @param {number} to
 * @param {number} documentVersion
 * @param {Partial<Pick<AgdaGoal, 'range' | 'type'>>} [metadata]
 * @returns {AgdaGoal | null}
 */
export function makeAgdaGoal(state, id, from, to, documentVersion, metadata = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  if (from < 0 || to > state.doc.length || from >= to) return null

  const text = state.doc.sliceString(from, to)
  const parsed = parseGoalText(text)
  if (!parsed) return null

  return {
    id,
    outerFrom: from,
    outerTo: to,
    innerFrom: from + parsed.innerStart,
    innerTo: from + parsed.innerEnd,
    documentVersion,
    text,
    input: parsed.input,
    ...metadata,
  }
}

/**
 * @param {AgdaGoal} goal
 * @returns {{from: number, to: number, id: number, text: string}}
 */
export function goalToLegacyRange(goal) {
  return {
    id: goal.id,
    from: goal.outerFrom,
    to: goal.outerTo,
    text: goal.text,
  }
}

/**
 * @param {GoalInfo[]} current
 * @param {GoalInfo[]} incoming
 * @returns {GoalInfo[]}
 */
export function mergeGoalInfos(current, incoming) {
  if (incoming.length === 0) return []

  const goalsById = new Map(current.map(goal => [goal.id, goal]))
  for (const goal of incoming) {
    goalsById.set(goal.id, {
      ...goalsById.get(goal.id),
      ...goal,
      type: goal.type ?? goalsById.get(goal.id)?.type,
      range: goal.range ?? goalsById.get(goal.id)?.range,
    })
  }
  return [...goalsById.values()]
}

/**
 * @param {GoalInfo[]} infos
 * @param {number} id
 * @returns {Partial<Pick<AgdaGoal, 'range' | 'type'>>}
 */
function metadataForGoal(infos, id) {
  const info = infos.find(goal => goal.id === id)
  return info ? { range: info.range, type: info.type } : {}
}

/**
 * @param {EditorState} state
 * @param {Range<Decoration>[]} ranges
 * @param {GoalState} previous
 * @returns {AgdaGoal[]}
 */
function goalsFromDecorations(state, ranges, previous) {
  /** @type {AgdaGoal[]} */
  const goals = []

  for (const range of ranges) {
    const id = range.value.spec.id
    if (typeof id !== 'number') continue

    const goal = makeAgdaGoal(
      state,
      id,
      range.from,
      range.to,
      previous.documentVersion,
      metadataForGoal(previous.goals, id),
    )
    if (goal) goals.push(goal)
  }

  return goals.sort((a, b) => a.outerFrom - b.outerFrom)
}

/**
 * @param {EditorState} state
 * @param {AgdaGoal} goal
 * @param {number} documentVersion
 * @returns {AgdaGoal | null}
 */
function refreshGoalText(state, goal, documentVersion) {
  return makeAgdaGoal(
    state,
    goal.id,
    goal.outerFrom,
    goal.outerTo,
    documentVersion,
    { range: goal.range, type: goal.type },
  )
}

/**
 * @param {GoalState} value
 * @param {import('@codemirror/state').Transaction} tr
 * @returns {GoalState}
 */
function mapGoalStateThroughChanges(value, tr) {
  if (!tr.docChanged) return value

  const documentVersion = value.documentVersion + 1
  /** @type {AgdaGoal[]} */
  const goals = []

  for (const goal of value.goals) {
    const outerFrom = tr.changes.mapPos(goal.outerFrom, 1)
    const outerTo = tr.changes.mapPos(goal.outerTo, -1)
    const mapped = {
      ...goal,
      outerFrom,
      outerTo,
      innerFrom: tr.changes.mapPos(goal.innerFrom, 1),
      innerTo: tr.changes.mapPos(goal.innerTo, -1),
      documentVersion,
    }
    const refreshed = refreshGoalText(tr.state, mapped, documentVersion)
    if (refreshed) goals.push(refreshed)
  }

  return { documentVersion, goals }
}

/**
 * Central Agda goal model. Decorations still render the goals, but commands
 * should query this field rather than rescanning raw `{! !}` text.
 */
export const agdaGoalState = StateField.define({
  /** @returns {GoalState} */
  create() {
    return {
      documentVersion: 0,
      goals: [],
    }
  },
  update(value, tr) {
    value = mapGoalStateThroughChanges(value, tr)

    for (const effect of tr.effects) {
      if (effect.is(clearGoals)) {
        value = { ...value, goals: [] }
      } else if (effect.is(setGoals) || effect.is(setGoalsAfterChanges)) {
        value = {
          ...value,
          goals: goalsFromDecorations(tr.state, effect.value, value),
        }
      } else if (effect.is(addGoals)) {
        const incoming = goalsFromDecorations(tr.state, effect.value, value)
        const byId = new Map(value.goals.map(goal => [goal.id, goal]))
        for (const goal of incoming) byId.set(goal.id, goal)
        value = {
          ...value,
          goals: [...byId.values()].sort((a, b) => a.outerFrom - b.outerFrom),
        }
      } else if (effect.is(setGoalInfo)) {
        const merged = mergeGoalInfos(value.goals, effect.value)
        const metadata = new Map(merged.map(goal => [goal.id, goal]))
        value = {
          ...value,
          goals: value.goals.map(goal => ({
            ...goal,
            range: metadata.get(goal.id)?.range ?? goal.range,
            type: metadata.get(goal.id)?.type ?? goal.type,
          })),
        }
      } else if (effect.is(removeGoalInfo)) {
        if (typeof effect.value === 'number') {
          value = {
            ...value,
            goals: value.goals.filter(goal => goal.id !== effect.value),
          }
        }
      }
    }

    return value
  },
})

/** @param {EditorState} state */
export function getAgdaGoals(state) {
  return state.field(agdaGoalState).goals
}

/** @param {EditorState} state */
export function getAgdaDocumentVersion(state) {
  return state.field(agdaGoalState).documentVersion
}

/**
 * @param {EditorState} state
 * @param {number} id
 * @returns {AgdaGoal | null}
 */
export function getAgdaGoalById(state, id) {
  return getAgdaGoals(state).find(goal => goal.id === id) ?? null
}

/**
 * @param {EditorState} state
 * @param {number} pos
 * @returns {AgdaGoal | null}
 */
export function getAgdaGoalAtPosition(state, pos) {
  return getAgdaGoals(state).find(goal => goal.outerFrom <= pos && pos <= goal.outerTo) ?? null
}

/** @param {string} text */
export function extractGoalInput(text) {
  return parseGoalText(text)?.input ?? text
}
