import { EditorState, StateField, ChangeSet } from '@codemirror/state'
import { upsertDeco } from '../codemirror/range-utils'
import { makeDecoInvertedEffects } from '../codemirror/inverted'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { mapUtf8Range } from '$lib/codemirror/offsets'
import { setGoals, setGoalsAfterChanges, addGoals, clearHighlight } from './effects'

/** @import { Range, TransactionSpec, RangeValue, Transaction } from '@codemirror/state' */

class GoalMarker extends WidgetType {
  /** @param {number | null} id */
  constructor(id) {
    super()
    this.id = id
  }

  /** @param {EditorView} view */
  toDOM(view) {
    const span = document.createElement('span')
    span.className = 'agda-goal-marker'
    this.updateDOM(span, view, true)
    return span
  }

  /** @param {WidgetType} widget */
  eq(widget) {
    return widget instanceof GoalMarker &&
      this.id === widget.id
  }
  /**
   * @param {HTMLElement} dom
   * @param {EditorView} _view
   * @param {boolean} _first */
  updateDOM(dom, _view, _first = false) {
    dom.textContent = this.id != null ? '' + this.id : '?'
    return true
  }

  /** @param {Event} evt */
  ignoreEvent(evt) {
    if (evt instanceof MouseEvent &&
        evt.button === 0) {
      return false
    }
    return true
  }
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

    arr.push(Decoration.mark({
      class: 'agda-hole',
      id: ip.id,
    }).range(from, to))
  }

  if (arr.length == 0) return {}

  const { changes, goals } = expandGoalRanges(state, arr)

  return {
    changes,
    effects: setGoalsAfterChanges.of(goals),
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

const goalsState = StateField.define({
  create(_state) {
    return Decoration.none
  },
  update(value, tr) {
    if (!tr.changes.empty) {
      const toRemove = new Set()
      // remove holes that are completely replaced by insertion
      tr.changes.iterChangedRanges((changeFrom, changeTo) => {
        value.between(changeFrom, changeTo, (from, to) => {
          if (changeFrom <= from && to <= changeTo) {
            toRemove.add(from)
            return false
          }
        })
      })
      value = value.update({ filter: f => !toRemove.has(f) })
      value = value.map(tr.changes)
    }

    for (const e of tr.effects) {
      if (e.is(clearHighlight)) {
        value = Decoration.none
      } else if (e.is(setGoals) || e.is(setGoalsAfterChanges)) {
        value = Decoration.set(e.value)
      } else if (e.is(addGoals)) {
        for (const deco of e.value) {
          value = upsertDeco(value, deco)
        }
      }
    }

    return value
  },
  provide(field) {
    return [
      EditorView.decorations.from(field),
      makeDecoInvertedEffects(field, value => value, decos => [addGoals.of(decos)]),
    ]
  }
})

/**
 * @param {EditorState} state
 * @param {number} id
 * @returns {{from: number, to: number} | null}
 */
export function getGoalRangeById(state, id) {
  /** @type {{from: number, to: number} | null} */
  let found = null
  state.field(goalsState).between(0, state.doc.length, (from, to, value) => {
    if (value.spec.id === id && state.doc.sliceString(from, to).startsWith('{!')) {
      found = { from, to }
      return false
    }
  })
  return found
}

/**
 * @param {EditorState} state
 * @param {number} pos
 * @returns {{id: number, from: number, to: number, text: string} | null}
 */
export function getGoalAtPosition(state, pos) {
  /** @type {{id: number, from: number, to: number, text: string} | null} */
  let found = null
  state.field(goalsState).between(0, state.doc.length, (from, to, value) => {
    if (from <= pos && pos <= to &&
        typeof value.spec.id === 'number' &&
        state.doc.sliceString(from, to).startsWith('{!')) {
      found = {
        id: value.spec.id,
        from,
        to,
        text: state.doc.sliceString(from, to),
      }
      return false
    }
  })
  return found
}

/** @import { PluginValue, ViewUpdate } from '@codemirror/view' */

/** @param {Decoration} value */
function makeGoalWidget(value) {
  const w = Decoration.widget({
    widget: new GoalMarker(value.spec.id),
  })
  const sideHack = -6e8-9999
  w.startSide = sideHack
  w.endSide = sideHack
  return w
}

const goalMarkers = ViewPlugin.fromClass(
  /** @implements {PluginValue} */
  class GoalNumberingsBase {
    /** @param {EditorView} _view */
    constructor(_view) {
      this.decorations = Decoration.none
    }

    /** @param {readonly Transaction[]} trs */
    requiresUpdate(trs) {
      return trs.some(tr =>
        tr.effects.some(e =>
          e.is(setGoals) || e.is(setGoalsAfterChanges) || e.is(clearHighlight)))
    }

    /**
     * @param {ViewUpdate} update
     */
    update(update) {
      const stale = update.docChanged ||
        update.viewportChanged ||
        this.requiresUpdate(update.transactions)
      if (!stale) return

      const oldDecos = this.decorations.map(update.changes)
      const goals = update.state.field(goalsState)

      const newMarkers = update.view.visibleRanges.map(({from: vf, to: vt}) => {
        /** @type {Range<Decoration>[]} */
        const collected = []
        goals.between(vf, vt, (_, pos, value) => {
          /** @type {Range<Decoration> | null} */
          let recycled = null
          oldDecos.between(pos, pos, (_f, _t, value) => {
            recycled = value.range(pos)
            return false
          })
          collected.push(recycled ?? makeGoalWidget(value).range(pos))
        })
        return collected
      })

      this.decorations = Decoration.set(newMarkers.flat())
    }
  }, {
    decorations: value => value.decorations
  })

export function agdaGoals() {
  return [
    // the order matters!
    goalMarkers,
    goalsState,
  ]
}
