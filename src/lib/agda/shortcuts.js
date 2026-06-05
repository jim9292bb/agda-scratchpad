/**
 * Data-driven Agda shortcut registry.
 *
 * The registry owns shortcut identity and default bindings. UI code remains
 * responsible for executing commands because it has access to editor/controller
 * state.
 */

/**
 * @typedef AgdaShortcutBinding
 * @prop {'chord' | 'keymap'} kind
 * @prop {string} key
 * @prop {string} [code]
 * @prop {boolean} [ctrl]
 * @prop {string} label
 */

/**
 * @typedef AgdaShortcutDefinition
 * @prop {string} id
 * @prop {string} label
 * @prop {AgdaShortcutBinding[]} bindings
 */

/** @type {readonly AgdaShortcutDefinition[]} */
export const agdaShortcutRegistry = Object.freeze([
  {
    id: 'load',
    label: 'Load',
    bindings: [
      { kind: 'chord', key: 'l', ctrl: true, label: 'Ctrl-c Ctrl-l' },
      { kind: 'keymap', key: 'Mod-Enter', label: 'Cmd-Enter' },
    ],
  },
  {
    id: 'next-goal',
    label: 'Next goal',
    bindings: [{ kind: 'chord', key: 'f', ctrl: true, label: 'Ctrl-c Ctrl-f' }],
  },
  {
    id: 'previous-goal',
    label: 'Previous goal',
    bindings: [{ kind: 'chord', key: 'b', ctrl: true, label: 'Ctrl-c Ctrl-b' }],
  },
  {
    id: 'goal-type',
    label: 'Goal type',
    bindings: [{ kind: 'chord', key: 't', ctrl: true, label: 'Ctrl-c Ctrl-t' }],
  },
  {
    id: 'context',
    label: 'Context',
    bindings: [{ kind: 'chord', key: 'e', ctrl: true, label: 'Ctrl-c Ctrl-e' }],
  },
  {
    id: 'goal-type-context',
    label: 'Goal type and context',
    bindings: [{ kind: 'chord', key: ',', ctrl: true, label: 'Ctrl-c Ctrl-,' }],
  },
  {
    id: 'goal-type-context-infer',
    label: 'Goal type, context and inferred type',
    bindings: [{ kind: 'chord', key: '.', ctrl: true, label: 'Ctrl-c Ctrl-.' }],
  },
  {
    id: 'goal-type-context-check',
    label: 'Goal type, context and checked type',
    bindings: [{ kind: 'chord', key: ';', ctrl: true, label: 'Ctrl-c Ctrl-;' }],
  },
  {
    id: 'give',
    label: 'Give',
    bindings: [
      { kind: 'chord', key: ' ', code: 'Space', ctrl: true, label: 'Ctrl-c Ctrl-Space' },
      { kind: 'chord', key: ' ', code: 'Space', label: 'Ctrl-c Space' },
    ],
  },
  {
    id: 'refine',
    label: 'Refine',
    bindings: [{ kind: 'chord', key: 'r', ctrl: true, label: 'Ctrl-c Ctrl-r' }],
  },
  {
    id: 'auto',
    label: 'Auto',
    bindings: [{ kind: 'chord', key: 'a', ctrl: true, label: 'Ctrl-c Ctrl-a' }],
  },
  {
    id: 'elaborate-give',
    label: 'Elaborate and give',
    bindings: [{ kind: 'chord', key: 'm', ctrl: true, label: 'Ctrl-c Ctrl-m' }],
  },
  {
    id: 'helper-function',
    label: 'Helper function type',
    bindings: [{ kind: 'chord', key: 'h', ctrl: true, label: 'Ctrl-c Ctrl-h' }],
  },
  {
    id: 'case-split',
    label: 'Case split',
    bindings: [{ kind: 'chord', key: 'c', ctrl: true, label: 'Ctrl-c Ctrl-c' }],
  },
  {
    id: 'compute',
    label: 'Compute',
    bindings: [{ kind: 'chord', key: 'n', ctrl: true, label: 'Ctrl-c Ctrl-n' }],
  },
  {
    id: 'infer',
    label: 'Infer type',
    bindings: [{ kind: 'chord', key: 'd', ctrl: true, label: 'Ctrl-c Ctrl-d' }],
  },
  {
    id: 'search-about',
    label: 'Search about',
    bindings: [{ kind: 'chord', key: 'z', ctrl: true, label: 'Ctrl-c Ctrl-z' }],
  },
  {
    id: 'module-contents',
    label: 'Module contents',
    bindings: [{ kind: 'chord', key: 'o', ctrl: true, label: 'Ctrl-c Ctrl-o' }],
  },
  {
    id: 'why-in-scope',
    label: 'Why in scope',
    bindings: [{ kind: 'chord', key: 'w', ctrl: true, label: 'Ctrl-c Ctrl-w' }],
  },
])

/**
 * @param {KeyboardEvent} event
 * @param {string} key
 */
export function isAgdaCtrlKey(event, key) {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === key
}

/** @param {KeyboardEvent} event */
function isSpaceEvent(event) {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space'
}

/**
 * @param {KeyboardEvent} event
 * @param {AgdaShortcutBinding} binding
 */
function matchesBinding(event, binding) {
  if (event.altKey || event.metaKey) return false

  if (binding.key === ' ') {
    return Boolean(binding.ctrl) === event.ctrlKey && isSpaceEvent(event)
  }

  return Boolean(binding.ctrl) === event.ctrlKey &&
    event.key.toLowerCase() === binding.key.toLowerCase()
}

/**
 * @param {KeyboardEvent} event
 * @returns {AgdaShortcutDefinition | undefined}
 */
export function findAgdaChordShortcut(event) {
  return agdaShortcutRegistry.find(shortcut =>
    shortcut.bindings.some(binding => binding.kind === 'chord' && matchesBinding(event, binding)))
}

/**
 * @param {AgdaShortcutDefinition} shortcut
 * @returns {string}
 */
export function formatAgdaShortcutHelpBinding(shortcut) {
  return shortcut.bindings.map(binding => binding.label).join(' / ')
}
