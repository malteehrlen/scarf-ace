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

  it('keeps notes, and turns boneyard into notes', () => {
    const { elements } = fromFountain('Hello [[a note\nover two lines]] world.\n\n/* gone\n\nINT. X */\nEnd.')
    expect(elements.map((e) => [e.type, e.text])).toEqual([
      ['action', 'Hello [[a note over two lines]] world.'],
      ['action', '[[gone]]'],
      ['action', '[[INT. X]] End.'],
    ])
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

describe('Fountain fidelity', () => {
  const source = `# Act One

= Maya finds the scarf.

INT. LAUNDROMAT - NIGHT #1A#

Rain. **Hard** rain, *very* _loud_. [[make this shorter]]

MAYA
Who's there?

THEO ^
Just me.

> THE END <

===

## Sequence two

EXT. ROAD - DAY

Silence.
`
  it('imports every Fountain element', () => {
    const { elements } = fromFountain(source)
    expect(elements).toEqual([
      { type: 'section', text: '# Act One' },
      { type: 'synopsis', text: 'Maya finds the scarf.' },
      { type: 'scene', text: 'INT. LAUNDROMAT - NIGHT #1A#' },
      { type: 'action', text: 'Rain. **Hard** rain, *very* _loud_. [[make this shorter]]' },
      { type: 'character', text: 'MAYA' },
      { type: 'dialogue', text: "Who's there?" },
      { type: 'character', text: 'THEO', dual: true },
      { type: 'dialogue', text: 'Just me.' },
      { type: 'centered', text: 'THE END' },
      { type: 'pagebreak', text: '' },
      { type: 'section', text: '## Sequence two' },
      { type: 'scene', text: 'EXT. ROAD - DAY' },
      { type: 'action', text: 'Silence.' },
    ])
  })

  it('round-trips without losing anything', () => {
    const once = fromFountain(source).elements
    const twice = fromFountain(toFountain(once)).elements
    expect(twice).toEqual(once)
  })
})
