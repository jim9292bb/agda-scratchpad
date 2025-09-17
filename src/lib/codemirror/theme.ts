import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

// TODO: split baseTheme with (the real) theme
export const myBaseTheme = EditorView.baseTheme({
  '&': {
    border: '0 none',
    fontSize: '14px',
    '&.cm-focused': {
      outline: '0 none',
      // outlineOffset: '1px',
    },
  },
  '&.cm-editor': {
    borderRadius: '0',
    height: '100%',
  },
  '.cm-content, .cm-lineNumbers, .cm-gutterElement': {
    fontFamily: 'JuliaMono, monospace',
    // seems that more people love half-width arrows...
    // fontFeatureSettings: '"calt" off, "NWID" on',
  },
  '&dark .cm-activeLine': {
    backgroundColor: '#66666620',
  },
  '&dark .cm-activeLineGutter': {
    background: '#66666620',
  },
  '&dark .cm-selectionMatch.cm-selectionMatch': {
    // FIXME
    backgroundColor: 'transparent',
    outline: '1px solid #666666C0',
    borderRadius: '2px',
  },
  '&dark .cm-cursor': {
    borderLeftColor: '#bbb',
    borderLeftWidth: '2px',
  },
  '&dark .cm-foldPlaceholder.cm-foldPlaceholder': {
    // FIXME
    backgroundColor: '#333',
    borderColor: '#444',
  },

  '.cm-tooltip-section': {
    padding: '4px',
    marginTop: '4px',
    marginBottom: '0',
    borderTop: '1px solid #777',
  },

  '.cm-tooltip-section:first-child': {
    marginTop: '0',
    borderTop: 'none',
  },

  '.cm-tooltip.cm-tooltip-above': {
    marginBottom: '7px',
  },

  // helpers
  '.cm-agda-marks.hovered-keyword': {
    outline: '1px solid #ffffffc0',
    borderRadius: '2px',
  },
})

export function myCodeMirrorTheme(): Extension {
  return [
    myBaseTheme,
    EditorView.theme({
      '.cm-tooltip': {
        overflow: 'auto',
        zIndex: 500,  // must be > 300 (.cm-panels)
      },
      '.cm-tooltip.cm-tooltip-hover': {
        borderRadius: '2px',
        border: '1px solid #111',
      },
    }),
    EditorView.darkTheme.of(true),
  ]
}
