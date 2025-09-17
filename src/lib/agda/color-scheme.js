import { EditorView } from '@codemirror/view'

export const agdaDarkSchemeFromEmacs = EditorView.theme({
  // not a part of Agda's theme, but Emacs' built-in palette
  '.agda-hole': { background: '#556B2FC0' },  // DarkOliveGreen
  // make error markers opaque
  '.agda-error *': { color: 'currentColor !important' },

  // extracted from Agda's Emacs theme
  // definitions are from `Agda/Syntax/Common/Aspect.hs`
  // strings are from `toAtoms :: Aspects -> [String]`

  // -- aspects
  '.agda-comment':                  { color: '#999', fontStyle: 'italic' },
  '.agda-keyword':                  { color: '#FF9932' },
  '.agda-string':                   { color: '#DD4D4D' },
  '.agda-number':                   { color: '#9010E0' },
  //   hole; see above
  '.agda-symbol':                   { color: '#BFBFBF' },  // gray75
  '.agda-primitivetype':            { color: '#8080FF' },
  //   -- name kinds
  //     bound
  //     generalizable
    '.agda-inductiveconstructor':   { color: '#29CC29' },
    '.agda-coinductiveconstructor': { color: '#FFEA75' },
    '.agda-datatype':               { color: '#8080FF' },
    '.agda-field':                  { color: '#F570B7' },
    '.agda-function':               { color: '#8080FF' },
    '.agda-module':                 { color: '#CD80FF' },
    '.agda-postulate':              { color: '#8080FF' },
    '.agda-primitive':              { color: '#8080FF' },
    '.agda-record':                 { color: '#8080FF' },
  //     argument
    '.agda-macro':                  { color: '#73BAA2' },
  //   -- end of name kinds
  //   pragma, background, markup

  // -- "other" aspects
  '.agda-error':                    { color: '#FF0000' },
  '.agda-errorwarning':             { backgroundColor: '#80240080' },
  // dottedpattern
  '.agda-unsolvedmeta':             { backgroundColor: '#806B0080' },
  '.agda-unsolvedconstraint':       { backgroundColor: '#806B0080' },
  '.agda-terminationproblem':       { backgroundColor: '#80240080' },
  '.agda-positivityproblem':        { backgroundColor: '#803F0080' },
  '.agda-deadcode':                 { backgroundColor: '#80808080' },
  '.agda-shadowingintelescope':     { backgroundColor: '#80808080' },
  '.agda-coverageproblem':          { backgroundColor: '#80530080' },
  // incompletepattern
  '.agda-typechecks':               { color: 'white', backgroundColor: '#00608080' },
  '.agda-missingdefinition':        { backgroundColor: '#80404080' },
  '.agda-instanceproblem':          { backgroundColor: '#80530080' },
  '.agda-cosmeticproblem':          { backgroundColor: '#40404080' },
  '.agda-catchallclause':           { backgroundColor: '#40404080' },
  '.agda-confluenceproblem':        { backgroundColor: '#80008080' },
}, { dark: true })
