import { describe, expect, it } from 'vitest'
import { paginate } from '../src/lib/paginate'
import { wrap, type ScriptElement } from '../src/lib/screenplay'

const action = (n: number): ScriptElement => ({ type: 'action', text: Array.from({ length: n }, () => 'x'.repeat(59)).join(' ') })

describe('wrap', () => {
  it('wraps on word boundaries within the width', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  })
  it('hard-breaks words longer than a line', () => {
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
  it('breaks after hyphens inside words, like the browser', () => {
    expect(wrap('a well-known fact', 9)).toEqual(['a well-', 'known', 'fact'])
    expect(wrap('see page-5 now', 8)).toEqual(['see', 'page-5', 'now'])
    expect(wrap('see page-5 now', 9)).toEqual(['see page-', '5 now'])
    expect(wrap('the -5 mark', 7)).toEqual(['the -5', 'mark']) // a leading minus is not a break
    expect(wrap('he said wait--what', 13)).toEqual(['he said wait-', '-what']) // browsers break between, too
    expect(wrap('ok wait--what', 9)).toEqual(['ok wait--', 'what'])
    expect(wrap('ok so—yes', 6)).toEqual(['ok so—', 'yes'])
  })
  it('applies a hanging indent to continuation lines', () => {
    expect(wrap('(aaaa bbbb cccc)', 9, 1)).toEqual(['(aaaa', 'bbbb', 'cccc)'])
  })
})

describe('paginate', () => {
  it('lays out elements with correct indents, case and spacing', () => {
    const { pages } = paginate([
      { type: 'scene', text: 'int. house - day' },
      { type: 'action', text: 'Rain.' },
      { type: 'character', text: 'maya' },
      { type: 'parenthetical', text: 'quietly' },
      { type: 'dialogue', text: 'Hello.' },
      { type: 'transition', text: 'cut to:' },
    ])
    expect(pages).toHaveLength(1)
    expect(pages[0].rows.map((r) => [r.indent, r.text])).toEqual([
      [0, 'INT. HOUSE - DAY'],
      [0, ''],
      [0, 'Rain.'],
      [0, ''],
      [22, 'MAYA'],
      [16, '(quietly)'],
      [10, 'Hello.'],
      [0, ''],
      [53, 'CUT TO:'],
    ])
  })

  it('ignores empty elements', () => {
    const { pages } = paginate([{ type: 'action', text: 'A' }, { type: 'action', text: '  ' }, { type: 'action', text: 'B' }])
    expect(pages[0].rows.map((r) => r.text)).toEqual(['A', '', 'B'])
  })

  it('never leaves a scene heading at the bottom of a page', () => {
    const { pages, pageStarts } = paginate([action(8), { type: 'scene', text: 'EXT. ROAD - NIGHT' }, action(1)], 10)
    expect(pages[0].rows.some((r) => r.kind === 'scene')).toBe(false)
    expect(pages[1].rows[0].text).toBe('EXT. ROAD - NIGHT')
    expect(pageStarts).toEqual([{ page: 2, el: 1 }])
  })

  it('splits long action with at least two lines on each page', () => {
    const { pages } = paginate([action(3), action(5)], 7)
    // page 1: 3 lines + blank + 3 lines of the second paragraph, leaving 2 for page 2
    expect(pages[0].rows).toHaveLength(7)
    expect(pages[1].rows).toHaveLength(2)
  })

  it('moves a short action paragraph whole rather than leaving one line', () => {
    const { pages } = paginate([action(5), action(3)], 7)
    expect(pages[0].rows).toHaveLength(5)
    expect(pages[1].rows).toHaveLength(3)
  })

  it('splits dialogue with (MORE) and (CONT\'D)', () => {
    const words = Array.from({ length: 6 }, () => 'y'.repeat(34)).join(' ')
    const { pages } = paginate([action(2), { type: 'character', text: 'Maya' }, { type: 'dialogue', text: words }], 8)
    const p1 = pages[0].rows.map((r) => r.text)
    const p2 = pages[1].rows.map((r) => r.text)
    expect(p1.at(-1)).toBe('(MORE)')
    expect(p1).toContain('MAYA')
    expect(p2[0]).toBe("MAYA (CONT'D)")
    expect(pages[0].rows.length).toBeLessThanOrEqual(8)
    const dialogueLines = [...pages[0].rows, ...pages[1].rows].filter((r) => r.kind === 'dialogue')
    expect(dialogueLines).toHaveLength(6)
  })

  it('never strands a character cue without dialogue', () => {
    const { pages } = paginate([action(7), { type: 'character', text: 'Maya' }, { type: 'dialogue', text: 'Hi.' }], 9)
    expect(pages[0].rows.some((r) => r.kind === 'character')).toBe(false)
    expect(pages[1].rows.map((r) => r.text)).toEqual(['MAYA', 'Hi.'])
  })

  it('does not break right after a parenthetical', () => {
    const { pages } = paginate(
      [
        action(1),
        { type: 'character', text: 'Maya' },
        { type: 'dialogue', text: 'One two three.' },
        { type: 'dialogue', text: 'Four five six.' },
        { type: 'parenthetical', text: 'beat' },
        { type: 'dialogue', text: 'Seven.' },
        { type: 'dialogue', text: 'Eight.' },
      ],
      7,
    )
    const p1 = pages[0].rows
    const beforeMore = p1[p1.length - 2]
    expect(p1.at(-1)?.text).toBe('(MORE)')
    expect(beforeMore.kind).not.toBe('parenthetical')
  })

  it('force-splits a block taller than a page', () => {
    const { pages } = paginate([{ type: 'scene', text: 'INT. A' }, { type: 'transition', text: 'x '.repeat(400) }], 5)
    expect(pages.every((p) => p.rows.length <= 5)).toBe(true)
  })

  it('handles a long script within page limits', () => {
    const els: ScriptElement[] = []
    for (let i = 0; i < 300; i++) {
      els.push({ type: 'scene', text: `INT. ROOM ${i} - DAY` }, action(2), { type: 'character', text: 'A' }, { type: 'dialogue', text: 'word '.repeat(40) })
    }
    const { pages } = paginate(els)
    expect(pages.length).toBeGreaterThan(50)
    for (const p of pages) {
      expect(p.rows.length).toBeLessThanOrEqual(54)
      expect(p.rows[0].kind).not.toBe('blank')
      const last = p.rows.at(-1)!
      expect(['scene', 'character', 'parenthetical']).not.toContain(last.kind)
    }
  })
})
