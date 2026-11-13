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
    expect(wrap('ok so—yes', 5)).toEqual(['ok so', '—yes']) // before the dash, too
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
    const { pages, pageStarts } = paginate([action(8), { type: 'scene', text: 'EXT. ROAD - NIGHT' }, action(1)], { linesPerPage: 10 })
    expect(pages[0].rows.some((r) => r.kind === 'scene')).toBe(false)
    expect(pages[1].rows[0].text).toBe('EXT. ROAD - NIGHT')
    expect(pageStarts).toEqual([{ page: 2, el: 1 }])
  })

  it('splits long action with at least two lines on each page', () => {
    const { pages } = paginate([action(3), action(5)], { linesPerPage: 7 })
    // page 1: 3 lines + blank + 3 lines of the second paragraph, leaving 2 for page 2
    expect(pages[0].rows).toHaveLength(7)
    expect(pages[1].rows).toHaveLength(2)
  })

  it('moves a short action paragraph whole rather than leaving one line', () => {
    const { pages } = paginate([action(5), action(3)], { linesPerPage: 7 })
    expect(pages[0].rows).toHaveLength(5)
    expect(pages[1].rows).toHaveLength(3)
  })

  it('splits dialogue with (MORE) and (CONT\'D)', () => {
    const words = Array.from({ length: 6 }, () => 'y'.repeat(34)).join(' ')
    const { pages } = paginate([action(2), { type: 'character', text: 'Maya' }, { type: 'dialogue', text: words }], { linesPerPage: 8 })
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
    const { pages } = paginate([action(7), { type: 'character', text: 'Maya' }, { type: 'dialogue', text: 'Hi.' }], { linesPerPage: 9 })
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
      { linesPerPage: 7 },
    )
    const p1 = pages[0].rows
    const beforeMore = p1[p1.length - 2]
    expect(p1.at(-1)?.text).toBe('(MORE)')
    expect(beforeMore.kind).not.toBe('parenthetical')
  })

  it('force-splits a block taller than a page', () => {
    const { pages } = paginate([{ type: 'scene', text: 'INT. A' }, { type: 'transition', text: 'x '.repeat(400) }], { linesPerPage: 5 })
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

describe('Fountain extras in pagination', () => {
  const texts = (rows: { text: string }[]) => rows.map((r) => r.text)

  it('forces page breaks, without a trailing empty page', () => {
    const { pages } = paginate([{ type: 'action', text: 'A' }, { type: 'pagebreak', text: '' }, { type: 'action', text: 'B' }, { type: 'pagebreak', text: '' }])
    expect(pages.map((p) => texts(p.rows))).toEqual([['A'], ['B']])
  })

  it('starts a forced page right after the break, before non-printing elements', () => {
    const { pageStarts } = paginate([
      { type: 'action', text: 'A' },
      { type: 'pagebreak', text: '' },
      { type: 'section', text: '# Two' },
      { type: 'action', text: 'B' },
    ])
    expect(pageStarts).toEqual([{ page: 2, el: 2 }])
  })

  it('never prints sections, synopses or notes', () => {
    const { pages } = paginate([
      { type: 'section', text: '# Act One' },
      { type: 'synopsis', text: 'Maya decides.' },
      { type: 'action', text: 'She waits. [[slower?]] Then leaves.' },
      { type: 'action', text: '[[a note on its own]]' },
    ])
    expect(texts(pages[0].rows)).toEqual(['She waits. Then leaves.'])
  })

  it('centers centered text', () => {
    const [row] = paginate([{ type: 'centered', text: 'THE END' }]).pages[0].rows
    expect(row.indent).toBe(26) // (60 - 7) / 2, rounded down
  })

  it('carries emphasis as styled runs', () => {
    const [row] = paginate([{ type: 'action', text: 'A **bold** move.' }]).pages[0].rows
    expect(row.text).toBe('A bold move.')
    expect(row.runs?.map((r) => [r.text, r.bold])).toEqual([['A ', false], ['bold', true], [' move.', false]])
  })

  it('numbers scenes, honouring Fountain scene numbers', () => {
    const rows = paginate([
      { type: 'scene', text: 'INT. A' },
      { type: 'scene', text: 'INT. B #7A#' },
      { type: 'scene', text: 'INT. C' },
    ]).pages[0].rows.filter((r) => r.kind === 'scene')
    expect(rows.map((r) => [r.text, r.sceneNumber])).toEqual([['INT. A', '1'], ['INT. B', '7A'], ['INT. C', '3']])
  })
})

describe('automatic (CONT\'D)', () => {
  const speech = (name: string, line = 'Hi.') => [
    { type: 'character' as const, text: name },
    { type: 'dialogue' as const, text: line },
  ]
  const cues = (els: ScriptElement[], autoContd = true) =>
    paginate(els, { autoContd }).pages.flatMap((p) => p.rows).filter((r) => r.kind === 'character').map((r) => r.text)

  it('adds (CONT\'D) when the same character speaks again after action', () => {
    const els = [...speech('Maya'), action(1), ...speech('maya (V.O.)'), action(1), ...speech('Theo'), ...speech('Maya')]
    expect(cues(els)).toEqual(['MAYA', "MAYA (V.O.) (CONT'D)", 'THEO', 'MAYA'])
    expect(paginate(els, { autoContd: true }).autoContd).toEqual([3])
  })

  it('resets at a new scene, respects a typed (CONT\'D), and can be turned off', () => {
    const els = [...speech('Maya'), { type: 'scene' as const, text: 'EXT. B' }, ...speech('Maya'), action(1), ...speech("Maya (cont'd)")]
    expect(cues(els)).toEqual(['MAYA', 'MAYA', "MAYA (CONT'D)"])
    expect(cues([...speech('Maya'), action(1), ...speech('Maya')], false)).toEqual(['MAYA', 'MAYA'])
  })
})

describe('dual dialogue', () => {
  it('prints two speeches side by side', () => {
    const rows = paginate([
      { type: 'character', text: 'Maya' },
      { type: 'dialogue', text: 'Left speech.' },
      { type: 'character', text: 'Theo', dual: true },
      { type: 'dialogue', text: 'Right speech that is a little longer than the column.' },
    ]).pages[0].rows
    expect(rows.map((r) => [r.indent, r.text, r.right?.indent, r.right?.text])).toEqual([
      [8, 'MAYA', 39, 'THEO'],
      [0, 'Left speech.', 31, 'Right speech that is a'],
      [0, '', 31, 'little longer than the'],
      [0, '', 31, 'column.'],
    ])
  })

  it('keeps an automatic (CONT\'D) on the left speech of a dual pair', () => {
    const rows = paginate(
      [
        { type: 'character', text: 'Theo' },
        { type: 'dialogue', text: 'One.' },
        { type: 'action', text: 'He waits.' },
        { type: 'character', text: 'Theo' },
        { type: 'dialogue', text: 'Two.' },
        { type: 'character', text: 'Maya', dual: true },
        { type: 'dialogue', text: 'Three.' },
      ],
      { autoContd: true },
    ).pages[0].rows
    const dual = rows.find((r) => r.right)!
    expect([dual.text, dual.right!.text]).toEqual(["THEO (CONT'D)", 'MAYA'])
  })

  it('falls back to a normal speech without a speech before it', () => {
    const rows = paginate([action(1), { type: 'character', text: 'Theo', dual: true }, { type: 'dialogue', text: 'Hi.' }]).pages[0].rows
    expect(rows.some((r) => r.right)).toBe(false)
  })
})
