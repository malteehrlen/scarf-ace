import { describe, expect, it } from 'vitest'
import { parseRuns, parseStyled, plainText, runsOf, serializeRuns, sliceSpans, splitSceneNumber, stripNotes } from '../src/lib/markup'

const r = (text: string, s = '') => ({ text, bold: s.includes('b'), italic: s.includes('i'), underline: s.includes('u') })

describe('emphasis', () => {
  it('parses Fountain emphasis', () => {
    expect(parseRuns('a *b* **c** ***d*** _e_')).toEqual([r('a '), r('b', 'i'), r(' '), r('c', 'b'), r(' '), r('d', 'bi'), r(' '), r('e', 'u')])
    expect(parseRuns('_**both**_')).toEqual([r('both', 'bu')])
  })
  it('keeps unpaired markers and escapes literal', () => {
    expect(plainText('5 * 3 = 15')).toBe('5 * 3 = 15')
    expect(plainText('a \\*b\\* c')).toBe('a *b* c')
    expect(plainText('snake_case')).toBe('snake_case')
  })
  it('round-trips through serialization', () => {
    for (const markup of ['plain', 'a *b* c', '**bold** and _under_', '***both***', '_**nested**_', 'a \\*literal\\* star']) {
      expect(serializeRuns(parseRuns(markup))).toBe(markup)
    }
    expect(serializeRuns([r('bold ', 'b'), r('text')])).toBe('**bold** text')
    expect(serializeRuns([r('5 * 3')])).toBe('5 \\* 3')
  })
  it('reports styled spans in plain text, and slices them per line', () => {
    const { text, spans } = parseStyled('one **two** three')
    expect(text).toBe('one two three')
    expect(spans).toEqual([{ from: 4, to: 7, bold: true, italic: false, underline: false }])
    expect(sliceSpans(spans, 5, 13)).toEqual([{ from: 0, to: 2, bold: true, italic: false, underline: false }])
    expect(runsOf('wo three', sliceSpans(spans, 5, 13))).toEqual([r('wo', 'b'), r(' three')])
  })
})

describe('notes and scene numbers', () => {
  it('strips notes', () => {
    expect(stripNotes('She waits. [[slower?]] Then leaves.').replace(/\s+/g, ' ')).toBe('She waits. Then leaves.')
  })
  it('splits scene numbers', () => {
    expect(splitSceneNumber('INT. HOUSE - DAY #12A#')).toEqual({ heading: 'INT. HOUSE - DAY', number: '12A' })
    expect(splitSceneNumber('INT. HOUSE - DAY')).toEqual({ heading: 'INT. HOUSE - DAY', number: null })
  })
})
