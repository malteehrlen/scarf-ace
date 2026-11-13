// Fountain inline markup inside an element's text:
//   emphasis  ***bold italic***  **bold**  *italic*  _underline_   (backslash escapes a literal \* \_ \\)
//   notes     [[like this]]        never printed
//   scene #   INT. HOUSE - DAY #12A#   (scene headings only)
// Element text is stored as markup; the editor shows emphasis as marks, the PDF prints it.

export interface Style {
  bold: boolean
  italic: boolean
  underline: boolean
}

export interface Run extends Style {
  text: string
}

/** A styled range [from, to) in plain text. */
export interface StyleSpan extends Style {
  from: number
  to: number
}

const PLAIN: Style = { bold: false, italic: false, underline: false }

export const NOTE_RE = /\[\[[\s\S]*?\]\]/g
export const SCENE_NUMBER_RE = /\s*#([^#\s][^#]*)#\s*$/

export function stripNotes(text: string): string {
  return text.replace(NOTE_RE, ' ')
}

/** "INT. HOUSE #12A#" → { heading: "INT. HOUSE", number: "12A" } */
export function splitSceneNumber(text: string): { heading: string; number: string | null } {
  const m = SCENE_NUMBER_RE.exec(text)
  return m ? { heading: text.slice(0, m.index), number: m[1].trim() } : { heading: text, number: null }
}

type Marker = '***' | '**' | '*' | '_'
interface Token {
  kind: 'text' | 'marker'
  value: string
}

function tokenize(markup: string): Token[] {
  const tokens: Token[] = []
  let text = ''
  const flush = () => {
    if (text) tokens.push({ kind: 'text', value: text })
    text = ''
  }
  for (let i = 0; i < markup.length; i++) {
    const c = markup[i]
    if (c === '\\' && i + 1 < markup.length && '*_\\'.includes(markup[i + 1])) {
      text += markup[++i]
    } else if (c === '*') {
      let n = 1
      while (markup[i + n] === '*' && n < 3) n++
      flush()
      tokens.push({ kind: 'marker', value: '*'.repeat(n) })
      i += n - 1
    } else if (c === '_') {
      flush()
      tokens.push({ kind: 'marker', value: '_' })
    } else text += c
  }
  flush()
  return tokens
}

/** Parses emphasis into styled runs. Unpaired markers are literal text. */
export function parseRuns(markup: string): Run[] {
  const tokens = tokenize(markup)
  // Pair each marker with the next marker of the same kind.
  const pair = new Map<number, number>()
  const open = new Map<Marker, number>()
  tokens.forEach((t, i) => {
    if (t.kind !== 'marker') return
    const m = t.value as Marker
    const at = open.get(m)
    if (at === undefined) open.set(m, i)
    else {
      pair.set(at, i)
      pair.set(i, at)
      open.delete(m)
    }
  })

  const runs: Run[] = []
  const style = { ...PLAIN }
  const push = (text: string) => {
    const last = runs[runs.length - 1]
    if (last && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline) last.text += text
    else runs.push({ text, ...style })
  }
  tokens.forEach((t, i) => {
    if (t.kind === 'text') return push(t.value)
    if (!pair.has(i)) return push(t.value)
    const on = pair.get(i)! > i
    if (t.value === '_') style.underline = on
    else if (t.value === '*') style.italic = on
    else if (t.value === '**') style.bold = on
    else {
      style.bold = on
      style.italic = on
    }
  })
  return runs.filter((r) => r.text)
}

export function plainText(markup: string): string {
  return parseRuns(markup)
    .map((r) => r.text)
    .join('')
}

/** Plain text plus the ranges that carry emphasis. */
export function parseStyled(markup: string): { text: string; spans: StyleSpan[] } {
  let text = ''
  const spans: StyleSpan[] = []
  for (const run of parseRuns(markup)) {
    if (run.bold || run.italic || run.underline) {
      spans.push({ from: text.length, to: text.length + run.text.length, bold: run.bold, italic: run.italic, underline: run.underline })
    }
    text += run.text
  }
  return { text, spans }
}

const escape = (text: string) => text.replace(/[\\*_]/g, (c) => `\\${c}`)

/** Turns styled runs back into markup (escaping literal * _ \). */
export function serializeRuns(runs: Run[]): string {
  let out = ''
  for (const run of runs) {
    if (!run.text) continue
    // Keep surrounding spaces outside the markers: "**bold** text", not "**bold **text".
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!
    const [, lead, core, trail] = m
    if (!core) {
      out += escape(run.text)
      continue
    }
    let open = ''
    let close = ''
    if (run.underline) {
      open += '_'
      close = '_' + close
    }
    if (run.bold && run.italic) {
      open += '***'
      close = '***' + close
    } else if (run.bold) {
      open += '**'
      close = '**' + close
    } else if (run.italic) {
      open += '*'
      close = '*' + close
    }
    out += lead + open + escape(core) + close + trail
  }
  return out
}

/** Restyles a slice of styled text: spans clipped to [from, to) and shifted to start at 0. */
export function sliceSpans(spans: StyleSpan[], from: number, to: number): StyleSpan[] {
  return spans
    .filter((s) => s.to > from && s.from < to)
    .map((s) => ({ ...s, from: Math.max(s.from, from) - from, to: Math.min(s.to, to) - from }))
}

/** Splits a line of text into runs according to spans. */
export function runsOf(text: string, spans: StyleSpan[]): Run[] {
  const runs: Run[] = []
  let pos = 0
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    if (s.from > pos) runs.push({ text: text.slice(pos, s.from), ...PLAIN })
    runs.push({ text: text.slice(s.from, s.to), bold: s.bold, italic: s.italic, underline: s.underline })
    pos = s.to
  }
  if (pos < text.length) runs.push({ text: text.slice(pos), ...PLAIN })
  return runs.filter((r) => r.text)
}
