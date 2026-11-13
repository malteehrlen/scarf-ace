// Autocomplete for character cues, scene headings and transitions, from what the script already uses.
import { characterName } from './outline'
import { displayText, type ElementType, type ScriptElement } from './screenplay'

export interface Vocabulary {
  /** Character names, most frequent first. */
  characters: string[]
  locations: string[]
  times: string[]
  transitions: string[]
}

export interface Suggestions {
  /** Offset in the element's text where the completed part starts (it gets replaced). */
  from: number
  items: string[]
  /** Added after an accepted item, e.g. " - " after a location. */
  suffix: string
}

export const EXTENSIONS = ['V.O.', 'O.S.', 'O.C.', "CONT'D"]
export const SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EST. ']
export const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'SAME']
export const TRANSITIONS = [
  'CUT TO:',
  'FADE OUT.',
  'FADE IN:',
  'DISSOLVE TO:',
  'SMASH CUT TO:',
  'MATCH CUT TO:',
  'JUMP CUT TO:',
  'FADE TO BLACK.',
  'INTERCUT WITH:',
]
const PREFIX_RE = /^(INT\.\/EXT\.|INT\.?\/EXT\.?|I\/E\.?|INT\.|EXT\.|EST\.)\s+/i
const MAX_ITEMS = 8

/** Splits "INT. HOUSE - KITCHEN - DAY" into prefix, location and time. */
export function parseHeading(heading: string): { prefix: string; location: string; time: string | null } | null {
  const m = PREFIX_RE.exec(heading)
  if (!m) return null
  const rest = heading.slice(m[0].length)
  const dash = rest.lastIndexOf(' - ')
  return dash < 0
    ? { prefix: m[0], location: rest, time: null }
    : { prefix: m[0], location: rest.slice(0, dash), time: rest.slice(dash + 3) }
}

/** What the script already uses, ignoring the element being edited. */
export function vocabulary(elements: ScriptElement[], skip = -1): Vocabulary {
  const counts = new Map<string, number>()
  const locations = new Set<string>()
  const times = new Set<string>()
  const transitions = new Set<string>()
  elements.forEach((el, i) => {
    if (i === skip) return
    const text = displayText(el)
    if (!text) return
    if (el.type === 'character') {
      const name = characterName(text)
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    } else if (el.type === 'scene') {
      const h = parseHeading(text)
      if (h?.location.trim()) locations.add(h.location.trim())
      if (h?.time?.trim()) times.add(h.time.trim())
    } else if (el.type === 'transition') transitions.add(text)
  })
  return {
    characters: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
    locations: [...locations].sort(),
    times: [...times],
    transitions: [...transitions],
  }
}

const startsWith = (items: Iterable<string>, typed: string) => {
  const q = typed.toUpperCase()
  const out: string[] = []
  for (const item of items) if (item.startsWith(q) && item !== q && !out.includes(item)) out.push(item)
  return out.slice(0, MAX_ITEMS)
}

/** Suggestions for an element whose text (up to the cursor, at its end) is `text`. Null when nothing fits. */
export function suggest(type: ElementType, text: string, vocab: Vocabulary): Suggestions | null {
  // Only once something is typed: on an empty line, Enter keeps its usual meaning.
  if (!text.trim()) return null
  const result = (from: number, items: string[], suffix = ''): Suggestions | null => (items.length ? { from, items, suffix } : null)

  if (type === 'character') {
    const ext = /\(\s*([^)]*)$/.exec(text)
    if (ext) return result(text.length - ext[1].length, startsWith(EXTENSIONS, ext[1]).map((e) => `${e})`))
    const lead = text.length - text.trimStart().length
    return result(lead, startsWith(vocab.characters, text.trimStart()))
  }

  if (type === 'transition') {
    return result(0, startsWith([...TRANSITIONS, ...vocab.transitions], text))
  }

  if (type === 'scene') {
    const h = parseHeading(text)
    if (!h) return result(0, startsWith(SCENE_PREFIXES, text))
    const at = h.prefix.length
    if (h.time === null) {
      return h.location ? result(at, startsWith(vocab.locations, h.location), ' - ') : null
    }
    return h.time ? result(text.length - h.time.length, startsWith([...vocab.times, ...TIMES], h.time)) : null
  }
  return null
}

/** Element types where character names are completed inline while writing prose. */
export const NAME_COMPLETION_TYPES: ElementType[] = ['action', 'dialogue', 'parenthetical', 'shot', 'centered', 'synopsis', 'section']

/** "DETECTIVE RUIZ" → "Detective Ruiz", "O'BRIEN" → "O'Brien", "MARY-JANE" → "Mary-Jane". */
export function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

/**
 * A character name to complete inline in prose. `before` is the text up to the cursor and `after`
 * the character right after it. Suggests only after two letters starting with a capital (names are
 * proper nouns), and matches the case typed: "MA" → "MAYA", "Ma" → "Maya". Returns the full word.
 */
export function suggestName(before: string, after: string, vocab: Vocabulary): string | null {
  if (after && /[\p{L}\p{N}]/u.test(after)) return null // not at the end of a word
  const typed = /(?:^|[^\p{L}\p{N}'-])([\p{L}][\p{L}'-]*)$/u.exec(before)?.[1]
  if (!typed || typed.length < 2 || typed[0] !== typed[0].toUpperCase() || typed[0] === typed[0].toLowerCase()) return null
  const upper = typed.toUpperCase()
  const name = vocab.characters.find((n) => n.startsWith(upper) && n.length > typed.length)
  if (!name) return null
  // Typed in capitals ("MA") gets the name in capitals, unless it's also how the name starts in
  // normal case ("O'B" for O'Brien).
  const normal = titleCase(name)
  return typed === upper && !normal.startsWith(typed) ? name : normal
}
