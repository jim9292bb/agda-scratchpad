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
  // FIXME: not complete
  type _Info =
  // | CompilationOk
  // | Constraints
  | AllGoalsWarnings
  // | Time
  | Error
  // | Intro_NotFound
  // | Intro_ConstructorUnknown
  // | Auto
  // | ModuleContents
  // | SearchAbout
  // | WhyInScope
  // | NormalForm
  // | InferredType
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
  // | HelperFunction
  // | NormalForm
  | GoalType
  // | CurrentGoal
  // | InferredType

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
}
}

export {}
