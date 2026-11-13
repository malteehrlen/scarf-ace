import { describe, expect, it } from 'vitest'
import { buildReport, formatEighths } from '../src/lib/report'
import type { ScriptElement } from '../src/lib/screenplay'

const els: ScriptElement[] = [
  { type: 'scene', text: 'INT. LAUNDROMAT - NIGHT' },
  { type: 'action', text: 'Rain on the windows.' },
  { type: 'character', text: 'Maya' },
  { type: 'dialogue', text: 'Who is there?' },
  { type: 'character', text: 'Theo (V.O.)' },
  { type: 'parenthetical', text: 'quietly' },
  { type: 'dialogue', text: 'Just me.' },
  { type: 'scene', text: 'EXT. PARKING LOT - DAY' },
  { type: 'character', text: 'MAYA' },
  { type: 'dialogue', text: 'Again.' },
  { type: 'scene', text: 'INT./EXT. CAR - MORNING' },
]

describe('script report', () => {
  const r = buildReport(els)

  it('summarises the script', () => {
    expect(r.pages).toBe(1)
    expect(r.minutes).toBe(1)
    expect([r.interior, r.exterior, r.day, r.night]).toEqual([2, 2, 2, 1])
    expect(r.words).toBe(27)
    expect(r.dialogueShare).toBeCloseTo(6 / 27)
  })

  it('lists scenes with page, length in eighths and speakers', () => {
    expect(r.scenes.map((s) => [s.number, s.heading, s.page, s.eighths, s.characters])).toEqual([
      [1, 'INT. LAUNDROMAT - NIGHT', 1, 1, ['MAYA', 'THEO']], // 10 lines; an eighth is 54/8 = 6.75 lines
      [2, 'EXT. PARKING LOT - DAY', 1, 1, ['MAYA']],
      [3, 'INT./EXT. CAR - MORNING', 1, 1, []],
    ])
  })

  it('lists characters by how much they speak', () => {
    expect(r.characters).toEqual([
      { name: 'MAYA', speeches: 2, words: 4, scenes: 2, firstPage: 1 },
      { name: 'THEO', speeches: 1, words: 2, scenes: 1, firstPage: 1 },
    ])
  })

  it('formats eighths like call sheets', () => {
    expect([1, 4, 8, 11, 16].map(formatEighths)).toEqual(['1/8', '4/8', '1', '1 3/8', '2'])
  })
})
