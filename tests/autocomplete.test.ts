import { describe, expect, it } from 'vitest'
import { parseHeading, suggest, suggestName, titleCase, vocabulary } from '../src/lib/autocomplete'
import type { ScriptElement } from '../src/lib/screenplay'

const els: ScriptElement[] = [
  { type: 'scene', text: 'INT. LAUNDROMAT - NIGHT' },
  { type: 'character', text: 'Maya' },
  { type: 'dialogue', text: 'Hi.' },
  { type: 'character', text: 'Theo (V.O.)' },
  { type: 'dialogue', text: 'Yo.' },
  { type: 'character', text: 'MAYA' },
  { type: 'dialogue', text: 'Again.' },
  { type: 'character', text: 'Marcus' },
  { type: 'scene', text: 'EXT. LAUNDROMAT PARKING LOT - DAWN' },
  { type: 'scene', text: 'INT. HOUSE - KITCHEN - DAY #3#' },
  { type: 'transition', text: 'Wipe to:' },
]
const vocab = vocabulary(els)

describe('autocomplete', () => {
  it('collects names by frequency, locations, times and transitions', () => {
    expect(vocab.characters).toEqual(['MAYA', 'MARCUS', 'THEO'])
    expect(vocab.locations).toEqual(['HOUSE - KITCHEN', 'LAUNDROMAT', 'LAUNDROMAT PARKING LOT'])
    expect(vocab.times).toEqual(['NIGHT', 'DAWN', 'DAY'])
    expect(vocab.transitions).toEqual(['WIPE TO:'])
  })

  it('completes character names and extensions', () => {
    expect(suggest('character', 'ma', vocab)).toEqual({ from: 0, items: ['MAYA', 'MARCUS'], suffix: '' })
    expect(suggest('character', 'MAYA', vocab)).toBeNull() // nothing left to complete
    expect(suggest('character', 'maya (v', vocab)).toEqual({ from: 6, items: ['V.O.)'], suffix: '' })
    expect(suggest('character', 'maya (', vocab)?.items).toEqual(['V.O.)', 'O.S.)', 'O.C.)', "CONT'D)"])
  })

  it('stays quiet on empty lines, so Enter keeps working', () => {
    expect(suggest('character', '', vocab)).toBeNull()
    expect(suggest('scene', '  ', vocab)).toBeNull()
  })

  it('completes scene headings part by part', () => {
    expect(suggest('scene', 'e', vocab)).toEqual({ from: 0, items: ['EXT. ', 'EST. '], suffix: '' })
    expect(suggest('scene', 'int. laun', vocab)).toEqual({ from: 5, items: ['LAUNDROMAT', 'LAUNDROMAT PARKING LOT'], suffix: ' - ' })
    expect(suggest('scene', 'INT. LAUNDROMAT - ', vocab)).toBeNull()
    expect(suggest('scene', 'INT. LAUNDROMAT - d', vocab)).toEqual({ from: 18, items: ['DAWN', 'DAY', 'DUSK'], suffix: '' })
  })

  it('completes transitions, including ones already used', () => {
    expect(suggest('transition', 'w', vocab)?.items).toEqual(['WIPE TO:'])
    expect(suggest('transition', 'cut', vocab)?.items).toEqual(['CUT TO:'])
  })

  it('parses headings with a dash in the location', () => {
    expect(parseHeading('INT. HOUSE - KITCHEN - DAY')).toEqual({ prefix: 'INT. ', location: 'HOUSE - KITCHEN', time: 'DAY' })
  })
})

describe('character names in prose', () => {
  const v = vocabulary([
    { type: 'character', text: 'Maya' },
    { type: 'character', text: 'Detective Ruiz' },
    { type: 'character', text: "O'Brien" },
    { type: 'character', text: 'Maya' },
  ])

  it('completes after a capital and two letters, matching the case typed', () => {
    expect(suggestName('Then Ma', '', v)).toBe('Maya')
    expect(suggestName('MA', ' ', v)).toBe('MAYA')
    expect(suggestName('She sees De', '.', v)).toBe('Detective Ruiz')
    expect(suggestName("Hi O'B", '', v)).toBe("O'Brien")
  })

  it('stays quiet when it would get in the way', () => {
    expect(suggestName('ma', '', v)).toBeNull() // lowercase: an ordinary word
    expect(suggestName('M', '', v)).toBeNull() // one letter is too little
    expect(suggestName('Maya', '', v)).toBeNull() // already complete
    expect(suggestName('Ma', 'r', v)).toBeNull() // in the middle of a word
    expect(suggestName('Zo', '', v)).toBeNull() // no such character
  })

  it('title-cases names', () => {
    expect(['MARY-JANE', 'DETECTIVE RUIZ', "O'BRIEN"].map(titleCase)).toEqual(['Mary-Jane', 'Detective Ruiz', "O'Brien"])
  })
})
