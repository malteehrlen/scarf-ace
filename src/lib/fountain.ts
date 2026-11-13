// Fountain (https://fountain.io) import/export.
import {
  SCENE_HEADING_RE,
  emptyTitlePage,
  isDialogueType,
  stripParens,
  type ScriptElement,
  type TitlePage,
} from './screenplay'

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
    if (!text) continue
    const inDialogue = prev && isDialogueType(prev.type) && (el.type === 'parenthetical' || el.type === 'dialogue')
    if (prev && !inDialogue) out.push('')

    switch (el.type) {
      case 'scene':
        out.push(SCENE_HEADING_RE.test(text) ? text.toUpperCase() : `.${text.toUpperCase()}`)
        break
      case 'character': {
        const name = text.toUpperCase()
        out.push(/[A-Z]/.test(name.replace(/\(.*\)/, '')) ? name : `@${name}`)
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
        const ambiguous =
          SCENE_HEADING_RE.test(text) || isUpper(text) || /^[!@#~=>.]/.test(text) || /^\[\[/.test(text)
        out.push(ambiguous ? `!${text}` : text)
        break
      }
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
  text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '')

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
  const push = (type: ScriptElement['type'], t: string) => {
    const c = clean(t)
    if (c) elements.push({ type, text: c })
  }

  for (const para of paragraphs) {
    let rest = para.map((l) => l.trim())
    const first = rest[0]

    // Structural markup we don't model: sections, synopses, page breaks.
    if (/^(#|=)/.test(first)) {
      rest = rest.filter((l) => !/^(#|=)/.test(l))
      if (!rest.length) continue
    }

    const head = rest[0]
    if (/^\.[^.]/.test(head) || (SCENE_HEADING_RE.test(head) && !head.startsWith('!'))) {
      push('scene', head.replace(/^\./, '').replace(/\s*#[^#]*#\s*$/, ''))
      rest = rest.slice(1)
      if (rest.length) push('action', rest.join(' '))
      continue
    }
    if (head.startsWith('!')) {
      push('action', [head.slice(1), ...rest.slice(1)].join(' '))
      continue
    }
    if (head.startsWith('>') && head.endsWith('<')) {
      push('action', head.slice(1, -1))
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
    const isCharacter = head.startsWith('@') || (rest.length > 1 && isUpper(name.replace(/\(.*?\)/g, '')))
    if (isCharacter) {
      push('character', name.replace(/^@/, ''))
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
