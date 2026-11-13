// Find & replace across the script. Matches never span two elements.
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

export interface FindOptions {
  query: string
  matchCase: boolean
  wholeWord: boolean
}

export interface Match {
  from: number
  to: number
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findRegExp({ query, matchCase, wholeWord }: FindOptions): RegExp | null {
  if (!query) return null
  const body = escapeRegExp(query)
  const source = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body
  return new RegExp(source, matchCase ? 'gu' : 'giu')
}

/** All matches in the document, as document positions. */
export function findInDoc(doc: PMNode, options: FindOptions): Match[] {
  const re = findRegExp(options)
  if (!re) return []
  const out: Match[] = []
  doc.forEach((node, offset) => {
    for (const m of node.textContent.matchAll(re)) {
      if (!m[0]) continue
      out.push({ from: offset + 1 + m.index, to: offset + 1 + m.index + m[0].length })
    }
  })
  return out
}

/**
 * When replacing without "match case", keep the case of what was found: MAYA → MIA, Maya → Mia,
 * maya → mia. A replacement typed in mixed case is used as is for mixed-case matches.
 */
export function preserveCase(replacement: string, found: string): string {
  const letters = found.replace(/[^\p{L}]/gu, '')
  if (!letters) return replacement
  if (letters === letters.toUpperCase() && letters.length > 1) return replacement.toUpperCase()
  if (letters === letters.toLowerCase()) return replacement.toLowerCase()
  const first = letters[0]
  const rest = letters.slice(1)
  if (first === first.toUpperCase() && rest === rest.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  }
  return replacement
}

// --- Editor plugin ---------------------------------------------------------------------------

export interface FindState extends FindOptions {
  active: boolean
  matches: Match[]
  /** Index of the current match, or -1. */
  current: number
}

export const findKey = new PluginKey<FindState>('find')

const EMPTY: FindState = { active: false, query: '', matchCase: false, wholeWord: false, matches: [], current: -1 }

function withMatches(state: FindState, doc: PMNode, near: number): FindState {
  const matches = state.active ? findInDoc(doc, state) : []
  let current = matches.findIndex((m) => m.from >= near)
  if (current < 0) current = matches.length ? 0 : -1
  return { ...state, matches, current }
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => EMPTY,
    apply(tr, value, _old, state) {
      const meta = tr.getMeta(findKey) as Partial<FindState> | undefined
      if (meta) {
        const next = { ...value, ...meta }
        // Moving to a specific match keeps the index; changing the search recomputes from the cursor.
        if (meta.current !== undefined && meta.query === undefined) return next
        return withMatches(next, state.doc, state.selection.from)
      }
      if (!tr.docChanged || !value.active) return value
      const at = value.matches[value.current]
      return withMatches(value, state.doc, at ? tr.mapping.map(at.from) : state.selection.from)
    },
  },
  props: {
    decorations(state) {
      const find = findKey.getState(state)
      if (!find?.active || !find.matches.length) return null
      return DecorationSet.create(
        state.doc,
        find.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === find.current ? 'find-match find-match-current' : 'find-match' })),
      )
    },
  },
})

/** Shows the match: puts the cursor at its start (a collapsed cursor, so Vim stays in normal mode). */
function reveal(tr: Transaction, match: Match | undefined) {
  if (match) tr.setSelection(TextSelection.create(tr.doc, match.from)).scrollIntoView()
  return tr
}

export function setFind(view: EditorView, options: Partial<FindOptions> & { active?: boolean }) {
  const tr = view.state.tr.setMeta(findKey, { active: true, ...options }).setMeta('addToHistory', false)
  view.dispatch(tr)
  const find = findKey.getState(view.state)!
  view.dispatch(reveal(view.state.tr, find.matches[find.current]).setMeta('addToHistory', false))
}

export function closeFind(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(findKey, { active: false }).setMeta('addToHistory', false))
}

export function findStep(view: EditorView, dir: 1 | -1) {
  const find = findKey.getState(view.state)
  if (!find?.matches.length) return
  const current = (find.current + dir + find.matches.length) % find.matches.length
  const tr = view.state.tr.setMeta(findKey, { current }).setMeta('addToHistory', false)
  view.dispatch(reveal(tr, find.matches[current]))
}

function replacementFor(state: FindState, doc: PMNode, m: Match, replacement: string) {
  return state.matchCase ? replacement : preserveCase(replacement, doc.textBetween(m.from, m.to))
}

/** Replaces the current match and moves on to the next one. */
export function replaceCurrent(view: EditorView, replacement: string) {
  const find = findKey.getState(view.state)
  const m = find?.matches[find.current]
  if (!find || !m) return
  const tr = view.state.tr.insertText(replacementFor(find, view.state.doc, m, replacement), m.from, m.to)
  view.dispatch(tr)
  const after = findKey.getState(view.state)!
  view.dispatch(reveal(view.state.tr, after.matches[after.current]).setMeta('addToHistory', false))
}

/** Replaces every match in one step (one undo). Returns how many were replaced. */
export function replaceAll(view: EditorView, replacement: string): number {
  const find = findKey.getState(view.state)
  if (!find?.matches.length) return 0
  const tr = view.state.tr
  for (const m of [...find.matches].reverse()) tr.insertText(replacementFor(find, view.state.doc, m, replacement), m.from, m.to)
  view.dispatch(tr.scrollIntoView())
  return find.matches.length
}

export function findStatus(state: EditorState): { count: number; current: number } {
  const find = findKey.getState(state)
  return { count: find?.matches.length ?? 0, current: find?.current ?? -1 }
}
