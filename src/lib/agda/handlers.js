import { Decoration } from '@codemirror/view'
import { clearHighlight, clearRunningInfo, emitRunningInfo, removeGoalInfo, setGoalInfo, setGoals } from './effects'
import { alsHighlightingInfosDirectSchema, alsInteractionPointsSchema } from './schema'
import { buildHighlightEffects, highlightState } from './highlight'
import { buildGoalTransaction, getGoalRangeById } from './goals'

/** @import { EditorView } from '@codemirror/view' */
/** @import { ALSMessageRouter } from './transport' */

/** @typedef Controller
 * @prop {boolean} checked
 * @prop {boolean} showImplicitArgs
 * @prop {boolean} showIrrelevantArgs
 * @prop {boolean} suppressAgdaInternalErrors
 * @prop {string | null} lastAgdaInternalError
 * @prop {string | null} lastAgdaError
 * @prop {{id: number, from: number, to: number, text: string} | undefined} [pendingCaseSplitGoal]
 * @prop {{id: number, from: number, to: number, text: string} | undefined} [pendingGiveGoal]
 */

/** @typedef {(
 *  | 'ResponseHighlightingInfoDirect' | 'ResponseHighlightingInfoIndirect'
 *  | 'ResponseDisplayInfo' | 'ResponseStatus'
 *  | 'ResponseClearHighlightingTokenBased' | 'ResponseClearHighlightingNotOnlyTokenBased'
 *  | 'ResponseRunningInfo' | 'ResponseClearRunningInfo'
 *  | 'ResponseDoneAborting' | 'ResponseDoneExiting'
 *  | 'ResponseGiveAction' | 'ResponseInteractionPoints'
 *  | 'ResponseMakeCaseFunction' | 'ResponseMakeCaseExtendedLambda'
 *  | 'ResponseSolveAll' | 'ResponseMimer'
 *  | 'ResponseJumpToError' | 'ResponseJSONRaw')} ALSResponseType */

/**
 * @param {Controller} controller
 * @param {EditorView} editorView */
export function makeLSPResponseHandlerMap(controller, editorView) {
  /**
   * @param {string | undefined | null} message
   * @param {number} [debugLevel]
   */
  function emitMessage(message, debugLevel = 1) {
    if (message) {
      if (!message.endsWith('\n')) message += '\n'
      editorView.dispatch({ effects: emitRunningInfo.of({ message, debugLevel }) })
    }
  }

  /** @param {any} constraint */
  function formatConstraint(constraint) {
    if (constraint.type) return constraint.type
    if (constraint.sort) return constraint.sort
    return JSON.stringify(constraint)
  }

  /** @param {Agda._Range | undefined} range */
  function formatRange(range) {
    if (!range) return undefined
    const { start, end } = range
    if (start.line === end.line) return `${start.line}:${start.col}-${end.col}`
    return `${start.line}:${start.col}-${end.line}:${end.col}`
  }

  /** @param {Agda._ConstraintObj | undefined} constraintObj */
  function getConstraintId(constraintObj) {
    if (!constraintObj) return '?'
    if ('id' in constraintObj) return constraintObj.id
    return constraintObj.name
  }

  /** @param {Agda.OfType | Agda.JustSort} goal */
  function summarizeGoal(goal) {
    return {
      id: getConstraintId(goal.constraintObj),
      range: formatRange(goal.constraintObj.range?.[0]),
      type: 'type' in goal ? goal.type : undefined,
    }
  }

  /** @param {Agda._InteractionPoint} interactionPoint */
  function summarizeInteractionPoint(interactionPoint) {
    return {
      id: interactionPoint.id,
      range: formatRange(interactionPoint.range?.[0]),
    }
  }

  /**
   * @param {import('@codemirror/state').Range<Decoration>[]} decos
   * @param {(number | string)[]} ids
   */
  function summarizeLegacyInteractionPoints(decos, ids) {
    return decos.map((deco, idx) => {
      const line = editorView.state.doc.lineAt(deco.from)
      return {
        id: ids[idx] ?? deco.value.spec.id ?? '?',
        range: `${line.number}:${deco.from - line.from + 1}`,
      }
    })
  }

  /** @param {Agda._Info} info */
  function formatDisplayInfo(info) {
    switch (info.kind) {
      case 'Error':
        return info.error.message
      case 'AllGoalsWarnings': {
        const parts = []
        for (const err of info.errors ?? []) parts.push(err.message)
        for (const warning of info.warnings ?? []) parts.push(warning.message)
        for (const goal of info.visibleGoals ?? []) parts.push(formatConstraint(goal))
        for (const goal of info.invisibleGoals ?? []) parts.push(formatConstraint(goal))
        return parts.join('\n\n')
      }
      case 'GoalSpecific':
        if (info.goalInfo?.kind === 'GoalType') return info.goalInfo.type
        return JSON.stringify(info.goalInfo)
      case 'Version':
        return info.version
      default:
        return JSON.stringify(info)
    }
  }

  /** @param {string} message */
  function isAgdaInternalErrorMessage(message) {
    return message.includes('An internal error has occurred') ||
      message.includes('__IMPOSSIBLE_VERBOSE__')
  }

  /**
   * @param {number} interactionPoint
   * @param {string} replacement
   */
  function replaceGoal(interactionPoint, replacement) {
    const fallbackGoal = controller.pendingGiveGoal?.id === interactionPoint ? controller.pendingGiveGoal : undefined
    const range = getGoalRangeById(editorView.state, interactionPoint) ?? fallbackGoal
    if (!range) {
      emitMessage(`Could not find goal ${interactionPoint} in the editor.`)
      return
    }
    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
      selection: { anchor: range.from + replacement.length },
      effects: removeGoalInfo.of(interactionPoint),
    })
  }

  /**
   * Implements agda-mode-vscode's GiveNoParen/GiveParen behavior: keep the
   * goal content, optionally parenthesized, then remove `{!` and `!}`.
   *
   * @param {number} interactionPoint
   * @param {boolean} paren
   */
  function removeGoalBoundary(interactionPoint, paren) {
    const fallbackGoal = controller.pendingGiveGoal?.id === interactionPoint ? controller.pendingGiveGoal : undefined
    const range = getGoalRangeById(editorView.state, interactionPoint) ?? fallbackGoal
    if (!range) {
      emitMessage(`Could not find goal ${interactionPoint} in the editor.`)
      return
    }

    const goalText = editorView.state.doc.sliceString(range.from, range.to)
    const match = goalText.match(/^\{!\s*([\s\S]*?)\s*!\}$/)
    const content = match ? match[1] : goalText
    const replacement = paren ? `(${content})` : content

    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
      selection: { anchor: range.from + replacement.length },
      effects: removeGoalInfo.of(interactionPoint),
    })
  }

  /**
   * @param {{from: number, to: number}} goal
   * @param {string[]} clauses
   */
  function replaceGoalClause(goal, clauses) {
    const doc = editorView.state.doc
    const startLine = doc.lineAt(goal.from)
    const linePrefix = doc.sliceString(startLine.from, goal.from)
    const indentation = linePrefix.match(/^\s*/)?.[0] ?? ''
    const replacement = indentation + clauses
      .map(clause => clause.replace(/\?/g, '{!   !}'))
      .join('\n' + indentation)

    editorView.dispatch({
      changes: { from: startLine.from, to: goal.to, insert: replacement },
      selection: { anchor: startLine.from },
    })
    editorView.dom.dispatchEvent(new CustomEvent('agda-reload-needed', {
      bubbles: true,
      detail: { reason: 'case-split' },
    }))
  }

  /** @param {number | Agda._InteractionPoint} interactionPoint */
  function getInteractionPointId(interactionPoint) {
    return typeof interactionPoint === 'number' ? interactionPoint : interactionPoint.id
  }

  /** @type {Partial<Record<ALSResponseType, (this: ALSMessageRouter, contents: any) => void>>} */
  const handlers = {
    ResponseStatus([checked, showImplicitArgs]) {
      controller.checked = checked
      controller.showImplicitArgs = showImplicitArgs
      // controller.showIrrelevantArgs = showIrrelevantArgs
    },
    ResponseClearHighlightingTokenBased() {
      // @ts-ignore
      return rawJsonHandlers.ClearHighlighting({ tokenBased: 'TokenBased' })
    },
    ResponseClearHighlightingNotOnlyTokenBased() {
      // @ts-ignore
      return rawJsonHandlers.ClearHighlighting({ tokenBased: 'NotOnlyTokenBased' })
    },
    ResponseHighlightingInfoDirect(contents) {
      const infos = alsHighlightingInfosDirectSchema.decode(contents)
      // @ts-ignore
      return rawJsonHandlers.HighlightingInfo(infos)
    },
    ResponseInteractionPoints(contents) {
      const ids = alsInteractionPointsSchema.decode(contents)
      /** @type {import("@codemirror/state").Range<Decoration>[]} */
      const decos = []

      // we can map CM's data back to Agda's ranges but it is too much work
      const holes = editorView.state.field(highlightState).otherAspects.update({
        filter: (_ff, _tt, value) => value.spec.isHole
      })

      // we do not rely on the property that filter is queried in order
      if (holes.size !== ids.length) {
        throw new Error(`mismatched numbers of interaction points ${ids.length} and holes ${holes.size}`)
      }

      for (let it = holes.iter(), idx = 0; it.value !== null; it.next()) {
        const { value, from, to } = it
        value.spec.id = ids[idx++]
        decos.push(value.range(from, to))
      }

      editorView.dispatch({
        effects: [
          setGoals.of(decos),
          setGoalInfo.of(summarizeLegacyInteractionPoints(decos, ids)),
        ],
      })
    },
    ResponseJSONRaw(/** @type {Agda._Resp} */contents) {
      const handler = rawJsonHandlers[contents.kind]
      if (handler) {
        return handler(/** @type {any} */(contents))
      }
      console.warn('unrecognized raw response', contents)
    }
  }

  /** @type {Partial<{[k in Agda._Resp['kind']]: (resp: Extract<Agda._Resp, {kind: k}>) => void}>} */
  const rawJsonHandlers = {
    Status({ status: { checked, showImplicitArguments, showIrrelevantArguments }}) {
      controller.checked = checked
      controller.showImplicitArgs = showImplicitArguments
      controller.showIrrelevantArgs = showIrrelevantArguments
    },
    ClearRunningInfo() {
      editorView.dispatch({ effects: clearRunningInfo.of() })
    },
    RunningInfo({ message, debugLevel }) {
      editorView.dispatch({ effects: emitRunningInfo.of({ message, debugLevel }) })
    },
    DisplayInfo({ info }) {
      if (info.kind === 'AllGoalsWarnings') {
        editorView.dispatch({
          effects: setGoalInfo.of([
            ...(info.visibleGoals ?? []),
            ...(info.invisibleGoals ?? []),
          ].map(summarizeGoal)),
        })
      } else if (info.kind === 'GoalSpecific') {
        editorView.dispatch({
          effects: setGoalInfo.of([{
            id: info.interactionPoint.id,
            range: formatRange(info.interactionPoint.range?.[0]),
            type: info.goalInfo?.kind === 'GoalType' ? info.goalInfo.type : undefined,
          }]),
        })
      }
      const message = formatDisplayInfo(info)
      if (isAgdaInternalErrorMessage(message)) {
        controller.lastAgdaInternalError = message
        console.warn('Suppressed Agda internal error:', message)
        return
      }
      if (info.kind === 'Error' || info.kind === 'AllGoalsWarnings' && (info.errors?.length ?? 0) > 0) {
        controller.lastAgdaError = message
      }
      emitMessage(message)
    },
    ClearHighlighting({ tokenBased }) {
      // Agda (~2.8)'s codebase does not contain any instance of (Resp_ClearHighlighting TokenBased)
      if (tokenBased === 'TokenBased') {
        throw new Error('(ClearHighlighting TokenBased) is not implemented')
        // editorView.dispatch({
        //   effects: clearHighlight.of(true),
        // })
      } else {
        // clear not-only-token-based
        editorView.dispatch({
          effects: clearHighlight.of(false),
        })
      }
    },
    HighlightingInfo({ direct, info }) {
      if (!direct) {
        throw new Error('indrect highlighting is not implemented')
      }
      // Agda (~2.8)'s codebase does not contain any instance of (Resp_HighlightingInfo ... RemoveHighlighting)
      if (info.remove) {
        editorView.dispatch({
          effects: clearHighlight.of(true)
        })
      }
      editorView.dispatch({
        effects: buildHighlightEffects(editorView.state, info.payload)
      })
    },
    InteractionPoints({ interactionPoints }) {
      const transaction = buildGoalTransaction(editorView.state, interactionPoints)
      const effects = Array.isArray(transaction.effects) ?
        transaction.effects :
        transaction.effects ? [transaction.effects] : []
      editorView.dispatch({
        ...transaction,
        effects: [
          ...effects,
          setGoalInfo.of(interactionPoints.map(summarizeInteractionPoint)),
        ],
      })
    },
    GiveAction({ interactionPoint, giveResult }) {
      const interactionPointId = getInteractionPointId(interactionPoint)
      if ('str' in giveResult) {
        replaceGoal(interactionPointId, giveResult.str)
      } else if ('paren' in giveResult) {
        removeGoalBoundary(interactionPointId, Boolean(giveResult.paren))
      } else {
        console.warn('unhandled give action', giveResult)
      }
      controller.pendingGiveGoal = undefined
    },
    MakeCase({ clauses }) {
      const renderedClauses = clauses.map(String)
      if (!renderedClauses.length) return

      const goal = controller.pendingCaseSplitGoal
      controller.pendingCaseSplitGoal = undefined
      if (goal) {
        replaceGoalClause(goal, renderedClauses)
      } else {
        emitMessage(renderedClauses.join('\n'))
      }
    }
  }

  return handlers
}
