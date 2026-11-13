import { describe, expect, it } from 'vitest'
import { buildOutline, characterName } from '../src/lib/outline'
import type { ScriptElement } from '../src/lib/screenplay'

const els: ScriptElement[] = [
  { type: 'action', text: 'Cold open.' },
  { type: 'scene', text: 'int. house - day' },
  { type: 'action', text: 'Rain.' },
  { type: 'character', text: 'Maya (V.O.)' },
  { type: 'parenthetical', text: 'quietly' },
  { type: 'dialogue', text: 'Hi.' },
  { type: 'action', text: '' },
  { type: 'character', text: 'Theo' },
  { type: 'dialogue', text: 'Yo.' },
  { type: 'transition', text: 'Cut to:' },
  { type: 'scene', text: 'ext. road' },
  { type: 'dialogue', text: 'Orphan.' },
]

describe('buildOutline', () => {
  it('groups elements into scenes with dialogue nested under cues', () => {
    const [pre, s1, s2] = buildOutline(els)
    expect(pre).toMatchObject({ index: -1, number: 0, end: 1 })
    expect(pre.children.map((n) => n.index)).toEqual([0])

    expect(s1).toMatchObject({ index: 1, number: 1, heading: 'INT. HOUSE - DAY', end: 10, characters: ['MAYA', 'THEO'] })
    expect(s1.children.map((n) => [n.type, n.children.map((c) => c.type)])).toEqual([
      ['action', []],
      ['character', ['parenthetical', 'dialogue']],
      ['character', ['dialogue']],
      ['transition', []],
    ])
    expect(s1.children[1].children[0].text).toBe('(quietly)')

    expect(s2).toMatchObject({ index: 10, number: 2, end: 12 })
    expect(s2.children.map((n) => n.type)).toEqual(['dialogue'])
  })

  it('keeps an empty element when the cursor is in it', () => {
    expect(buildOutline(els)[1].children).toHaveLength(4)
    expect(buildOutline(els, 6)[1].children.map((n) => n.index)).toEqual([2, 3, 6, 7, 9])
  })

  it('strips extensions from character names', () => {
    expect(characterName("maya (V.O.) (CONT'D)")).toBe('MAYA')
  })
})
