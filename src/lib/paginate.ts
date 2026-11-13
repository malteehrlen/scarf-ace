import { runsOf, sliceSpans, type Run, type StyleSpan } from './markup'
import { characterName } from './outline'
import {
  DUAL,
  LAYOUT,
  PAGE,
  printable,
  sceneNumberOf,
  wrap,
  type ElementType,
  type ScriptElement,
} from './screenplay'

export interface Row {
  text: string
  /** Characters from the left margin. */
  indent: number
  kind: ElementType | 'blank' | 'more'
  /** Index of the source element. */
  el: number
  /** Styled pieces of `text`, when any of it is bold/italic/underlined. */
  runs?: Run[]
  /** Dual dialogue: the right-hand column's line printed alongside this one. */
  right?: Row
  /** First line of a scene heading: its scene number. */
  sceneNumber?: string
}

export interface Page {
  number: number
  rows: Row[]
}

export interface PaginateOptions {
  linesPerPage?: number
  /** Add (CONT'D) when a character speaks again after action in the same scene. */
  autoContd?: boolean
}

export interface Pagination {
  pages: Page[]
  /** For each page after the first, the index of the element it starts in. */
  pageStarts: { page: number; el: number }[]
  /** Character cues that got an automatic (CONT'D). */
  autoContd: number[]
}

interface Adornment {
  before: Row[] // appended to the bottom of the page, e.g. (MORE)
  after: Row[] // prepended to the next page, e.g. CHARACTER (CONT'D)
}

/** Rows that must be laid out together, with the indices at which they may be split. */
interface Block {
  rows: Row[]
  breaks: Map<number, Adornment>
  keepWithNext: boolean
  /** A forced page break (Fountain "==="): the index of the page-break element. */
  pageBreak?: number
  /** A speech that a following dual-dialogue speech can pair up with. */
  speech?: { indexes: number[]; cue: string; suffix: string }
}

const NO_ADORNMENT: Adornment = { before: [], after: [] }
const MIN_LINES_AT_SPLIT = 2

function blank(el: number): Row {
  return { text: '', indent: 0, kind: 'blank', el }
}

interface Column {
  indent: number
  width: number
  hangingIndent: number
}

/** Wraps styled text into rows. `suffix` (e.g. " (CONT'D)") is appended unstyled. */
function rowsFor(index: number, type: ElementType, text: string, spans: StyleSpan[], col: Column): Row[] {
  const layout = LAYOUT[type]
  let pos = 0
  return wrap(text, col.width, col.hangingIndent).map((line, i) => {
    const at = text.indexOf(line, pos)
    pos = at + line.length
    const indent = layout.alignRight
      ? col.indent + col.width - line.length
      : layout.alignCenter
        ? col.indent + Math.floor((col.width - line.length) / 2)
        : col.indent + (i > 0 ? col.hangingIndent : 0)
    const lineSpans = sliceSpans(spans, at, at + line.length)
    return { text: line, indent, kind: type, el: index, ...(lineSpans.length ? { runs: runsOf(line, lineSpans) } : {}) }
  })
}

// Laid-out lines per distinct element content: unchanged elements cost a lookup, not a re-wrap.
const rowCache = new Map<string, Row[]>()
const ROW_CACHE_LIMIT = 20_000

function elementRows(el: ScriptElement, index: number, suffix = ''): Row[] {
  const key = `${el.type}\u0000${suffix}\u0000${el.text}`
  let rows = rowCache.get(key)
  if (!rows) {
    const { text, spans } = printable(el)
    if (rowCache.size > ROW_CACHE_LIMIT) rowCache.clear()
    rowCache.set(key, (rows = rowsFor(-1, el.type, text + suffix, spans, LAYOUT[el.type])))
  }
  return rows.map((row) => ({ ...row, el: index }))
}

function spacing(type: ElementType, index: number): Row[] {
  return Array.from({ length: LAYOUT[type].spaceBefore }, () => blank(index))
}

function contdCue(cue: string): string {
  return /\(CONT'D\)$/.test(cue) ? cue : `${cue} (CONT'D)`
}

/** A character cue with its parentheticals and dialogue (or an orphaned run of dialogue). */
function dialogueBlock(elements: ScriptElement[], indexes: number[], cueSuffix: string): Block {
  const rows: Row[] = []
  const breaks = new Map<number, Adornment>()
  const first = elements[indexes[0]]
  const cue = first.type === 'character' ? printable(first).text + cueSuffix : null
  rows.push(...spacing('character', indexes[0]))

  const content: Row[] = []
  for (const i of indexes) {
    if (elements[i].type === 'character') rows.push(...elementRows(elements[i], i, cueSuffix))
    else content.push(...elementRows(elements[i], i))
  }
  const contentStart = rows.length
  rows.push(...content)

  for (let k = MIN_LINES_AT_SPLIT; k <= content.length - MIN_LINES_AT_SPLIT; k++) {
    // Never leave a parenthetical (or part of one) at the bottom of a page.
    if (content[k - 1].kind === 'parenthetical') continue
    const nextEl = content[k].el
    breaks.set(contentStart + k, {
      before: cue ? [{ text: '(MORE)', indent: LAYOUT.character.indent, kind: 'more', el: content[k - 1].el }] : [],
      after: cue ? [{ text: contdCue(cue), indent: LAYOUT.character.indent, kind: 'character', el: nextEl }] : [],
    })
  }
  return { rows, breaks, keepWithNext: false, ...(cue ? { speech: { indexes, cue, suffix: cueSuffix } } : {}) }
}

/** One speech laid out in a dual-dialogue column. */
function columnRows(elements: ScriptElement[], indexes: number[], side: 0 | 1, cueSuffix: string): Row[] {
  const base = DUAL.columns[side]
  return indexes.flatMap((i) => {
    const el = elements[i]
    const { text, spans } = printable(el)
    const kind = el.type as 'character' | 'parenthetical' | 'dialogue'
    const col = DUAL[kind] ?? DUAL.dialogue
    const hanging = kind === 'parenthetical' ? 1 : 0
    return rowsFor(i, el.type, kind === 'character' ? text + cueSuffix : text, spans, {
      indent: base + col.indent,
      width: col.width,
      hangingIndent: hanging,
    })
  })
}

/** Two speeches side by side. Kept together on one page. */
function dualBlock(elements: ScriptElement[], left: number[], leftSuffix: string, right: number[], rightSuffix: string): Block {
  const l = columnRows(elements, left, 0, leftSuffix)
  const r = columnRows(elements, right, 1, rightSuffix)
  const rows: Row[] = [...spacing('character', left[0])]
  for (let k = 0; k < Math.max(l.length, r.length); k++) {
    const main = l[k] ?? { text: '', indent: 0, kind: 'dialogue' as const, el: r[k].el }
    rows.push(r[k] ? { ...main, right: r[k] } : main)
  }
  return { rows, breaks: new Map(), keepWithNext: false }
}

function simpleBlock(el: ScriptElement, index: number, sceneNumber?: string): Block {
  const lines = elementRows(el, index)
  if (sceneNumber && lines[0]) lines[0] = { ...lines[0], sceneNumber }
  const rows = [...spacing(el.type, index), ...lines]
  const breaks = new Map<number, Adornment>()
  if (el.type === 'action') {
    const offset = rows.length - lines.length
    for (let k = MIN_LINES_AT_SPLIT; k <= lines.length - MIN_LINES_AT_SPLIT; k++) breaks.set(offset + k, NO_ADORNMENT)
  }
  return { rows, breaks, keepWithNext: el.type === 'scene' || el.type === 'shot' }
}

const prints = (el: ScriptElement) => printable(el).text !== ''

function buildBlocks(elements: ScriptElement[], options: PaginateOptions, autoContd: number[]): Block[] {
  const blocks: Block[] = []
  let sceneCount = 0
  let lastSpeaker: string | null = null
  let i = 0
  while (i < elements.length) {
    const el = elements[i]
    if (el.type === 'pagebreak') {
      blocks.push({ rows: [], breaks: new Map(), keepWithNext: false, pageBreak: i })
      i++
      continue
    }
    if (!prints(el)) {
      i++
      continue
    }
    if (el.type === 'character' || el.type === 'parenthetical' || el.type === 'dialogue') {
      const indexes = [i++]
      while (i < elements.length) {
        const t = elements[i].type
        if (t !== 'parenthetical' && t !== 'dialogue') break
        if (prints(elements[i])) indexes.push(i)
        i++
      }
      const first = elements[indexes[0]]
      let suffix = ''
      if (first.type === 'character') {
        const cue = printable(first).text
        const name = characterName(cue)
        if (options.autoContd && name && name === lastSpeaker && !/\(CONT'D\)/i.test(cue)) {
          suffix = " (CONT'D)"
          autoContd.push(indexes[0])
        }
        lastSpeaker = name
      }
      const prev = blocks[blocks.length - 1]
      if (first.type === 'character' && first.dual && prev?.speech) {
        blocks[blocks.length - 1] = dualBlock(elements, prev.speech.indexes, prev.speech.suffix, indexes, suffix)
        lastSpeaker = null
      } else blocks.push(dialogueBlock(elements, indexes, suffix))
    } else {
      if (el.type === 'scene') {
        sceneCount++
        lastSpeaker = null
      }
      blocks.push(simpleBlock(el, i, el.type === 'scene' ? (sceneNumberOf(el) ?? String(sceneCount)) : undefined))
      i++
    }
  }

  // Glue headings to whatever follows them so they are never orphaned at the bottom of a page.
  const merged: Block[] = []
  for (const block of blocks) {
    const prev = merged[merged.length - 1]
    if (prev?.keepWithNext && block.pageBreak === undefined) {
      const offset = prev.rows.length
      merged[merged.length - 1] = {
        rows: [...prev.rows, ...block.rows],
        breaks: shiftBreaks(block.breaks, offset),
        keepWithNext: block.keepWithNext,
      }
    } else merged.push(block)
  }
  return merged
}

function shiftBreaks(breaks: Map<number, Adornment>, by: number, minKey = -Infinity): Map<number, Adornment> {
  const out = new Map<number, Adornment>()
  for (const [k, v] of breaks) if (k > minKey && k + by > 0) out.set(k + by, v)
  return out
}

function leadingBlanks(rows: Row[]): number {
  let n = 0
  while (n < rows.length && rows[n].kind === 'blank') n++
  return n
}

export function paginate(elements: ScriptElement[], options: PaginateOptions = {}): Pagination {
  const linesPerPage = options.linesPerPage ?? PAGE.linesPerPage
  const autoContd: number[] = []
  const pages: Row[][] = [[]]
  /** Pages started by a forced break begin right after it (even before non-printing elements). */
  const forcedStarts = new Map<number, number>()

  for (const block of buildBlocks(elements, options, autoContd)) {
    if (block.pageBreak !== undefined) {
      if (pages[pages.length - 1].length) pages.push([])
      if (pages.length > 1) forcedStarts.set(pages.length, block.pageBreak + 1)
      continue
    }
    let rows = block.rows
    let breaks = block.breaks
    for (;;) {
      const page = pages[pages.length - 1]
      if (page.length === 0) {
        const n = leadingBlanks(rows)
        rows = rows.slice(n)
        breaks = shiftBreaks(breaks, -n)
      }
      const room = linesPerPage - page.length
      if (rows.length <= room) {
        page.push(...rows)
        break
      }

      let at = -1
      let adornment = NO_ADORNMENT
      for (const [k, a] of breaks) {
        if (k > at && k < rows.length && k + a.before.length <= room) {
          at = k
          adornment = a
        }
      }
      if (at === -1) {
        if (page.length > 0) {
          pages.push([])
          continue
        }
        // Block is taller than a page with no legal break: split where we must.
        at = room
        adornment = NO_ADORNMENT
      }

      page.push(...rows.slice(0, at), ...adornment.before)
      pages.push([])
      const rest = rows.slice(at)
      const skip = leadingBlanks(rest)
      rows = [...adornment.after, ...rest.slice(skip)]
      breaks = shiftBreaks(breaks, adornment.after.length - at - skip, at + skip)
    }
  }

  if (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop()
  const result: Pagination = {
    pages: pages.map((rows, i) => ({ number: i + 1, rows })),
    pageStarts: [],
    autoContd,
  }
  for (const page of result.pages.slice(1)) {
    const first = page.rows.find((r) => r.kind !== 'blank')
    const el = forcedStarts.get(page.number) ?? first?.el
    if (el !== undefined && el < elements.length) result.pageStarts.push({ page: page.number, el })
  }
  return result
}
