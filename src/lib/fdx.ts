// Final Draft (.fdx) import and export. FDX is XML: a list of typed <Paragraph>s with styled <Text> runs.
// Some things don't map one-to-one (sections, synopses, notes, act breaks…); for those the caller passes
// the writer's choices, and *Issues() report what a file or script actually contains so we only ask
// about things that matter.
import { parseRuns, serializeRuns, splitSceneNumber, NOTE_RE, type Run } from './markup'
import { emptyTitlePage, stripParens, type ElementType, type ScriptElement, type TitlePage } from './screenplay'

// --- Export ---------------------------------------------------------------------------------

export interface FdxExportOptions {
  sections: 'general' | 'omit'
  synopses: 'summary' | 'general' | 'omit'
  notes: 'text' | 'omit'
  sceneNumbers: 'custom' | 'all'
}

export const DEFAULT_FDX_EXPORT: FdxExportOptions = { sections: 'general', synopses: 'summary', notes: 'text', sceneNumbers: 'custom' }

/** What in this script doesn't map one-to-one onto Final Draft. */
export function fdxExportIssues(elements: ScriptElement[]) {
  const count = (pred: (el: ScriptElement) => boolean) => elements.filter(pred).length
  return {
    sections: count((el) => el.type === 'section' && el.text.trim() !== ''),
    synopses: count((el) => el.type === 'synopsis' && el.text.trim() !== ''),
    notes: elements.reduce((n, el) => n + (el.text.match(NOTE_RE)?.length ?? 0), 0),
    scenes: count((el) => el.type === 'scene' && el.text.trim() !== ''),
  }
}

const FDX_TYPE: Partial<Record<ElementType, string>> = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  centered: 'Action',
}
const UPPERCASE: ElementType[] = ['scene', 'character', 'transition', 'shot']

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function textRuns(runs: Run[]): string {
  return runs
    .filter((r) => r.text)
    .map((r) => {
      const style = [r.bold && 'Bold', r.italic && 'Italic', r.underline && 'Underline'].filter(Boolean).join('+')
      return `<Text${style ? ` Style="${style}"` : ''}>${xml(r.text)}</Text>`
    })
    .join('')
}

function paragraph(type: string, runs: Run[], attrs: Record<string, string> = {}, inner = ''): string {
  const a = Object.entries({ Type: type, ...attrs })
    .map(([k, v]) => ` ${k}="${xml(v)}"`)
    .join('')
  return `    <Paragraph${a}>${inner}${textRuns(runs)}</Paragraph>`
}

// Page layout matching our formatting, so Final Draft (and other apps) needn't guess.
const ELEMENT_SETTINGS = [
  ['General', 1.5, 7.5, 0, 'Left', 0, ''],
  ['Scene Heading', 1.5, 7.5, 0, 'Left', 12, 'AllCaps'],
  ['Action', 1.5, 7.5, 0, 'Left', 12, ''],
  ['Character', 3.7, 7.5, 0, 'Left', 12, 'AllCaps'],
  ['Parenthetical', 3.1, 5.5, -0.1, 'Left', 0, ''],
  ['Dialogue', 2.5, 6.0, 0, 'Left', 0, ''],
  ['Transition', 5.5, 7.5, 0, 'Right', 12, 'AllCaps'],
  ['Shot', 1.5, 7.5, 0, 'Left', 12, 'AllCaps'],
] as const

function elementSettings(): string {
  return ELEMENT_SETTINGS.map(
    ([type, left, right, first, align, before, style]) =>
      `  <ElementSettings Type="${type}">\n` +
      `    <FontSpec Font="Courier Final Draft" Size="12" Style="${style}"/>\n` +
      `    <ParagraphSpec Alignment="${align}" FirstIndent="${first.toFixed(2)}" Leading="Regular" LeftIndent="${left.toFixed(2)}" RightIndent="${right.toFixed(2)}" SpaceBefore="${before}" Spacing="1" StartsNewPage="No"/>\n` +
      `  </ElementSettings>`,
  ).join('\n')
}

function titlePageXml(tp: TitlePage): string {
  if (!tp.title.trim()) return ''
  const para = (text: string, align: string) => paragraph('Text', [{ text, bold: false, italic: false, underline: false }], { Alignment: align })
  const lines: string[] = []
  for (let i = 0; i < 18; i++) lines.push(para('', 'Center'))
  for (const l of tp.title.toUpperCase().split('\n')) lines.push(para(l, 'Center'))
  for (const block of [tp.credit, tp.author, tp.source]) {
    if (!block.trim()) continue
    lines.push(para('', 'Center'))
    for (const l of block.split('\n')) lines.push(para(l, 'Center'))
  }
  for (let i = 0; i < 12; i++) lines.push(para('', 'Left'))
  for (const l of tp.contact.split('\n').filter((x) => x.trim())) lines.push(para(l, 'Left'))
  if (tp.draftDate.trim()) lines.push(para(tp.draftDate, 'Right'))
  return `  <TitlePage>\n    <Content>\n${lines.map((l) => '  ' + l).join('\n')}\n    </Content>\n  </TitlePage>\n`
}

export function toFdx(elements: ScriptElement[], titlePage: TitlePage, options: FdxExportOptions = DEFAULT_FDX_EXPORT): string {
  const out: string[] = []
  let sceneCount = 0
  let newPage = false
  /** Synopses waiting for the next scene heading (when they precede it). */
  let pendingSummary: string[] = []
  const lastSceneAt = { index: -1 }
  const runsOf = (el: ScriptElement) => {
    let text = el.text
    if (options.notes === 'omit') text = text.replace(NOTE_RE, ' ').replace(/\s+/g, ' ').trim()
    const runs = parseRuns(text)
    return UPPERCASE.includes(el.type) ? runs.map((r) => ({ ...r, text: r.text.toUpperCase() })) : runs
  }
  const summaryXml = (texts: string[]) =>
    `<SceneProperties><Summary>${texts.map((t) => `<Paragraph><Text>${xml(t)}</Text></Paragraph>`).join('')}</Summary></SceneProperties>`

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const attrs: Record<string, string> = {}
    if (el.type === 'pagebreak') {
      newPage = true
      continue
    }
    if (el.type === 'synopsis') {
      if (!el.text.trim() || options.synopses === 'omit') continue
      if (options.synopses === 'summary') {
        // A synopsis right after a scene heading describes it; otherwise it belongs to the next one.
        if (lastSceneAt.index >= 0 && lastSceneAt.index === out.length - 1) {
          out[lastSceneAt.index] = out[lastSceneAt.index].replace('>', `>${summaryXml([el.text.trim()])}`)
        } else pendingSummary.push(el.text.trim())
        continue
      }
      out.push(paragraph('General', parseRuns(el.text.trim()), newPage ? { StartsNewPage: 'Yes' } : {}))
      newPage = false
      continue
    }
    if (el.type === 'section') {
      if (!el.text.trim() || options.sections === 'omit') continue
      const text = el.text.replace(/^#+\s*/, '')
      out.push(paragraph('General', parseRuns(text), newPage ? { StartsNewPage: 'Yes' } : {}))
      newPage = false
      continue
    }
    if (!el.text.trim()) continue
    if (newPage) attrs.StartsNewPage = 'Yes'
    newPage = false

    if (el.type === 'scene') {
      sceneCount++
      const { heading, number } = splitSceneNumber(el.text)
      if (number) attrs.Number = number
      else if (options.sceneNumbers === 'all') attrs.Number = String(sceneCount)
      const inner = pendingSummary.length ? summaryXml(pendingSummary) : ''
      pendingSummary = []
      out.push(paragraph('Scene Heading', runsOf({ ...el, text: heading.trim() }), attrs, inner))
      lastSceneAt.index = out.length - 1
      continue
    }
    if (el.type === 'centered') attrs.Alignment = 'Center'
    if (el.type === 'parenthetical') {
      const runs = runsOf(el)
      const text = runs.map((r) => r.text).join('')
      const inner = stripParens(text)
      // Keep styling only when the whole parenthetical is plain; parens are added around it.
      out.push(paragraph('Parenthetical', inner === text && runs.length === 1 ? [{ ...runs[0], text: `(${inner})` }] : [{ text: `(${inner})`, bold: false, italic: false, underline: false }], attrs))
      continue
    }

    // Dual dialogue: wrap the previous speech and this one in <DualDialogue>.
    if (el.type === 'character' && el.dual) {
      let start = out.length - 1
      while (start >= 0 && /Type="(Parenthetical|Dialogue)"/.test(out[start])) start--
      if (start >= 0 && /Type="Character"/.test(out[start])) {
        const right: string[] = [paragraph('Character', runsOf(el), attrs)]
        while (i + 1 < elements.length && ['parenthetical', 'dialogue'].includes(elements[i + 1].type)) {
          const next = elements[++i]
          if (!next.text.trim()) continue
          right.push(
            next.type === 'parenthetical'
              ? paragraph('Parenthetical', [{ text: `(${stripParens(runsOf(next).map((r) => r.text).join(''))})`, bold: false, italic: false, underline: false }])
              : paragraph('Dialogue', runsOf(next)),
          )
        }
        const left = out.splice(start)
        const indent = (s: string) => s.replace(/^ {4}/, '        ')
        out.push(`    <Paragraph>\n      <DualDialogue>\n${[...left, ...right].map(indent).join('\n')}\n      </DualDialogue>\n    </Paragraph>`)
        continue
      }
    }
    out.push(paragraph(FDX_TYPE[el.type] ?? 'Action', runsOf(el), attrs))
  }

  // Synopses with no later scene heading to attach to are kept as General paragraphs, not dropped.
  for (const text of pendingSummary) out.push(paragraph('General', parseRuns(text)))

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n` +
    `<FinalDraft DocumentType="Script" Template="No" Version="5">\n` +
    `  <Content>\n${out.join('\n')}\n  </Content>\n` +
    titlePageXml(titlePage) +
    `${elementSettings()}\n` +
    `</FinalDraft>\n`
  )
}

// --- Import ---------------------------------------------------------------------------------

export interface FdxImportOptions {
  general: 'action' | 'omit'
  acts: 'section' | 'centered' | 'omit'
  notes: 'note' | 'omit'
  summaries: 'synopsis' | 'omit'
  sceneNumbers: 'keep' | 'drop'
  titlePage: 'guess' | 'ignore'
}

interface FdxParagraph {
  type: string
  runs: Run[]
  center: boolean
  newPage: boolean
  number: string | null
  notes: string[]
  summary: string[]
  dual: boolean
  /** Formatting we can't keep (strikeout, colors…). */
  droppedStyle: boolean
}

export interface ParsedFdx {
  paragraphs: FdxParagraph[]
  titleLines: { text: string; align: string }[]
}

const KNOWN: Record<string, ElementType> = {
  'Scene Heading': 'scene',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'parenthetical',
  Dialogue: 'dialogue',
  Transition: 'transition',
  Shot: 'shot',
}
const ACTS = ['New Act', 'End of Act', 'Act Break']

/** Reads an FDX file. Throws if it isn't one. */
export function parseFdx(source: string): ParsedFdx {
  const doc = new DOMParser().parseFromString(source, 'text/xml')
  const root = doc.documentElement
  if (!root || root.nodeName !== 'FinalDraft' || doc.getElementsByTagName('parsererror').length) {
    throw new Error("This doesn't look like a Final Draft (.fdx) file.")
  }
  const kids = (el: Element, name: string) => [...el.children].filter((c) => c.nodeName === name)
  const read = (p: Element, dual = false): FdxParagraph => {
    let droppedStyle = false
    const runs: Run[] = kids(p, 'Text').map((t) => {
      const style = (t.getAttribute('Style') ?? '').split('+')
      if (style.some((s) => s && !['Bold', 'Italic', 'Underline', 'AllCaps'].includes(s))) droppedStyle = true
      return { text: t.textContent ?? '', bold: style.includes('Bold'), italic: style.includes('Italic'), underline: style.includes('Underline') }
    })
    const textOf = (el: Element) => [...el.getElementsByTagName('Text')].map((t) => t.textContent ?? '').join('').trim()
    return {
      type: p.getAttribute('Type') ?? 'Action',
      runs,
      center: p.getAttribute('Alignment') === 'Center',
      newPage: p.getAttribute('StartsNewPage') === 'Yes',
      number: p.getAttribute('Number'),
      notes: [...p.getElementsByTagName('ScriptNote')].map(textOf).filter(Boolean),
      summary: [...p.getElementsByTagName('Summary')].flatMap((s) => kids(s, 'Paragraph').map(textOf)).filter(Boolean),
      dual,
      droppedStyle,
    }
  }

  const paragraphs: FdxParagraph[] = []
  const content = kids(root, 'Content')[0]
  for (const p of content ? kids(content, 'Paragraph') : []) {
    const dual = kids(p, 'DualDialogue')[0]
    if (!dual) {
      paragraphs.push(read(p))
      continue
    }
    // In a dual block, the second character cue starts the right-hand speech.
    let cues = 0
    for (const q of kids(dual, 'Paragraph')) {
      const isCue = q.getAttribute('Type') === 'Character'
      if (isCue) cues++
      paragraphs.push(read(q, isCue && cues === 2))
    }
  }

  const titleLines: ParsedFdx['titleLines'] = []
  const tp = kids(root, 'TitlePage')[0]
  const tpContent = tp && kids(tp, 'Content')[0]
  for (const p of tpContent ? kids(tpContent, 'Paragraph') : []) {
    titleLines.push({ text: kids(p, 'Text').map((t) => t.textContent ?? '').join('').trim(), align: p.getAttribute('Alignment') ?? 'Left' })
  }
  return { paragraphs, titleLines }
}

/** What in this file doesn't map one-to-one onto Scarf Ace. */
export function fdxImportIssues(parsed: ParsedFdx) {
  const ps = parsed.paragraphs
  const numbers = ps.filter((p) => p.type === 'Scene Heading' && p.number).map((p) => p.number!)
  return {
    general: ps.filter((p) => p.type === 'General' && !p.center && p.runs.some((r) => r.text.trim())).length,
    acts: ps.filter((p) => ACTS.includes(p.type)).length,
    notes: ps.reduce((n, p) => n + p.notes.length, 0),
    summaries: ps.filter((p) => p.summary.length).length,
    sceneNumbers: numbers.length,
    /** Scene numbers that aren't simply 1, 2, 3… (e.g. 12A): worth keeping. */
    customNumbers: numbers.some((n, i) => n !== String(i + 1)),
    titlePage: parsed.titleLines.some((l) => l.text),
    otherTypes: [...new Set(ps.map((p) => p.type).filter((t) => !KNOWN[t] && t !== 'General' && !ACTS.includes(t)))],
    droppedStyles: ps.filter((p) => p.droppedStyle).length,
  }
}

export function defaultImportOptions(issues: ReturnType<typeof fdxImportIssues>): FdxImportOptions {
  return {
    general: 'action',
    acts: 'section',
    notes: 'note',
    summaries: 'synopsis',
    sceneNumbers: issues.customNumbers ? 'keep' : 'drop',
    titlePage: 'guess',
  }
}

/** Best guess at title page fields from Final Draft's free-form title page. */
function guessTitlePage(lines: ParsedFdx['titleLines']): TitlePage {
  const tp = emptyTitlePage()
  tp.credit = ''
  const centered = lines.filter((l) => l.align === 'Center' && l.text).map((l) => l.text)
  const left = lines.filter((l) => l.align === 'Left' && l.text).map((l) => l.text)
  const right = lines.filter((l) => l.align === 'Right' && l.text).map((l) => l.text)
  const creditAt = centered.findIndex((t, i) => i > 0 && /^(written|screenplay|story|teleplay)?\s*by\b|^by$/i.test(t))
  if (creditAt > 0) {
    tp.title = centered.slice(0, creditAt).join('\n')
    tp.credit = centered[creditAt]
    tp.author = centered[creditAt + 1] ?? ''
    tp.source = centered.slice(creditAt + 2).join('\n')
  } else {
    tp.title = centered[0] ?? ''
    tp.author = centered.slice(1).join('\n')
  }
  tp.contact = left.join('\n')
  tp.draftDate = right.join('\n')
  return tp
}

export function fromFdx(parsed: ParsedFdx, options: FdxImportOptions): { elements: ScriptElement[]; titlePage: TitlePage } {
  const elements: ScriptElement[] = []
  const markup = (p: FdxParagraph) => serializeRuns(p.runs).replace(/\s+/g, ' ').trim()
  for (const p of parsed.paragraphs) {
    if (p.newPage && elements.length) elements.push({ type: 'pagebreak', text: '' })
    let text = markup(p)
    let type: ElementType | null = KNOWN[p.type] ?? null
    if (p.center && (p.type === 'Action' || p.type === 'General')) type = 'centered'
    else if (p.type === 'General') type = options.general === 'action' ? 'action' : null
    else if (ACTS.includes(p.type)) {
      type = options.acts === 'omit' ? null : options.acts === 'section' ? 'section' : 'centered'
      if (type === 'section') text = `# ${text}`
    } else if (!type) type = 'action' // unknown types keep their text as action
    if (type === 'parenthetical') text = stripParens(text)
    if (type === 'scene' && p.number && options.sceneNumbers === 'keep') text = `${text} #${p.number}#`
    if (options.notes === 'note' && p.notes.length) {
      text = [text, ...p.notes.map((n) => `[[${n.replace(/\s+/g, ' ')}]]`)].filter(Boolean).join(' ')
      type ??= 'action'
    }
    if (type && (text || type === 'section')) {
      const el: ScriptElement = { type, text }
      if (p.dual && type === 'character') el.dual = true
      elements.push(el)
    }
    if (type === 'scene' && options.summaries === 'synopsis') for (const s of p.summary) elements.push({ type: 'synopsis', text: s })
  }
  const titlePage = options.titlePage === 'guess' ? guessTitlePage(parsed.titleLines) : emptyTitlePage()
  if (options.titlePage === 'ignore') titlePage.credit = ''
  return { elements, titlePage }
}

/** Is this file's content Final Draft XML rather than Fountain? */
export function looksLikeFdx(name: string, text: string): boolean {
  return /\.fdx$/i.test(name) || /^\s*(<\?xml[^>]*>\s*)?<FinalDraft\b/.test(text)
}
