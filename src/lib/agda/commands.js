/**
 * Browser-side Agda interaction command builders.
 *
 * These mirror agda-mode-vscode's Request encoder for Agda 2.8, but return
 * only the inner command because AgdaController wraps it in IOTCM.
 */

/** @typedef {'AsIs' | 'Simplified' | 'Instantiated' | 'Normalised' | 'HeadNormal'} Normalization */
/** @typedef {'DefaultCompute' | 'IgnoreAbstract' | 'UseShowInstance'} ComputeMode */

/**
 * @typedef AgdaCommandGoal
 * @prop {number} id
 */

/** @param {string} content */
function quoted(content) {
  return JSON.stringify(content)
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 */
export function goalTypeCommand(normalization, goal) {
  return `(Cmd_goal_type ${normalization} ${goal.id} noRange "")`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 */
export function contextCommand(normalization, goal) {
  return `(Cmd_context ${normalization} ${goal.id} noRange "")`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 */
export function goalTypeContextCommand(normalization, goal) {
  return `(Cmd_goal_type_context ${normalization} ${goal.id} noRange "")`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function goalTypeContextInferCommand(normalization, goal, content) {
  return `(Cmd_goal_type_context_infer ${normalization} ${goal.id} noRange ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function goalTypeContextCheckCommand(normalization, goal, content) {
  return `(Cmd_goal_type_context_check ${normalization} ${goal.id} noRange ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {string} content
 */
export function searchAboutToplevelCommand(normalization, content) {
  return `(Cmd_search_about_toplevel ${normalization} ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function moduleContentsCommand(normalization, goal, content) {
  return `(Cmd_show_module_contents ${normalization} ${goal.id} noRange ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {string} content
 */
export function moduleContentsToplevelCommand(normalization, content) {
  return `(Cmd_show_module_contents_toplevel ${normalization} ${quoted(content)})`
}

/**
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function whyInScopeCommand(goal, content) {
  return `(Cmd_why_in_scope ${goal.id} noRange ${quoted(content)})`
}

/** @param {string} content */
export function whyInScopeToplevelCommand(content) {
  return `(Cmd_why_in_scope_toplevel ${quoted(content)})`
}

/**
 * @param {AgdaCommandGoal} goal
 * @param {string} range
 * @param {string} content
 */
export function giveCommand(goal, range, content) {
  return `(Cmd_give WithoutForce ${goal.id} ${range} ${quoted(content)})`
}

/**
 * @param {AgdaCommandGoal} goal
 * @param {string} range
 * @param {string} content
 */
export function refineCommand(goal, range, content) {
  return `(Cmd_refine_or_intro False ${goal.id} ${range} ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} range
 * @param {string} content
 */
export function autoOneCommand(normalization, goal, range, content) {
  return `(Cmd_autoOne ${normalization} ${goal.id} ${range} ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function elaborateGiveCommand(normalization, goal, content) {
  return `(Cmd_elaborate_give ${normalization} ${goal.id} noRange ${quoted(content)})`
}

/**
 * @param {AgdaCommandGoal} goal
 * @param {string} range
 * @param {string} content
 */
export function makeCaseCommand(goal, range, content) {
  return `(Cmd_make_case ${goal.id} ${range} ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function helperFunctionCommand(normalization, goal, content) {
  return `(Cmd_helper_function ${normalization} ${goal.id} noRange ${quoted(content)})`
}

/**
 * @param {Normalization} normalization
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function inferCommand(normalization, goal, content) {
  return `(Cmd_infer ${normalization} ${goal.id} noRange ${quoted(content)})`
}

/**
 * @param {ComputeMode} computeMode
 * @param {AgdaCommandGoal} goal
 * @param {string} content
 */
export function computeCommand(computeMode, goal, content) {
  return `(Cmd_compute ${computeMode} ${goal.id} noRange ${quoted(content)})`
}
