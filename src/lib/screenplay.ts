import { emptyBackup, type BackupState } from './backup'
import { parseStyled, splitSceneNumber, stripNotes, type StyleSpan } from './markup'

// Core screenplay model. Formatting is derived entirely from an element's type,
// so the writer can never produce an incorrectly formatted script.

export const ELEMENT_TYPES = [
  'scene',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'centered',
  'section',
  'synopsis',
  'pagebreak',
] as const

export type ElementType = (typeof ELEMENT_TYPES)[number]

/** The seven screenplay elements: Ctrl+Alt+1…7 and the Shift+Tab cycle. */
export const PRIMARY_TYPES = ELEMENT_TYPES.slice(0, 7) as ElementType[]
/** Outline elements that never print: sections ("# Act One") and synopses. */
export const OUTLINE_TYPES: ElementType[] = ['section', 'synopsis']

export interface ScriptElement {
  type: ElementType
  /** Fountain inline markup: *emphasis*, [[notes]], and a trailing #scene number# on headings. */
  text: string
  /** On a character cue: speaks at the same time as the previous speech (dual dialogue). */
  dual?: boolean
}

export interface TitlePage {
  title: string
  credit: string
  author: string
  source: string
  draftDate: string
  contact: string
}

export interface PdfSettings {
  /** Scene numbers in both margins: for shooting scripts, not spec scripts. */
  sceneNumbers: boolean
}

export interface Script {
  id: string
  titlePage: TitlePage
  elements: ScriptElement[]
  backup: BackupState
  /** PDF export choices for this script. */
  pdf: PdfSettings
  createdAt: number
  updatedAt: number
}

export const ELEMENT_LABELS: Record<ElementType, string> = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  centered: 'Centered',
  section: 'Section',
  synopsis: 'Synopsis',
  pagebreak: 'Page Break',
}

// Page geometry, US Letter, Courier 12pt: 10 characters per inch, 6 lines per inch.
export const PAGE = {
  widthIn: 8.5,
  heightIn: 11,
  leftIn: 1.5,
  topIn: 1,
  charIn: 0.1,
  lineIn: 1 / 6,
  linesPerPage: 54, // 9in of body text
  textWidth: 60, // 6in between the margins, in characters
}

export interface ElementLayout {
  /** Characters from the left margin. */
  indent: number
  /** Maximum characters per line. */
  width: number
  /** Blank lines before the element (dropped at the top of a page). */
  spaceBefore: number
  uppercase: boolean
  alignRight: boolean
  alignCenter?: boolean
  /** Outline elements and page breaks don't print. */
  prints?: boolean
  /** Extra indent for wrapped lines (parentheticals hang inside the opening paren). */
  hangingIndent: number
}

export const LAYOUT: Record<ElementType, ElementLayout> = {
  scene: { indent: 0, width: 60, spaceBefore: 1, uppercase: true, alignRight: false, hangingIndent: 0 },
  action: { indent: 0, width: 60, spaceBefore: 1, uppercase: false, alignRight: false, hangingIndent: 0 },
  shot: { indent: 0, width: 60, spaceBefore: 1, uppercase: true, alignRight: false, hangingIndent: 0 },
  character: { indent: 22, width: 38, spaceBefore: 1, uppercase: true, alignRight: false, hangingIndent: 0 },
  parenthetical: { indent: 16, width: 24, spaceBefore: 0, uppercase: false, alignRight: false, hangingIndent: 1 },
  dialogue: { indent: 10, width: 35, spaceBefore: 0, uppercase: false, alignRight: false, hangingIndent: 0 },
  transition: { indent: 0, width: 60, spaceBefore: 1, uppercase: true, alignRight: true, hangingIndent: 0 },
  centered: { indent: 0, width: 60, spaceBefore: 1, uppercase: false, alignRight: false, alignCenter: true, hangingIndent: 0 },
  section: { indent: 0, width: 60, spaceBefore: 0, uppercase: false, alignRight: false, hangingIndent: 0, prints: false },
  synopsis: { indent: 0, width: 60, spaceBefore: 0, uppercase: false, alignRight: false, hangingIndent: 0, prints: false },
  pagebreak: { indent: 0, width: 60, spaceBefore: 0, uppercase: false, alignRight: false, hangingIndent: 0, prints: false },
}

/** Dual dialogue: two narrower columns side by side (offsets in characters from the left margin). */
export const DUAL = {
  columns: [0, 31],
  character: { indent: 8, width: 21 },
  parenthetical: { indent: 3, width: 22 },
  dialogue: { indent: 0, width: 28 },
}

/** Element created when pressing Enter at the end of an element. */
export const NEXT_ON_ENTER: Record<ElementType, ElementType> = {
  scene: 'action',
  action: 'action',
  shot: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'character',
  transition: 'scene',
  centered: 'action',
  section: 'scene',
  synopsis: 'scene',
  pagebreak: 'scene',
}

/** Element the current one becomes when pressing Tab. */
export const NEXT_ON_TAB: Record<ElementType, ElementType> = {
  action: 'character',
  character: 'action',
  dialogue: 'parenthetical',
  parenthetical: 'dialogue',
  scene: 'action',
  shot: 'action',
  transition: 'scene',
  centered: 'action',
  section: 'synopsis',
  synopsis: 'section',
  pagebreak: 'action',
}

export const SCENE_HEADING_RE = /^(int|ext|est|int\.?\/ext|i\/e)[.\s]/i

export function isDialogueType(type: ElementType): boolean {
  return type === 'character' || type === 'parenthetical' || type === 'dialogue'
}

/**
 * The text as it prints (case, parentheses; no markup, notes or scene number), with the ranges
 * that are bold/italic/underlined. Outline elements and page breaks print nothing.
 */
export function printable(el: ScriptElement): { text: string; spans: StyleSpan[] } {
  // Pagination asks for every element on every keystroke; parse each distinct line only once.
  const key = `${el.type}\u0000${el.text}`
  let result = printableCache.get(key)
  if (!result) {
    if (printableCache.size > CACHE_LIMIT) printableCache.clear()
    printableCache.set(key, (result = computePrintable(el)))
  }
  return result
}

const CACHE_LIMIT = 20_000
const printableCache = new Map<string, { text: string; spans: StyleSpan[] }>()

function computePrintable(el: ScriptElement): { text: string; spans: StyleSpan[] } {
  if (LAYOUT[el.type].prints === false) return { text: '', spans: [] }
  let markup = stripNotes(el.text)
  if (el.type === 'scene') markup = splitSceneNumber(markup).heading
  let { text, spans } = parseStyled(markup.replace(/\s+/g, ' ').trim())
  if (el.type === 'parenthetical') {
    const inner = stripParens(text)
    const shift = 1 - text.indexOf(inner) // where the inner text moves to inside "(…)"
    text = `(${inner})`
    spans = spans.map((s) => ({ ...s, from: Math.max(s.from + shift, 1), to: Math.min(s.to + shift, text.length - 1) }))
  }
  return { text: LAYOUT[el.type].uppercase ? text.toUpperCase() : text, spans }
}

/** The text as it appears on the page. */
export function displayText(el: ScriptElement): string {
  return printable(el).text
}

/** The heading's custom scene number (Fountain "#12A#"), if any. */
export function sceneNumberOf(el: ScriptElement): string | null {
  return el.type === 'scene' ? splitSceneNumber(stripNotes(el.text)).number : null
}

export function stripParens(text: string): string {
  return text.replace(/^\(\s*/, '').replace(/\s*\)$/, '')
}

/**
 * Word-wrap to a fixed character width, breaking at spaces and after hyphens and dashes inside words
 * (as browsers do, so the editor and the PDF wrap identically). Words longer than a line are hard-broken.
 */
export function wrap(text: string, width: number, hangingIndent = 0): string[] {
  const lines: string[] = []
  let line = ''
  const limit = () => (lines.length === 0 ? width : width - hangingIndent)
  for (const word of text.split(' ').filter(Boolean)) {
    // Break opportunities the browser also uses: after any hyphen inside a word ("well-|known",
    // "page-|5", "wait-|-what", "wait--|what") and on either side of an em dash ("so|—|yes").
    const parts = word.split(/(?<=\S-)(?=\S)|(?<=—)(?=[^\s—])|(?<=[^\s—])(?=—)/)
    parts.forEach((original, i) => {
      let part = original
      const joined = line ? line + (i === 0 ? ' ' : '') + part : part
      if (joined.length <= limit()) {
        line = joined
        return
      }
      if (line) {
        lines.push(line)
        line = ''
      }
      while (part.length > limit()) {
        lines.push(part.slice(0, limit()))
        part = part.slice(limit())
      }
      line = part
    })
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

export function emptyTitlePage(): TitlePage {
  return { title: '', credit: 'Written by', author: '', source: '', draftDate: '', contact: '' }
}

export function newScript(elements?: ScriptElement[], titlePage?: Partial<TitlePage>): Script {
  const now = Date.now()
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    titlePage: { ...emptyTitlePage(), ...titlePage },
    elements: elements?.length ? elements : [{ type: 'scene', text: '' }],
    backup: emptyBackup(),
    pdf: { sceneNumbers: false },
    createdAt: now,
    updatedAt: now,
  }
}

export function scriptFileName(script: Script): string {
  return (script.titlePage.title.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)
}
