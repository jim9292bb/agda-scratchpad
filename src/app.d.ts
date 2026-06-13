// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  const APP_REPO_URL: string
  const APP_COMMIT_ID: string
}

declare global {
namespace Agda {
  type _IsTokenBased = 'TokenBased' | 'NotOnlyTokenBased'
  type _Rewrite = 'AsIs' | 'Instantiated' | 'HeadNormal' | 'Simplified' | 'Normalised'

  type _Range = { start: _Position, end: _Position }
  type _Position = { col: number, line: number, pos: number }

  type Version = {
    kind: 'Version',
    version: string,
  }

  // see: instance EncodeTCM DisplayInfo where
  type _Info =
  // | CompilationOk
  // | Constraints
  | AllGoalsWarnings
  // | Time
  | Error
  // | Intro_NotFound
  // | Intro_ConstructorUnknown
  | Auto
  | ModuleContents
  | SearchAbout
  | WhyInScope
  | NormalForm
  | InferredType
  // | Context
  | Version
  | GoalSpecific

  type _ConstraintObj = { range: _Range[] } & (
    { name: string } | { id: number })

  type OfType = {
    kind: 'OfType',
    constraintObj: _ConstraintObj,
    type: string,
  }

  type JustSort = {
    kind: 'JustSort',
    constraintObj: _ConstraintObj,
  }

  type GoalSpecific = {
    kind: 'GoalSpecific',
    interactionPoint: _InteractionPoint,
    goalInfo: _GoalInfo,
  }

  type _GoalInfo =
  | GoalType
  | GoalNormalForm
  | GoalInferredType
  | GoalCurrentGoal
  | GoalHelperFunction

  type GoalType = {
    kind: 'GoalType',
    rewrite: _Rewrite,
    typeAux: _GoalTypeAux,
    type: string,
    entries: _ContextEntry[],
    boundary: unknown[],
    outputForms: unknown[],
  }

  type _ContextEntry = {
    originalName: string,
    reifiedName: string,
    binding: string,
    inScope: boolean,
  }

  type _GoalTypeAux =
  | GoalOnly
  | GoalAndHave
  | GoalAndElaboration

  type GoalOnly = { kind: 'GoalOnly' }
  type GoalAndHave = { kind: 'GoalAndHave', expr: string }
  type GoalAndElaboration = { kind: 'GoalAndElaboration', term: string }

  type GoalNormalForm = { kind: 'NormalForm', computeMode: unknown, expr: string }
  type GoalInferredType = { kind: 'InferredType', expr: string }
  type GoalCurrentGoal = { kind: 'CurrentGoal', rewrite: _Rewrite, type: string }
  type GoalHelperFunction = { kind: 'HelperFunction', signature: string }

  type Auto = { kind: 'Auto', info: string }
  type WhyInScope = { kind: 'WhyInScope', thing: string, filepath: string | null, message: string }
  type NormalForm = { kind: 'NormalForm', commandState: unknown, computeMode: unknown, time: unknown, expr: string }
  type InferredType = { kind: 'InferredType', commandState: unknown, time: unknown, expr: string }
  type SearchAbout = { kind: 'SearchAbout', results: { name: string, term: string }[], search: string }
  type ModuleContents = { kind: 'ModuleContents', contents: { name: string, term: string }[], names: string[], telescope: unknown[] }

  type AllGoalsWarnings = {
    kind: 'AllGoalsWarnings',
    errors: { message: string }[],
    warnings: { message: string }[],
    visibleGoals: OfType[],
    invisibleGoals: (OfType | JustSort)[],
  }

  type Error = {
    kind: 'Error',
    error: {
      message: string,
    },
    warnings: unknown[],
  }

  type HighlightingInfoItem = {
    atoms: string[],
    definitionSite: null | { filepath: string, position: number },
    note: string,
    range: [number, number],
    tokenBased: _IsTokenBased,
  }

  type HighlightingInfo = {
    kind: 'HighlightingInfo',
    info: {
      payload: HighlightingInfoItem[],
      remove: boolean,
    },
    direct: boolean,
  }

  type DisplayInfo = {
    kind: 'DisplayInfo',
    info: _Info,
  }

  type ClearHighlighting = {
    kind: 'ClearHighlighting',
    tokenBased: _IsTokenBased,
  }

  type DoneAborting = { kind: 'DoneAborting' }
  type DoneExiting = { kind: 'DoneExiting' }
  type ClearRunningInfo = { kind: 'ClearRunningInfo' }

  type RunningInfo = {
    kind: 'RunningInfo',
    debugLevel: number,
    message: string,
  }

  type Status = {
    kind: 'Status',
    status: {
      checked: boolean,
      showImplicitArguments: boolean,
      showIrrelevantArguments: boolean,
    },
  }

  type JumpToError = {
    kind: 'JumpToError',
    filepath: string,
    position: number,
  }

  type _InteractionPoint = {
    id: number,
    range: [_Range],
  }

  type InteractionPoints = {
    kind: 'InteractionPoints',
    interactionPoints: _InteractionPoint[],
  }

  type GiveAction = {
    kind: 'GiveAction',
    interactionPoint: number,
    giveResult: _GiveResult,
  }

  type _GiveResult = { str: string } | { paren: boolean }

  type MakeCase = {
    kind: 'MakeCase',
    interactionPoint: number,
    variant: unknown,
    clauses: unknown[],
  }

  type SolveAll = {
    kind: 'SolveAll',
    solutions: unknown[],
  }

  // see Agda/Interaction/JSONTop.hs: instance EncodeTCM Response where
  type _Resp =
  | HighlightingInfo
  | DisplayInfo
  | ClearHighlighting
  | DoneAborting
  | DoneExiting
  | ClearRunningInfo
  | RunningInfo
  | Status
  | JumpToError
  | InteractionPoints
  | GiveAction
  | MakeCase
  | SolveAll

  type _Interaction =
    | 'Cmd_load' | 'Cmd_compile' | 'Cmd_constraints' | 'Cmd_metas' | 'Cmd_no_metas'
    | 'Cmd_show_module_contents_toplevel' | 'Cmd_search_about_toplevel' | 'Cmd_solveAll'
    | 'Cmd_solveOne' | 'Cmd_autoOne' | 'Cmd_autoAll' | 'Cmd_infer_toplevel'
    | 'Cmd_compute_toplevel'
    // highlighting
    | 'Cmd_load_highlighting_info' | 'Cmd_tokenHighlighting' | 'Cmd_highlight'
    // implicit/irrelevant args
    | 'ShowImplicitArgs' | 'ToggleImplicitArgs' | 'ShowIrrelevantArgs' | 'ToggleIrrelevantArgs'
    // goal commands
    | 'Cmd_give' | 'Cmd_refine' | 'Cmd_intro' | 'Cmd_refine_or_intro' | 'Cmd_context'
    | 'Cmd_helper_function' | 'Cmd_infer' | 'Cmd_goal_type' | 'Cmd_elaborate_give'
    | 'Cmd_goal_type_context' | 'Cmd_goal_type_context_infer' | 'Cmd_goal_type_context_check'
    | 'Cmd_show_module_contents' | 'Cmd_make_case' | 'Cmd_compute' | 'Cmd_why_in_scope'
    // others
    | 'Cmd_why_in_scope_toplevel' | 'Cmd_show_version' | 'Cmd_abort' | 'Cmd_exit'

}
}

export {}
