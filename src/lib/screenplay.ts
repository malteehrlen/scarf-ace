import { emptyBackup, type BackupState } from './backup'

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
] as const

export type ElementType = (typeof ELEMENT_TYPES)[number]

export interface ScriptElement {
  type: ElementType
  text: string
}

export interface TitlePage {
  title: string
  credit: string
  author: string
  source: string
  draftDate: string
  contact: string
}

export interface Script {
  id: string
  titlePage: TitlePage
  elements: ScriptElement[]
  backup: BackupState
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
}

export const SCENE_HEADING_RE = /^(int|ext|est|int\.?\/ext|i\/e)[.\s]/i

export function isDialogueType(type: ElementType): boolean {
  return type === 'character' || type === 'parenthetical' || type === 'dialogue'
}

/** The text as it appears on the page (case, parentheses). */
export function displayText(el: ScriptElement): string {
  let text = el.text.replace(/\s+/g, ' ').trim()
  if (el.type === 'parenthetical') text = `(${stripParens(text)})`
  return LAYOUT[el.type].uppercase ? text.toUpperCase() : text
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
    // "page-|5", "wait-|-what", "wait--|what") and after an em dash ("so—|yes").
    const parts = word.split(/(?<=\S-)(?=\S)|(?<=—)(?=[^\s—])/)
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
    createdAt: now,
    updatedAt: now,
  }
}

export function scriptFileName(script: Script): string {
  return (script.titlePage.title.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)
}
