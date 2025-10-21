import { Decoration } from '@codemirror/view'
import { clearHighlight, clearRunningInfo, emitRunningInfo, setGoals } from './effects'
import { alsHighlightingInfosDirectSchema, alsInteractionPointsSchema } from './schema'
import { buildHighlightEffects, highlightState } from './highlight'
import { buildGoalTransaction } from './goals'

/** @import { EditorView } from '@codemirror/view' */
/** @import { ALSMessageRouter } from './transport' */

/** @typedef Controller
 * @prop {boolean} checked
 * @prop {boolean} showImplicitArgs
 * @prop {boolean} showIrrelevantArgs
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
        effects: setGoals.of(decos),
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
      editorView.dispatch(buildGoalTransaction(editorView.state, interactionPoints))
    }
  }

  return handlers
}
