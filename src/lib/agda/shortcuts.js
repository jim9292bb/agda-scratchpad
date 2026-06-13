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
 * @param {string} key
 * @returns {string}
 */
function displayKey(key) {
  if (key === ' ') return 'Space'
  return key.length === 1 ? key : key[0].toUpperCase() + key.slice(1)
}

/**
 * @param {AgdaShortcutBinding} binding
 * @returns {string}
 */
function chordIdentity(binding) {
  return `${binding.ctrl ? 'ctrl+' : ''}${binding.key.toLowerCase()}`
}

/**
 * @param {string} input
 * @returns {AgdaShortcutBinding | null}
 */
export function parseAgdaChordBinding(input) {
  const normalized = input.trim().replace(/\s+/g, ' ')
    .replace(/^C-c\b/i, 'Ctrl-c')
    .replace(/\bC-/gi, 'Ctrl-')

  const match = /^Ctrl-c (Ctrl-)?(.+)$/i.exec(normalized)
  if (!match) return null

  const ctrl = Boolean(match[1])
  const rawKey = match[2].trim()
  const keyName = rawKey.toLowerCase()
  const key = keyName === 'space' || keyName === 'spc' ? ' ' : rawKey
  if (key !== ' ' && key.length !== 1) return null

  const binding = /** @type {AgdaShortcutBinding} */ ({
    kind: 'chord',
    key,
    ctrl,
    label: `Ctrl-c ${ctrl ? 'Ctrl-' : ''}${displayKey(key)}`,
  })
  if (key === ' ') binding.code = 'Space'
  return binding
}

/**
 * @param {Record<string, string>} overrides
 * @returns {AgdaShortcutDefinition[]}
 */
export function createAgdaShortcutRegistry(overrides = {}) {
  return agdaShortcutRegistry.map(shortcut => {
    const override = overrides[shortcut.id]
    const binding = typeof override === 'string' ? parseAgdaChordBinding(override) : null
    if (!binding) return shortcut

    return {
      ...shortcut,
      bindings: [
        binding,
        ...shortcut.bindings.filter(defaultBinding => defaultBinding.kind !== 'chord'),
      ],
    }
  })
}

/**
 * @param {Record<string, string>} overrides
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAgdaShortcutOverrides(overrides) {
  const errors = []
  for (const [id, value] of Object.entries(overrides)) {
    if (!value.trim()) continue
    if (!parseAgdaChordBinding(value)) {
      errors.push(`${id}: use a chord such as Ctrl-c Ctrl-g or Ctrl-c Space.`)
    }
  }

  const seen = new Map()
  for (const shortcut of createAgdaShortcutRegistry(overrides)) {
    for (const binding of shortcut.bindings.filter(binding => binding.kind === 'chord')) {
      const identity = chordIdentity(binding)
      const previous = seen.get(identity)
      if (previous && previous !== shortcut.id) {
        errors.push(`${binding.label} is assigned to both ${previous} and ${shortcut.id}.`)
      } else {
        seen.set(identity, shortcut.id)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

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
 * @param {readonly AgdaShortcutDefinition[]} [registry]
 * @returns {AgdaShortcutDefinition | undefined}
 */
export function findAgdaChordShortcut(event, registry = agdaShortcutRegistry) {
  return registry.find(shortcut =>
    shortcut.bindings.some(binding => binding.kind === 'chord' && matchesBinding(event, binding)))
}

/**
 * @param {AgdaShortcutDefinition} shortcut
 * @returns {string}
 */
export function formatAgdaShortcutHelpBinding(shortcut) {
  const binding = shortcut.bindings.find(b => b.kind === 'chord') ?? shortcut.bindings[0]
  return binding.label.replace(/\bCtrl-/g, 'C-').replace(/\bSpace\b/g, 'SPC')
}
