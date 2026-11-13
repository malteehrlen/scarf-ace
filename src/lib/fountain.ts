// Fountain (https://fountain.io) import/export.
import {
  SCENE_HEADING_RE,
  emptyTitlePage,
  isDialogueType,
  stripParens,
  type ScriptElement,
  type TitlePage,
} from './screenplay'
import { stripNotes } from './markup'

const TITLE_KEYS: Record<string, keyof TitlePage> = {
  title: 'title',
  credit: 'credit',
  author: 'author',
  authors: 'author',
  source: 'source',
  'draft date': 'draftDate',
  contact: 'contact',
}

const isUpper = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase()
const looksLikeTransition = (s: string) => isUpper(s) && /TO:$/.test(s)

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function toFountain(elements: ScriptElement[], titlePage?: TitlePage): string {
  const out: string[] = []

  if (titlePage) {
    const entries: [string, string][] = [
      ['Title', titlePage.title],
      ['Credit', titlePage.title ? titlePage.credit : ''],
      ['Author', titlePage.author],
      ['Source', titlePage.source],
      ['Draft date', titlePage.draftDate],
      ['Contact', titlePage.contact],
    ]
    const lines: string[] = []
    for (const [key, value] of entries) {
      const parts = value.split('\n').map((s) => s.trim()).filter(Boolean)
      if (!parts.length) continue
      if (parts.length === 1) lines.push(`${key}: ${parts[0]}`)
      else lines.push(`${key}:`, ...parts.map((p) => `    ${p}`))
    }
    if (lines.length) out.push(lines.join('\n'), '')
  }

  let prev: ScriptElement | undefined
  for (const el of elements) {
    const text = clean(el.text)
    if (!text && el.type !== 'pagebreak') continue
    const inDialogue = prev && isDialogueType(prev.type) && (el.type === 'parenthetical' || el.type === 'dialogue')
    if (prev && !inDialogue) out.push('')

    switch (el.type) {
      case 'scene':
        out.push(SCENE_HEADING_RE.test(text) ? text.toUpperCase() : `.${text.toUpperCase()}`)
        break
      case 'character': {
        const name = text.toUpperCase()
        const cue = /[A-Z]/.test(name.replace(/\(.*\)/, '')) ? name : `@${name}`
        out.push(el.dual ? `${cue} ^` : cue)
        break
      }
      case 'parenthetical':
        out.push(`(${stripParens(text)})`)
        break
      case 'dialogue':
        out.push(text)
        break
      case 'transition': {
        const t = text.toUpperCase()
        out.push(looksLikeTransition(t) ? t : `> ${t}`)
        break
      }
      case 'shot':
        // Fountain has no shot element; emit as forced action in caps.
        out.push(`!${text.toUpperCase()}`)
        break
      case 'action': {
        const ambiguous = SCENE_HEADING_RE.test(text) || isUpper(text) || /^[!@#~=>.]/.test(text)
        out.push(ambiguous ? `!${text}` : text)
        break
      }
      case 'centered':
        out.push(`> ${text} <`)
        break
      case 'section':
        out.push(text.startsWith('#') ? text : `# ${text}`)
        break
      case 'synopsis':
        out.push(`= ${text}`)
        break
      case 'pagebreak':
        out.push('===')
        break
    }
    prev = el
  }
  return out.join('\n') + '\n'
}

export function fromFountain(
  source: string,
  options: { titlePage?: boolean } = {},
): { elements: ScriptElement[]; titlePage: TitlePage } {
  let text = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  // Boneyard (/* … */) is kept as notes, one per paragraph, so nothing is lost on import.
  text = text.replace(/\/\*([\s\S]*?)\*\//g, (_m, inner: string) =>
    inner
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((p) => `[[${p}]]`)
      .join('\n\n'),
  )
  // Notes may span lines; keep each on one line so paragraphs stay intact.
  text = text.replace(/\[\[[\s\S]*?\]\]/g, (m) => m.replace(/\s+/g, ' '))

  const titlePage = emptyTitlePage()
  let lines = text.split('\n')

  // Title page: key/value pairs before the first blank line.
  if (options.titlePage !== false && /^[A-Za-z][A-Za-z ]*:/.test(lines[0] ?? '')) {
    let key: keyof TitlePage | null = null
    let i = 0
    let sawCredit = false
    for (; i < lines.length && lines[i].trim(); i++) {
      const line = lines[i]
      const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(line)
      if (m && !/^\s/.test(line)) {
        key = TITLE_KEYS[m[1].trim().toLowerCase()] ?? null
        if (key === 'credit') sawCredit = true
        if (key) titlePage[key] = m[2].trim()
      } else if (key) {
        titlePage[key] = [titlePage[key], line.trim()].filter(Boolean).join('\n')
      }
    }
    if (!sawCredit && !titlePage.title) titlePage.credit = ''
    lines = lines.slice(i)
  }

  // Group consecutive non-blank lines into paragraphs.
  const paragraphs: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim()) current.push(line)
    else if (current.length) {
      paragraphs.push(current)
      current = []
    }
  }
  if (current.length) paragraphs.push(current)

  const elements: ScriptElement[] = []
  const push = (type: ScriptElement['type'], t: string, extra: Partial<ScriptElement> = {}) => {
    const c = clean(t)
    if (c) elements.push({ type, text: c, ...extra })
  }

  // Sections (#), synopses (=) and page breaks (===) are line-level; split paragraphs around them.
  const blocks: string[][] = []
  for (const para of paragraphs) {
    let run: string[] = []
    for (const line of para.map((l) => l.trim())) {
      if (/^(#|=)/.test(line)) {
        if (run.length) blocks.push(run)
        blocks.push([line])
        run = []
      } else run.push(line)
    }
    if (run.length) blocks.push(run)
  }

  for (let rest of blocks) {
    const head = rest[0]
    if (/^={3,}$/.test(head)) {
      elements.push({ type: 'pagebreak', text: '' })
      continue
    }
    if (head.startsWith('#')) {
      const m = /^(#+)\s*(.*)$/.exec(head)!
      push('section', `${m[1]} ${m[2]}`)
      continue
    }
    if (head.startsWith('=')) {
      push('synopsis', head.slice(1))
      continue
    }
    if (/^\.[^.]/.test(head) || (SCENE_HEADING_RE.test(head) && !head.startsWith('!'))) {
      push('scene', head.replace(/^\./, ''))
      rest = rest.slice(1)
      if (rest.length) push('action', rest.join(' '))
      continue
    }
    if (head.startsWith('!')) {
      push('action', [head.slice(1), ...rest.slice(1)].join(' '))
      continue
    }
    if (head.startsWith('>') && head.endsWith('<')) {
      push('centered', head.slice(1, -1))
      continue
    }
    if (head.startsWith('>')) {
      push('transition', head.slice(1))
      continue
    }
    if (rest.length === 1 && looksLikeTransition(head)) {
      push('transition', head)
      continue
    }
    const name = head.replace(/\s*\^$/, '')
    // Notes don't count: an all-caps note on its own line is not a character cue.
    const isCharacter = head.startsWith('@') || (rest.length > 1 && isUpper(stripNotes(name).replace(/\(.*?\)/g, '').trim()))
    if (isCharacter) {
      push('character', name.replace(/^@/, ''), head.endsWith('^') ? { dual: true } : {})
      let dialogue: string[] = []
      const flush = () => {
        if (dialogue.length) push('dialogue', dialogue.join(' '))
        dialogue = []
      }
      for (const line of rest.slice(1)) {
        if (line.startsWith('(') && line.endsWith(')')) {
          flush()
          push('parenthetical', stripParens(line))
        } else dialogue.push(line.replace(/^~/, ''))
      }
      flush()
      continue
    }
    push('action', rest.join(' '))
  }

  return { elements, titlePage }
}
