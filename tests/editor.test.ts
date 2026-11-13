import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { createState, elementsFromDoc, enter, setType, shiftTab, tab } from '../src/lib/editor'
import type { Transaction } from 'prosemirror-state'
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

describe('cursor highlight', () => {
  /** Element indexes carrying a node decoration with the given class. */
  function decorated(state: EditorState, cls: string) {
    const out: number[] = []
    for (const plugin of state.plugins) {
      const set = plugin.props.decorations?.call(plugin, state)
      if (!set || !('find' in set)) continue
      for (const d of (set as import('prosemirror-view').DecorationSet).find()) {
        if ((d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class === cls) {
          out.push(state.doc.resolve(d.from).index(0))
        }
      }
    }
    return out
  }

  const els: ScriptElement[] = [
    { type: 'scene', text: 'INT. A' },
    { type: 'action', text: 'B' },
    { type: 'action', text: '' },
  ]

  it('tints only the element holding the cursor, including empty ones', () => {
    expect(decorated(at(createState(els), 1), 'el-current')).toEqual([1])
    expect(decorated(at(createState(els), 2), 'el-current')).toEqual([2])
  })
})

describe('emphasis and Fountain extras in the editor', () => {
  it('round-trips emphasis markup through the document', () => {
    const els: ScriptElement[] = [{ type: 'action', text: 'A **bold** and *italic* _move_, 5 \\* 3.' }]
    const s = createState(els)
    expect(s.doc.child(0).textContent).toBe('A bold and italic move, 5 * 3.')
    expect(elementsFromDoc(s.doc)).toEqual(els)
  })

  it('Mod-b toggles bold on the selection', () => {
    let s = createState([{ type: 'action', text: 'one two' }])
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 5, 8)))
    const bold = s.plugins.flatMap((p) => (p.props.handleKeyDown ? [p] : []))
    let handled = false
    for (const p of bold) {
      if (handled) break
      handled = Boolean(
        p.props.handleKeyDown!.call(p, { state: s, dispatch: (tr: Transaction) => (s = s.apply(tr)) } as never, { type: 'keydown', key: 'b', keyCode: 66, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as never),
      )
    }
    expect(elementsFromDoc(s.doc)[0].text).toBe('one **two**')
  })

  it('keeps notes and scene numbers as text, and dual on characters', () => {
    const els: ScriptElement[] = [
      { type: 'scene', text: 'INT. A #4#' },
      { type: 'character', text: 'MAYA', dual: true },
      { type: 'action', text: 'Wait. [[cut?]]' },
    ]
    expect(elementsFromDoc(createState(els).doc)).toEqual(els)
  })

  it('turns Fountain shortcuts typed in action into elements', () => {
    const typed = (text: string) => {
      let s = at(createState([{ type: 'action', text: '' }]), 0)
      for (const ch of text) s = typeText(s, ch)
      return elementsFromDoc(s.doc)[0]
    }
    expect(typed('===')).toEqual({ type: 'pagebreak', text: '' })
    expect(typed('# Act One')).toEqual({ type: 'section', text: '# Act One' })
    expect(typed('= She stays.')).toEqual({ type: 'synopsis', text: 'She stays.' })
    expect(typed('> THE END <')).toEqual({ type: 'centered', text: 'THE END' })
  })
})
