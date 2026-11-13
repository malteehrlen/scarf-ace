import { LAYOUT, PAGE, displayText, wrap, type ElementType, type ScriptElement } from './screenplay'

export interface Row {
  text: string
  /** Characters from the left margin. */
  indent: number
  kind: ElementType | 'blank' | 'more'
  /** Index of the source element. */
  el: number
}

export interface Page {
  number: number
  rows: Row[]
}

export interface Pagination {
  pages: Page[]
  /** For each page after the first, the index of the element it starts in. */
  pageStarts: { page: number; el: number }[]
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
}

const NO_ADORNMENT: Adornment = { before: [], after: [] }
const MIN_LINES_AT_SPLIT = 2

function blank(el: number): Row {
  return { text: '', indent: 0, kind: 'blank', el }
}

function elementRows(el: ScriptElement, index: number): Row[] {
  const layout = LAYOUT[el.type]
  return wrap(displayText(el), layout.width, layout.hangingIndent).map((text, i) => ({
    text,
    indent: layout.alignRight
      ? layout.indent + layout.width - text.length
      : layout.indent + (i > 0 ? layout.hangingIndent : 0),
    kind: el.type,
    el: index,
  }))
}

function spacing(type: ElementType, index: number): Row[] {
  return Array.from({ length: LAYOUT[type].spaceBefore }, () => blank(index))
}

/** A character cue with its parentheticals and dialogue (or an orphaned run of dialogue). */
function dialogueBlock(elements: ScriptElement[], indexes: number[]): Block {
  const rows: Row[] = []
  const breaks = new Map<number, Adornment>()
  const first = elements[indexes[0]]
  const cue = first.type === 'character' ? displayText(first) : null
  rows.push(...spacing('character', indexes[0]))

  const content: Row[] = []
  for (const i of indexes) {
    if (elements[i].type === 'character') rows.push(...elementRows(elements[i], i))
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
  return { rows, breaks, keepWithNext: false }
}

function contdCue(cue: string): string {
  return /\(CONT'D\)$/.test(cue) ? cue : `${cue} (CONT'D)`
}

function simpleBlock(el: ScriptElement, index: number): Block {
  const lines = elementRows(el, index)
  const rows = [...spacing(el.type, index), ...lines]
  const breaks = new Map<number, Adornment>()
  if (el.type === 'action') {
    const offset = rows.length - lines.length
    for (let k = MIN_LINES_AT_SPLIT; k <= lines.length - MIN_LINES_AT_SPLIT; k++) breaks.set(offset + k, NO_ADORNMENT)
  }
  return { rows, breaks, keepWithNext: el.type === 'scene' || el.type === 'shot' }
}

function buildBlocks(elements: ScriptElement[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < elements.length) {
    const el = elements[i]
    if (!el.text.trim()) {
      i++
      continue
    }
    if (el.type === 'character' || el.type === 'parenthetical' || el.type === 'dialogue') {
      const indexes = [i++]
      while (i < elements.length) {
        const t = elements[i].type
        if (t !== 'parenthetical' && t !== 'dialogue') break
        if (elements[i].text.trim()) indexes.push(i)
        i++
      }
      blocks.push(dialogueBlock(elements, indexes))
    } else {
      blocks.push(simpleBlock(el, i++))
    }
  }

  // Glue headings to whatever follows them so they are never orphaned at the bottom of a page.
  const merged: Block[] = []
  for (const block of blocks) {
    const prev = merged[merged.length - 1]
    if (prev?.keepWithNext) {
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

export function paginate(elements: ScriptElement[], linesPerPage = PAGE.linesPerPage): Pagination {
  const pages: Row[][] = [[]]

  for (const block of buildBlocks(elements)) {
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

  const result: Pagination = {
    pages: pages.map((rows, i) => ({ number: i + 1, rows })),
    pageStarts: [],
  }
  for (const page of result.pages.slice(1)) {
    const first = page.rows.find((r) => r.kind !== 'blank')
    if (first) result.pageStarts.push({ page: page.number, el: first.el })
  }
  return result
}
