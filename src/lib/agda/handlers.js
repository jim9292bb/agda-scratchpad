import { clearHighlight, clearRunningInfo, emitRunningInfo, setGoalInfo } from './effects'
import { alsHighlightingInfosDirectSchema, alsInteractionPointsSchema } from './schema'
import { buildHighlightEffects, highlightState } from './highlight'
import { buildGoalTransaction, buildLegacyGoalTransaction } from './goals'
import { getAgdaDocumentVersion } from './goal-state'
import { removeGoalBoundary, replaceGoal, replaceGoalClause } from './editor-mutations'
import { focusAgdaUtf8Position, parseAgdaDiagnostic } from './diagnostics'

/** @import { EditorView } from '@codemirror/view' */
/** @import { ALSMessageRouter } from './transport' */

/** @typedef Controller
 * @prop {boolean} checked
 * @prop {boolean} showImplicitArgs
 * @prop {boolean} showIrrelevantArgs
 * @prop {boolean} suppressAgdaInternalErrors
 * @prop {boolean} suppressDisplayInfo
 * @prop {string | null} lastAgdaInternalError
 * @prop {string | null} lastAgdaError
 * @prop {import('./diagnostics').AgdaDiagnostic[]} lastAgdaDiagnostics
 * @prop {{filepath: string, position: number, cmPosition?: number} | null} lastJumpToError
 * @prop {{id: number, from: number, to: number, text: string} | undefined} [pendingCaseSplitGoal]
 * @prop {{id: number, from: number, to: number, text: string} | undefined} [pendingGiveGoal]
 * @prop {number | null} activeDocumentVersion
 * @prop {(documentVersion: number) => boolean} acceptsDocumentVersion
 * @prop {(documentVersion: number) => void} acceptDocumentVersion
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

  /** @param {string} responseKind */
  function shouldAcceptEditorResponse(responseKind) {
    const documentVersion = getAgdaDocumentVersion(editorView.state)
    if (controller.acceptsDocumentVersion(documentVersion)) return true

    console.warn(`Ignored stale Agda ${responseKind} response`, {
      activeDocumentVersion: controller.activeDocumentVersion,
      currentDocumentVersion: documentVersion,
    })
    return false
  }

  function acceptCurrentDocumentVersion() {
    controller.acceptDocumentVersion(getAgdaDocumentVersion(editorView.state))
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

  /** @param {Agda._ContextEntry[]} entries */
  function formatContextEntries(entries) {
    return entries
      .filter(entry => entry.inScope)
      .map(entry => `${entry.reifiedName || entry.originalName} : ${entry.binding}`)
      .join('\n')
  }

  /** @param {Agda._GoalInfo | undefined} goalInfo */
  function summarizeGoalInfo(goalInfo) {
    if (goalInfo?.kind !== 'GoalType') return {}
    return {
      type: goalInfo.type,
      context: formatContextEntries(goalInfo.entries ?? []),
    }
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

  /** @param {number | Agda._InteractionPoint} interactionPoint */
  function getInteractionPointId(interactionPoint) {
    return typeof interactionPoint === 'number' ? interactionPoint : interactionPoint.id
  }

  /** @param {import('./diagnostics').AgdaDiagnostic | null} diagnostic */
  function isAgdaDiagnostic(diagnostic) {
    return diagnostic != null
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
      if (!shouldAcceptEditorResponse('InteractionPoints')) return
      const ids = alsInteractionPointsSchema.decode(contents)

      // we can map CM's data back to Agda's ranges but it is too much work
      const holes = editorView.state.field(highlightState).otherAspects.update({
        filter: (_ff, _tt, value) => value.spec.isHole
      })

      editorView.dispatch({
        ...buildLegacyGoalTransaction(editorView.state, holes, ids),
      })
      acceptCurrentDocumentVersion()
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
      const stale = !shouldAcceptEditorResponse('DisplayInfo')
      if (info.kind === 'AllGoalsWarnings') {
        if (!stale) {
          editorView.dispatch({
            effects: setGoalInfo.of([
              ...(info.visibleGoals ?? []),
              ...(info.invisibleGoals ?? []),
            ].map(summarizeGoal)),
          })
          acceptCurrentDocumentVersion()
        }
      } else if (info.kind === 'GoalSpecific') {
        if (!stale) {
          const goalInfo = summarizeGoalInfo(info.goalInfo)
          editorView.dispatch({
            effects: setGoalInfo.of([{
              id: info.interactionPoint.id,
              range: formatRange(info.interactionPoint.range?.[0]),
              ...goalInfo,
            }]),
          })
          acceptCurrentDocumentVersion()
        }
      }
      const message = formatDisplayInfo(info)
      if (stale) return
      if (isAgdaInternalErrorMessage(message)) {
        controller.lastAgdaInternalError = message
        console.warn('Suppressed Agda internal error:', message)
        return
      }
      if (info.kind === 'Error' || info.kind === 'AllGoalsWarnings' && (info.errors?.length ?? 0) > 0) {
        controller.lastAgdaError = message
        controller.lastAgdaDiagnostics = message
          .split(/\n\n+/)
          .map(parseAgdaDiagnostic)
          .filter(isAgdaDiagnostic)
      }
      if (!controller.suppressDisplayInfo) emitMessage(message)
    },
    JumpToError({ filepath, position }) {
      if (!shouldAcceptEditorResponse('JumpToError')) return
      if (filepath !== '/source.agda') {
        controller.lastJumpToError = { filepath, position }
        return
      }
      const cmPosition = focusAgdaUtf8Position(editorView, position)
      controller.lastJumpToError = { filepath, position, cmPosition }
    },
    ClearHighlighting({ tokenBased }) {
      if (!shouldAcceptEditorResponse('ClearHighlighting')) return
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
        acceptCurrentDocumentVersion()
      }
    },
    HighlightingInfo({ direct, info }) {
      if (!shouldAcceptEditorResponse('HighlightingInfo')) return
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
      acceptCurrentDocumentVersion()
    },
    InteractionPoints({ interactionPoints }) {
      if (!shouldAcceptEditorResponse('InteractionPoints')) return
      const transaction = buildGoalTransaction(editorView.state, interactionPoints)
      editorView.dispatch({
        ...transaction,
      })
      acceptCurrentDocumentVersion()
    },
    GiveAction({ interactionPoint, giveResult }) {
      if (!shouldAcceptEditorResponse('GiveAction')) {
        controller.pendingGiveGoal = undefined
        return
      }
      const interactionPointId = getInteractionPointId(interactionPoint)
      const fallbackGoal = controller.pendingGiveGoal?.id === interactionPointId
        ? controller.pendingGiveGoal
        : undefined
      let replaced = true
      if ('str' in giveResult) {
        replaced = replaceGoal(editorView, interactionPointId, giveResult.str, fallbackGoal)
      } else if ('paren' in giveResult) {
        replaced = removeGoalBoundary(editorView, interactionPointId, Boolean(giveResult.paren), fallbackGoal)
      } else {
        console.warn('unhandled give action', giveResult)
      }
      if (!replaced) emitMessage(`Could not find goal ${interactionPointId} in the editor.`)
      controller.pendingGiveGoal = undefined
      acceptCurrentDocumentVersion()
    },
    MakeCase({ clauses }) {
      if (!shouldAcceptEditorResponse('MakeCase')) {
        controller.pendingCaseSplitGoal = undefined
        return
      }
      const renderedClauses = clauses.map(String)
      if (!renderedClauses.length) return

      const goal = controller.pendingCaseSplitGoal
      controller.pendingCaseSplitGoal = undefined
      if (goal) {
        replaceGoalClause(editorView, goal, renderedClauses)
      } else {
        emitMessage(renderedClauses.join('\n'))
      }
      acceptCurrentDocumentVersion()
    }
  }

  return handlers
}
