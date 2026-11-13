import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { createState, elementsFromDoc, enter, setType, shiftTab, tab } from '../src/lib/editor'
import type { ScriptElement } from '../src/lib/screenplay'

function run(state: EditorState, cmd: Command) {
  let next = state
  cmd(state, (tr) => (next = state.apply(tr)))
  return next
}

/** Places the cursor at the end of the element at `index`. */
function at(state: EditorState, index: number, offset?: number) {
  let pos = 0
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize
  const node = state.doc.child(index)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + (offset ?? node.content.size))))
}

function typeText(state: EditorState, text: string) {
  return state.apply(state.tr.insertText(text))
}

const types = (s: EditorState) => elementsFromDoc(s.doc).map((e) => e.type)

describe('editor commands', () => {
  const start: ScriptElement[] = [{ type: 'character', text: 'MAYA' }]

  it('Enter follows the screenplay flow', () => {
    let s = at(createState(start), 0)
    s = run(s, enter)
    expect(types(s)).toEqual(['character', 'dialogue'])
    s = typeText(s, 'Hi.')
    s = run(s, enter)
    expect(types(s)).toEqual(['character', 'dialogue', 'character'])
    s = run(s, enter) // empty character bails out to action
    expect(types(s)).toEqual(['character', 'dialogue', 'action'])
  })

  it('Enter in the middle splits keeping the type', () => {
    let s = at(createState([{ type: 'dialogue', text: 'Hello world' }]), 0, 5)
    s = run(s, enter)
    expect(elementsFromDoc(s.doc)).toEqual([
      { type: 'dialogue', text: 'Hello' },
      { type: 'dialogue', text: ' world' },
    ])
  })

  it('Tab toggles between related types', () => {
    let s = at(createState([{ type: 'action', text: '' }]), 0)
    s = run(s, tab)
    expect(types(s)).toEqual(['character'])
    s = run(s, tab)
    expect(types(s)).toEqual(['action'])
    s = run(s, shiftTab)
    expect(types(s)).toEqual(['scene'])
  })

  it('setType changes every element in the selection', () => {
    let s = createState([{ type: 'action', text: 'a' }, { type: 'action', text: 'b' }])
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)))
    s = run(s, setType('shot'))
    expect(types(s)).toEqual(['shot', 'shot'])
  })

  it('typing a scene prefix in action converts to a scene heading', () => {
    let s = at(createState([{ type: 'action', text: '' }]), 0)
    s = typeText(s, 'int')
    expect(types(s)).toEqual(['action'])
    s = typeText(s, '.')
    expect(types(s)).toEqual(['scene'])
  })

  it('explicitly choosing action for heading-like text sticks', () => {
    let s = at(createState([{ type: 'scene', text: 'INT. HOUSE' }]), 0)
    s = run(s, setType('action'))
    expect(types(s)).toEqual(['action'])
  })
})
