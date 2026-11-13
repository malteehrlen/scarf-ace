import { describe, expect, it } from 'vitest'
import { fromFountain, toFountain } from '../src/lib/fountain'
import { emptyTitlePage, type ScriptElement } from '../src/lib/screenplay'

const sample = `Title: Big Fish
Credit: Written by
Author: John August
Contact:
    Someone
    123 Street

INT. HOUSE - DAY

Rain hits the window.

MAYA (V.O.)
(quietly)
Hello there.
How are you?

CUT TO:

.FLASHBACK

> FADE OUT.

!SHOUTING IS ACTION

@mcCLANE
Yippee.
`

describe('fromFountain', () => {
  it('parses title page and elements', () => {
    const { titlePage, elements } = fromFountain(sample)
    expect(titlePage.title).toBe('Big Fish')
    expect(titlePage.author).toBe('John August')
    expect(titlePage.contact).toBe('Someone\n123 Street')
    expect(elements).toEqual<ScriptElement[]>([
      { type: 'scene', text: 'INT. HOUSE - DAY' },
      { type: 'action', text: 'Rain hits the window.' },
      { type: 'character', text: 'MAYA (V.O.)' },
      { type: 'parenthetical', text: 'quietly' },
      { type: 'dialogue', text: 'Hello there. How are you?' },
      { type: 'transition', text: 'CUT TO:' },
      { type: 'scene', text: 'FLASHBACK' },
      { type: 'transition', text: 'FADE OUT.' },
      { type: 'action', text: 'SHOUTING IS ACTION' },
      { type: 'character', text: 'mcCLANE' },
      { type: 'dialogue', text: 'Yippee.' },
    ])
  })

  it('strips notes and boneyard', () => {
    const { elements } = fromFountain('Hello [[a note]] world.\n\n/* gone\n\nINT. X */\nEnd.')
    expect(elements.map((e) => e.text)).toEqual(['Hello world.', 'End.'])
  })
})

describe('toFountain', () => {
  it('round-trips every element type that Fountain supports', () => {
    const elements: ScriptElement[] = [
      { type: 'scene', text: 'INT. HOUSE - DAY' },
      { type: 'scene', text: 'Flashback' },
      { type: 'action', text: 'Rain.' },
      { type: 'action', text: 'BOOM' },
      { type: 'action', text: 'int. looks like a heading' },
      { type: 'character', text: 'Maya' },
      { type: 'parenthetical', text: 'quietly' },
      { type: 'dialogue', text: 'Hi.' },
      { type: 'transition', text: 'Cut to:' },
      { type: 'transition', text: 'Fade out.' },
    ]
    const tp = { ...emptyTitlePage(), title: 'T', author: 'A' }
    const out = toFountain(elements, tp)
    const back = fromFountain(out)
    expect(back.titlePage.title).toBe('T')
    expect(back.elements).toEqual([
      { type: 'scene', text: 'INT. HOUSE - DAY' },
      { type: 'scene', text: 'FLASHBACK' },
      { type: 'action', text: 'Rain.' },
      { type: 'action', text: 'BOOM' },
      { type: 'action', text: 'int. looks like a heading' },
      { type: 'character', text: 'MAYA' },
      { type: 'parenthetical', text: 'quietly' },
      { type: 'dialogue', text: 'Hi.' },
      { type: 'transition', text: 'CUT TO:' },
      { type: 'transition', text: 'FADE OUT.' },
    ])
  })
})
