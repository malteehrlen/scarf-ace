import { describe, expect, it } from 'vitest'
import type { EditorState, Transaction } from 'prosemirror-state'
import { createState, elementsFromDoc } from '../src/lib/editor'
import { findInDoc, findKey, findStep, preserveCase, replaceAll, replaceCurrent, setFind } from '../src/lib/find'
import type { ScriptElement } from '../src/lib/screenplay'

function editor(els: ScriptElement[]) {
  let state: EditorState = createState(els)
  const view = {
    get state() {
      return state
    },
    dispatch: (tr: Transaction) => {
      state = state.applyTransaction(tr).state
    },
  } as never as import('prosemirror-view').EditorView
  return { view, get state() { return state }, get els() { return elementsFromDoc(state.doc) } }
}

const els: ScriptElement[] = [
  { type: 'action', text: 'Maya waits. Mayan ruins. MAYA!' },
  { type: 'character', text: 'MAYA' },
  { type: 'dialogue', text: 'maya, hi.' },
]

describe('find', () => {
  it('finds case-insensitively by default, per element', () => {
    const e = editor(els)
    expect(findInDoc(e.state.doc, { query: 'maya', matchCase: false, wholeWord: false })).toHaveLength(5)
    expect(findInDoc(e.state.doc, { query: 'maya', matchCase: false, wholeWord: true })).toHaveLength(4)
    expect(findInDoc(e.state.doc, { query: 'Maya', matchCase: true, wholeWord: true })).toHaveLength(1)
    expect(findInDoc(e.state.doc, { query: 'ruins. MAYA', matchCase: false, wholeWord: false })).toHaveLength(1)
    expect(findInDoc(e.state.doc, { query: '.', matchCase: false, wholeWord: false })).toHaveLength(3) // literal, not regex
  })

  it('steps through matches, wrapping around', () => {
    const e = editor(els)
    setFind(e.view, { query: 'maya', wholeWord: true })
    expect(findKey.getState(e.state)!.current).toBe(0)
    findStep(e.view, -1)
    expect(findKey.getState(e.state)!.current).toBe(3)
    findStep(e.view, 1)
    expect(findKey.getState(e.state)!.current).toBe(0)
  })
})

describe('replace', () => {
  it('preserves the case of what it replaces', () => {
    expect(preserveCase('mia', 'MAYA')).toBe('MIA')
    expect(preserveCase('mia', 'Maya')).toBe('Mia')
    expect(preserveCase('Mia', 'maya')).toBe('mia')
    expect(preserveCase('McKee', 'mAyA')).toBe('McKee')
  })

  it('renames a character everywhere in one step, keeping case', () => {
    const e = editor(els)
    setFind(e.view, { query: 'maya', wholeWord: true })
    expect(replaceAll(e.view, 'mia')).toBe(4)
    expect(e.els.map((x) => x.text)).toEqual(['Mia waits. Mayan ruins. MIA!', 'MIA', 'mia, hi.'])
  })

  it('replaces the current match and moves to the next', () => {
    const e = editor(els)
    setFind(e.view, { query: 'maya', wholeWord: true, matchCase: false })
    replaceCurrent(e.view, 'Mia')
    expect(e.els[0].text).toBe('Mia waits. Mayan ruins. MAYA!')
    expect(findKey.getState(e.state)!.matches).toHaveLength(3)
  })

  it('keeps formatting around replaced text', () => {
    const e = editor([{ type: 'action', text: 'A **big** deal.' }])
    setFind(e.view, { query: 'big' })
    replaceAll(e.view, 'huge')
    expect(e.els[0].text).toBe('A **huge** deal.')
  })
})
