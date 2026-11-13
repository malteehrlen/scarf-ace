// Script report: the numbers producers and writers ask for, computed from the same pagination as the PDF.
import { parseHeading } from './autocomplete'
import { characterName } from './outline'
import { paginate, type Pagination } from './paginate'
import { PAGE, displayText, type ScriptElement } from './screenplay'

export interface SceneReport {
  index: number
  number: number
  heading: string
  page: number
  /** Length in eighths of a page (the industry unit), at least 1. */
  eighths: number
  characters: string[]
}

export interface CharacterReport {
  name: string
  speeches: number
  words: number
  scenes: number
  firstPage: number
}

export interface Report {
  pages: number
  /** Rough screen time: a page is about a minute. */
  minutes: number
  scenes: SceneReport[]
  characters: CharacterReport[]
  words: number
  /** Share of words that are dialogue, 0–1. */
  dialogueShare: number
  interior: number
  exterior: number
  day: number
  night: number
}

const LINES_PER_EIGHTH = PAGE.linesPerPage / 8
const wordCount = (text: string) => (text.match(/[\p{L}\p{N}']+/gu) ?? []).length

/** "1 3/8", "4/8", "2". Eighths aren't reduced, as on call sheets. */
export function formatEighths(eighths: number): string {
  const whole = Math.floor(eighths / 8)
  const rest = eighths % 8
  if (!rest) return String(whole)
  return whole ? `${whole} ${rest}/8` : `${rest}/8`
}

export function buildReport(elements: ScriptElement[], pagination: Pagination = paginate(elements)): Report {
  // Where each element first appears, and how many lines (incl. spacing) each element takes.
  const firstPage = new Map<number, number>()
  const lines = new Map<number, number>()
  for (const page of pagination.pages) {
    for (const row of page.rows) {
      if (!firstPage.has(row.el)) firstPage.set(row.el, page.number)
      lines.set(row.el, (lines.get(row.el) ?? 0) + 1)
    }
  }

  const scenes: SceneReport[] = []
  const characters = new Map<string, CharacterReport & { sceneSet: Set<number> }>()
  let scene: SceneReport | null = null
  let speaker: string | null = null
  let words = 0
  let dialogueWords = 0
  let interior = 0
  let exterior = 0
  let day = 0
  let night = 0

  elements.forEach((el, i) => {
    const text = displayText(el)
    if (el.type === 'scene' && text) {
      const h = parseHeading(text)
      const prefix = h?.prefix.toUpperCase() ?? ''
      if (prefix.includes('INT')) interior++
      if (prefix.includes('EXT')) exterior++
      const time = h?.time?.toUpperCase() ?? ''
      if (/NIGHT|EVENING|DUSK/.test(time)) night++
      else if (/DAY|MORNING|AFTERNOON|DAWN/.test(time)) day++
      scene = { index: i, number: scenes.length + 1, heading: text, page: firstPage.get(i) ?? 1, eighths: 0, characters: [] }
      scenes.push(scene)
    }
    if (scene) scene.eighths += lines.get(i) ?? 0 // counted in lines for now
    if (!text) return

    const n = wordCount(text)
    words += n
    if (el.type === 'character') {
      speaker = characterName(text)
      if (!speaker) return
      const c = characters.get(speaker) ?? { name: speaker, speeches: 0, words: 0, scenes: 0, firstPage: firstPage.get(i) ?? 1, sceneSet: new Set() }
      c.speeches++
      if (scene) c.sceneSet.add(scene.number)
      characters.set(speaker, c)
      if (scene && !scene.characters.includes(speaker)) scene.characters.push(speaker)
    } else if (el.type === 'dialogue' && speaker) {
      dialogueWords += n
      characters.get(speaker)!.words += n
    } else if (el.type !== 'parenthetical') speaker = null
  })

  for (const s of scenes) s.eighths = Math.max(1, Math.round(s.eighths / LINES_PER_EIGHTH))
  const pages = pagination.pages.length
  return {
    pages,
    minutes: pages,
    scenes,
    characters: [...characters.values()]
      .map(({ sceneSet, ...c }) => ({ ...c, scenes: sceneSet.size }))
      .sort((a, b) => b.speeches - a.speeches || b.words - a.words || a.name.localeCompare(b.name)),
    words,
    dialogueShare: words ? dialogueWords / words : 0,
    interior,
    exterior,
    day,
    night,
  }
}
