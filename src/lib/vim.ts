// Optional Vim-style modal editing. Each screenplay element is one "line": j/k move between
// elements, dd/yy/p work on whole elements (keeping their types), and [[ / ]] jump between scenes.
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { closeHistory, redo, undo } from 'prosemirror-history'
import { joinBackward } from 'prosemirror-commands'
import type { Node as PMNode } from 'prosemirror-model'
import { NEXT_ON_ENTER, type ElementType } from './screenplay'

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line'

export interface VimState {
  enabled: boolean
  mode: VimMode
  /** Keys of an incomplete command, or the command line when it starts with ':'. */
  pending: string[]
  /** Visual mode: linear offsets of the anchor and the cursor, and the cursor's document position. */
  anchor: number
  head: number
  cursor: number
  message: string
  /** Last search, highlighted while `highlight` is on (cleared by :noh). */
  search: { pattern: string; forward: boolean } | null
  highlight: boolean
}

export interface VimOptions {
  enabled: boolean
  /** Enter in insert mode (used when repeating an insert with '.'). */
  enter: Command
  onWrite?: () => void
}

/** The parts of an EditorView the Vim layer uses; the DOM-dependent parts are optional for tests. */
export interface VimView {
  readonly state: EditorState
  dispatch(tr: Transaction): void
  dom?: HTMLElement
  coordsAtPos?(pos: number, side?: number): { left: number; top: number; bottom: number }
  posAtCoords?(coords: { left: number; top: number }): { pos: number } | null
  /** Visible vertical range in client coordinates; defaults to the scrolling editor pane. */
  viewport?(): { top: number; bottom: number }
}

export const vimKey = new PluginKey<VimState>('vim')

// --- Text model: the document as lines of plain text joined by '\n' -------------------------

class Lines {
  starts: number[] = []
  lens: number[] = []
  offs: number[] = []
  types: ElementType[] = []
  text: string

  constructor(readonly doc: PMNode) {
    const parts: string[] = []
    let off = 0
    doc.forEach((node, pos) => {
      this.starts.push(pos)
      this.lens.push(node.content.size)
      this.offs.push(off)
      this.types.push(node.attrs.type)
      parts.push(node.textContent)
      off += node.content.size + 1
    })
    this.text = parts.join('\n')
  }

  get count() {
    return this.starts.length
  }
  get lastLine() {
    return this.count - 1
  }
  lineAt(off: number) {
    let lo = 0
    let hi = this.count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.offs[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  /** Offset just past the line's last character. */
  end(i: number) {
    return this.offs[i] + this.lens[i]
  }
  /** Offset of the line's last character (or its start when empty). */
  last(i: number) {
    return this.lens[i] ? this.end(i) - 1 : this.offs[i]
  }
  lineText(i: number) {
    return this.text.slice(this.offs[i], this.end(i))
  }
  firstNonBlank(i: number) {
    const m = /\S/.exec(this.lineText(i))
    return Math.min(this.offs[i] + (m ? m.index : 0), this.last(i))
  }
  nodeEnd(i: number) {
    return i + 1 < this.count ? this.starts[i + 1] : this.doc.content.size
  }
  pos(off: number) {
    const i = this.lineAt(off)
    return this.starts[i] + 1 + Math.min(Math.max(off - this.offs[i], 0), this.lens[i])
  }
  off(pos: number) {
    const i = Math.min(this.doc.resolve(Math.min(pos, this.doc.content.size)).index(0), this.lastLine)
    return this.offs[i] + Math.min(Math.max(pos - this.starts[i] - 1, 0), this.lens[i])
  }
  isEmptyLine(off: number) {
    const s = this.text
    return (off === s.length || s[off] === '\n') && (off === 0 || s[off - 1] === '\n')
  }
}

const cls = (ch: string | undefined, big: boolean) =>
  ch === undefined || /\s/.test(ch) ? 0 : big || /\w/.test(ch) ? 1 : 2

function wordForward(L: Lines, o: number, big: boolean) {
  const s = L.text
  let i = o
  const c = cls(s[i], big)
  if (c !== 0) while (i < s.length && cls(s[i], big) === c) i++
  while (i < s.length && cls(s[i], big) === 0) {
    i++
    if (s[i - 1] === '\n' && L.isEmptyLine(i)) return i
  }
  return i
}

function wordEnd(L: Lines, o: number, big: boolean) {
  const s = L.text
  let i = o + 1
  while (i < s.length && cls(s[i], big) === 0) i++
  if (i >= s.length) return Math.max(s.length - 1, 0)
  const c = cls(s[i], big)
  while (i + 1 < s.length && cls(s[i + 1], big) === c) i++
  return i
}

function wordBack(L: Lines, o: number, big: boolean) {
  const s = L.text
  let i = o - 1
  while (i >= 0 && cls(s[i], big) === 0) {
    if (L.isEmptyLine(i)) return i
    i--
  }
  if (i < 0) return 0
  const c = cls(s[i], big)
  while (i > 0 && cls(s[i - 1], big) === c) i--
  return i
}

// --- Search --------------------------------------------------------------------------------

/**
 * Compiles a search pattern. Smartcase: case-insensitive unless the pattern has a capital.
 * Patterns are JS regexes with Vim's \< \> word boundaries; invalid ones match literally.
 */
export function compileSearch(pattern: string): RegExp | null {
  if (!pattern) return null
  const flags = /[A-Z]/.test(pattern.replace(/\\./g, '')) ? 'g' : 'gi'
  try {
    return new RegExp(pattern.replace(/\\[<>]/g, '\\b'), flags)
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  }
}

const MAX_MATCHES = 5000

function findMatches(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while (out.length < MAX_MATCHES && (m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

/** The count-th match start after (or before) `from`, wrapping around the document. */
function searchFrom(L: Lines, from: number, pattern: string, forward: boolean, count = 1) {
  const re = compileSearch(pattern)
  const matches = re ? findMatches(L.text, re) : []
  if (!matches.length) return null
  let pos = from
  let wrapped = false
  for (let k = 0; k < count; k++) {
    let next = forward ? matches.find((m) => m[0] > pos) : matches.findLast((m) => m[0] < pos)
    if (!next) {
      wrapped = true
      next = forward ? matches[0] : matches[matches.length - 1]
    }
    pos = next[0]
  }
  return { off: pos, wrapped }
}

// --- Parsing -------------------------------------------------------------------------------

const OPERATORS = new Set(['d', 'c', 'y'])
const SIMPLE_MOTIONS = new Set(['h', 'l', 'j', 'k', 'w', 'W', 'b', 'B', 'e', 'E', '0', '^', '$', 'G', '<CR>', '+', '-', '<BS>', ' ', ';', ',', 'n', 'N', '*', '#', 'H', 'M', 'L'])
const COMMANDS = new Set(['i', 'a', 'I', 'A', 'o', 'O', 'x', 'X', '<Del>', 's', 'S', 'D', 'C', 'Y', 'p', 'P', 'u', '<C-r>', 'J', '~', 'v', 'V', '.', '<C-d>', '<C-u>', ':'])
/** Commands that change the document and can be repeated with '.'. */
const CHANGES = new Set(['i', 'a', 'I', 'A', 'o', 'O', 'x', 'X', '<Del>', 's', 'S', 'D', 'C', 'p', 'P', 'J', '~', 'r'])

type Target = { type: 'line' } | { type: 'motion'; motion: string[] } | { type: 'object'; obj: string[] }

type Parsed =
  | { kind: 'incomplete' }
  | { kind: 'invalid' }
  | { kind: 'motion'; count: number; hasCount: boolean; motion: string[] }
  | { kind: 'operator'; count: number; hasCount: boolean; op: string; target: Target }
  | { kind: 'command'; count: number; hasCount: boolean; cmd: string[] }

function parseMotion(tokens: string[], i: number): string[] | 'incomplete' | null {
  const t = tokens[i]
  if (SIMPLE_MOTIONS.has(t)) return [t]
  if (t === 'f' || t === 'F' || t === 't' || t === 'T') return i + 1 < tokens.length ? [t, tokens[i + 1]] : 'incomplete'
  if (t === 'g' || t === '[' || t === ']') {
    if (i + 1 >= tokens.length) return 'incomplete'
    const u = tokens[i + 1]
    // gg, plus screen-row motions: gj gk, and gh gl / g0 g^ g$ for the row's start and end.
    if (t === 'g' && 'gjkhl0^$'.includes(u) && u.length === 1) return ['g', u]
    if (t !== 'g' && u === t) return [t, u]
  }
  return null
}

function parse(tokens: string[]): Parsed {
  let i = 0
  const readCount = () => {
    let s = ''
    while (i < tokens.length && /^[0-9]$/.test(tokens[i]) && !(s === '' && tokens[i] === '0')) s += tokens[i++]
    return s ? parseInt(s, 10) : null
  }
  const c1 = readCount()
  if (i >= tokens.length) return { kind: 'incomplete' }
  const t = tokens[i]

  if (OPERATORS.has(t)) {
    i++
    const c2 = readCount()
    const count = (c1 ?? 1) * (c2 ?? 1)
    const hasCount = c1 != null || c2 != null
    if (i >= tokens.length) return { kind: 'incomplete' }
    const u = tokens[i]
    if (u === t) return { kind: 'operator', count, hasCount, op: t, target: { type: 'line' } }
    if (u === 'i' || u === 'a') {
      if (i + 1 >= tokens.length) return { kind: 'incomplete' }
      return { kind: 'operator', count, hasCount, op: t, target: { type: 'object', obj: [u, tokens[i + 1]] } }
    }
    const motion = parseMotion(tokens, i)
    if (motion === 'incomplete') return { kind: 'incomplete' }
    if (!motion) return { kind: 'invalid' }
    return { kind: 'operator', count, hasCount, op: t, target: { type: 'motion', motion } }
  }

  const motion = parseMotion(tokens, i)
  if (motion === 'incomplete') return { kind: 'incomplete' }
  if (motion) return { kind: 'motion', count: c1 ?? 1, hasCount: c1 != null, motion }

  const base = { count: c1 ?? 1, hasCount: c1 != null }
  if (t === 'r') return i + 1 < tokens.length ? { kind: 'command', ...base, cmd: ['r', tokens[i + 1]] } : { kind: 'incomplete' }
  if (t === 'z') {
    if (i + 1 >= tokens.length) return { kind: 'incomplete' }
    return tokens[i + 1] === 'z' ? { kind: 'command', ...base, cmd: ['z', 'z'] } : { kind: 'invalid' }
  }
  if (COMMANDS.has(t)) return { kind: 'command', ...base, cmd: [t] }
  return { kind: 'invalid' }
}

const isScreenVertical = (m: string[]) => m[0] === 'g' && (m[1] === 'j' || m[1] === 'k')

// --- Keyboard events -------------------------------------------------------------------------

/** Converts a key event to a Vim token, or null for keys Vim leaves to the editor (arrows, Tab, shortcuts). */
export function tokenOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>): string | null {
  if (e.isComposing || e.metaKey) return null
  const k = e.key
  if (e.ctrlKey && !e.altKey) {
    if (k === '[') return '<Esc>'
    return /^[a-z]$/i.test(k) ? `<C-${k.toLowerCase()}>` : null
  }
  if (e.altKey && !e.ctrlKey) return null
  // Ctrl+Alt+digit sets the element type; Ctrl+Alt otherwise is AltGr typing a character.
  if (e.ctrlKey && e.altKey && /^[0-9]$/.test(k)) return null
  const named: Record<string, string> = { Escape: '<Esc>', Enter: '<CR>', Backspace: '<BS>', Delete: '<Del>' }
  if (named[k]) return named[k]
  return k.length === 1 ? k : null
}

// --- The controller ----------------------------------------------------------------------------

type Register = { linewise: false; text: string } | { linewise: true; elements: { type: ElementType; text: string }[] }

interface MotionResult {
  off: number
  linewise: boolean
  inclusive: boolean
}

const controllers = new WeakMap<Plugin, VimController>()

class VimController {
  register: Register = { linewise: false, text: '' }
  lastFind: { cmd: string; ch: string } | null = null
  goalCol: number | null = null
  /** Horizontal pixel position gj/gk try to keep. */
  goalX: number | null = null
  /** The view handling the current key; screen motions need its layout. */
  view: VimView | null = null
  lastChange: { tokens: string[]; insert: string[] } | null = null
  recording = false
  replaying = false

  constructor(readonly options: VimOptions) {}

  vim(state: EditorState) {
    return vimKey.getState(state)!
  }

  /** Dispatches a transaction tagged as ours, with optional changes to the Vim state. */
  /** State changes produced while computing a motion (search, messages), applied on the next commit. */
  extra: Partial<VimState> = {}

  commit(view: VimView, tr: Transaction, patch: Partial<VimState> = {}, scroll = true) {
    tr.setMeta(vimKey, { pending: [], message: '', ...this.extra, ...patch })
    this.extra = {}
    view.dispatch(scroll ? tr.scrollIntoView() : tr)
  }

  /** Updates pending keys; a message set while handling the key (e.g. "Pattern not found") is kept unless one is given. */
  setPending(view: VimView, pending: string[], message?: string) {
    this.commit(view, view.state.tr, message === undefined ? { pending } : { pending, message }, false)
  }

  /** Handles one token. Returns false to let the editor handle the key normally. */
  key(view: VimView, token: string): boolean {
    const vs = this.vim(view.state)
    if (!vs.enabled) return false

    if (vs.mode === 'insert') {
      if (token === '<Esc>') {
        this.exitInsert(view)
        return true
      }
      if (this.recording && (token.length === 1 || token === '<CR>' || token === '<BS>')) this.lastChange?.insert.push(token)
      return false
    }

    this.view = view
    this.search = vs.search
    this.extra = {}
    if ([':', '/', '?'].includes(vs.pending[0])) return this.commandLine(view, vs.pending, token)
    if (!vs.pending.length && (token === '/' || token === '?')) return this.setPending(view, [token]), true

    if (token.startsWith('<C-') && !['<C-r>', '<C-d>', '<C-u>'].includes(token)) return false
    if (token === '<Esc>') {
      if (vs.mode === 'visual' || vs.mode === 'visual-line') this.exitVisual(view)
      else this.setPending(view, [])
      return true
    }

    const tokens = [...vs.pending, token]
    const visual = vs.mode === 'visual' || vs.mode === 'visual-line'
    if (visual && this.visualKey(view, tokens)) return true

    const parsed = parse(tokens)
    if (parsed.kind === 'incomplete') this.setPending(view, tokens)
    else if (parsed.kind === 'invalid') this.setPending(view, [])
    else if (visual) {
      if (parsed.kind === 'motion') this.visualMotion(view, parsed)
      else this.setPending(view, [])
    } else this.run(view, parsed, tokens)
    return true
  }

  run(view: VimView, parsed: Exclude<Parsed, { kind: 'incomplete' } | { kind: 'invalid' }>, tokens: string[]) {
    const isChange =
      (parsed.kind === 'operator' && parsed.op !== 'y') || (parsed.kind === 'command' && CHANGES.has(parsed.cmd[0]))
    if (isChange && !this.replaying) {
      this.lastChange = { tokens, insert: [] }
      this.recording = true
    }
    if (parsed.kind === 'motion') this.move(view, parsed)
    else if (parsed.kind === 'operator') this.operator(view, parsed)
    else this.command(view, parsed)
    if (this.vim(view.state).mode !== 'insert') this.recording = false
  }

  cursor(state: EditorState, L: Lines) {
    return L.off(state.selection.head)
  }

  // --- motions ---

  motion(L: Lines, cur: number, m: string[], count: number, hasCount: boolean, forOperator: boolean): MotionResult | null {
    const line = L.lineAt(cur)
    const char = (off: number, inclusive = false): MotionResult => ({ off, linewise: false, inclusive })
    const toLine = (target: number, off?: number): MotionResult => {
      const l = Math.max(0, Math.min(target, L.lastLine))
      return { off: off ?? L.firstNonBlank(l), linewise: true, inclusive: false }
    }
    const repeat = (fn: (o: number) => number) => {
      let o = cur
      for (let k = 0; k < count; k++) o = fn(o)
      return o
    }
    switch (m[0]) {
      case 'h':
      case '<BS>':
        return char(Math.max(L.offs[line], cur - count))
      case 'l':
      case ' ':
        return char(Math.min(forOperator ? L.end(line) : L.last(line), cur + count))
      case '0':
        return char(L.offs[line])
      case '^':
        return char(L.firstNonBlank(line))
      case '$': {
        const l = Math.min(line + count - 1, L.lastLine)
        return forOperator ? char(L.end(l)) : { off: L.last(l), linewise: false, inclusive: true }
      }
      case 'w':
      case 'W':
        return char(Math.min(repeat((o) => wordForward(L, o, m[0] === 'W')), L.text.length))
      case 'e':
      case 'E':
        return char(repeat((o) => wordEnd(L, o, m[0] === 'E')), true)
      case 'b':
      case 'B':
        return char(repeat((o) => wordBack(L, o, m[0] === 'B')))
      case 'j':
      case 'k': {
        const l = Math.max(0, Math.min(line + (m[0] === 'j' ? count : -count), L.lastLine))
        const col = this.goalCol ?? cur - L.offs[line]
        return toLine(l, Math.min(L.offs[l] + col, L.last(l)))
      }
      case '<CR>':
      case '+':
        return toLine(line + count)
      case '-':
        return toLine(line - count)
      case 'G':
        return toLine(hasCount ? count - 1 : L.lastLine)
      case 'g':
        if (m[1] === 'g') return toLine(hasCount ? count - 1 : 0)
        return this.screenMotion(L, cur, m[1], count, forOperator)
      case 'H':
      case 'M':
      case 'L':
        return this.windowMotion(L, m[0], count)
      case '[':
      case ']': {
        let l = line
        for (let k = 0; k < count; k++) {
          let next = l
          do next += m[0] === ']' ? 1 : -1
          while (next >= 0 && next <= L.lastLine && L.types[next] !== 'scene')
          if (next < 0 || next > L.lastLine) break
          l = next
        }
        return toLine(l, L.offs[l])
      }
      case 'f':
      case 'F':
      case 't':
      case 'T':
        this.lastFind = { cmd: m[0], ch: m[1] }
        return this.find(L, cur, m[0], m[1], count)
      case 'n':
      case 'N': {
        const search = this.search
        if (!search) {
          this.extra.message = 'E35: No previous regular expression'
          return null
        }
        return this.searchMotion(L, cur, search.pattern, m[0] === 'n' ? search.forward : !search.forward, count)
      }
      case '*':
      case '#': {
        const word = this.wordAt(L, cur)
        if (!word) {
          this.extra.message = 'E348: No string under cursor'
          return null
        }
        const pattern = `\\<${word.text}\\>`
        const forward = m[0] === '*'
        this.extra.search = { pattern, forward }
        this.extra.highlight = true
        return this.searchMotion(L, forward ? cur : word.start, pattern, forward, count)
      }
      case ';':
      case ',': {
        if (!this.lastFind) return null
        const { cmd, ch } = this.lastFind
        const flipped = m[0] === ',' ? ({ f: 'F', F: 'f', t: 'T', T: 't' } as Record<string, string>)[cmd] : cmd
        return this.find(L, cur, flipped, ch, count, true)
      }
    }
    return null
  }

  /** The current search pattern, as of the key being handled. */
  search: VimState['search'] = null

  searchMotion(L: Lines, from: number, pattern: string, forward: boolean, count: number): MotionResult | null {
    const hit = searchFrom(L, from, pattern, forward, count)
    if (!hit) {
      this.extra.message = `E486: Pattern not found: ${pattern}`
      return null
    }
    this.extra.highlight = true
    if (hit.wrapped) this.extra.message = forward ? 'search hit BOTTOM, continuing at TOP' : 'search hit TOP, continuing at BOTTOM'
    return { off: hit.off, linewise: false, inclusive: false }
  }

  /** The keyword under or after the cursor on its line, like Vim's * uses. */
  wordAt(L: Lines, cur: number): { text: string; start: number } | null {
    const line = L.lineAt(cur)
    const text = L.lineText(line)
    const re = /\w+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (m.index + m[0].length > cur - L.offs[line]) return { text: m[0], start: L.offs[line] + m.index }
    }
    return null
  }

  // --- screen rows (wrapped lines) ---

  /** Layout lookups, or null outside a browser (then screen motions fall back to their line versions). */
  geometry(L: Lines) {
    const view = this.view
    if (!view?.coordsAtPos) return null
    const cache = new Map<number, { left: number; top: number; bottom: number }>()
    const at = (off: number) => {
      let c = cache.get(off)
      if (!c) cache.set(off, (c = view.coordsAtPos!(L.pos(off), 1)))
      return c
    }
    const n = L.text.length
    const sameRow = (a: number, b: number) => Math.abs(at(a).top - at(b).top) < 2
    const rowStart = (off: number) => {
      while (off > 0 && sameRow(off - 1, off)) off--
      return off
    }
    const rowEnd = (off: number) => {
      while (off < n && sameRow(off + 1, off)) off++
      return off
    }
    /** Offset in the row starting at `start` closest to the x coordinate. */
    const closest = (start: number, x: number) => {
      let best = start
      for (let o = start; o <= n && sameRow(o, start); o++) {
        if (Math.abs(at(o).left - x) < Math.abs(at(best).left - x)) best = o
      }
      return best
    }
    /** Start of the next (dir 1) or previous (dir -1) row, or null at the document's edge. */
    const step = (off: number, dir: 1 | -1) => {
      if (dir > 0) {
        const end = rowEnd(off)
        return end < n ? end + 1 : null
      }
      const start = rowStart(off)
      return start > 0 ? rowStart(start - 1) : null
    }
    /** Smallest offset whose row satisfies `pred`, assuming rows only move down the page. */
    const firstWhere = (pred: (off: number) => boolean) => {
      let lo = 0
      let hi = n
      if (!pred(n)) return null
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (pred(mid)) hi = mid
        else lo = mid + 1
      }
      return lo
    }
    return { at, n, rowStart, rowEnd, closest, step, firstWhere }
  }

  /** gj gk (by screen row) and gh gl g0 g^ g$ (start/end of the screen row). */
  screenMotion(L: Lines, cur: number, key: string, count: number, forOperator: boolean): MotionResult | null {
    const g = this.geometry(L)
    const line = L.lineAt(cur)
    if (!g) {
      const fallback: Record<string, string> = { j: 'j', k: 'k', h: '0', '0': '0', '^': '^', l: '$', $: '$' }
      return this.motion(L, cur, [fallback[key]], count, false, forOperator)
    }
    if (key === 'j' || key === 'k') {
      const x = this.goalX ?? g.at(cur).left
      this.goalX = x
      let off = cur
      for (let k = 0; k < count; k++) {
        const next = g.step(off, key === 'j' ? 1 : -1)
        if (next == null) break
        off = g.closest(next, x)
      }
      return { off, linewise: false, inclusive: false }
    }
    if (key === 'h' || key === '0') return { off: g.rowStart(cur), linewise: false, inclusive: false }
    if (key === '^') {
      let off = g.rowStart(cur)
      const end = g.rowEnd(cur)
      while (off < end && /\s/.test(L.text[off])) off++
      return { off, linewise: false, inclusive: false }
    }
    // gl / g$: the row's last character. At the end of an element, stay off the newline.
    const end = g.rowEnd(cur)
    const lineEnd = L.end(line)
    if (end === lineEnd) return { off: forOperator ? end : L.last(line), linewise: false, inclusive: !forOperator && L.lens[line] > 0 }
    return { off: end, linewise: false, inclusive: true }
  }

  /** H M L: top, middle and bottom screen rows of the editor pane. Linewise, like Vim. */
  windowMotion(L: Lines, key: string, count: number): MotionResult | null {
    const g = this.geometry(L)
    const pane = this.view && this.viewport(this.view)
    const toLine = (off: number) => {
      const line = L.lineAt(off)
      return { off: off === L.offs[line] ? L.firstNonBlank(line) : off, linewise: true, inclusive: false }
    }
    if (!g || !pane) {
      if (key === 'H') return toLine(L.offs[Math.min(count - 1, L.lastLine)])
      if (key === 'L') return toLine(L.offs[Math.max(L.lastLine - count + 1, 0)])
      return toLine(L.offs[Math.floor(L.lastLine / 2)])
    }
    const top = g.firstWhere((o) => g.at(o).top >= pane.top - 1) ?? 0
    const below = g.firstWhere((o) => g.at(o).bottom > pane.bottom + 1)
    const bottom = g.rowStart(below == null ? g.n : Math.max(g.rowStart(below) - 1, top))
    let off: number
    if (key === 'M') {
      // The middle row by count, not by pixels: page breaks and element gaps take up space.
      const rows = [top]
      for (let r = g.step(top, 1); r != null && r <= bottom; r = g.step(r, 1)) rows.push(r)
      off = rows[Math.floor((rows.length - 1) / 2)]
    } else {
      off = key === 'H' ? top : bottom
      for (let k = 1; k < count; k++) {
        const next = g.step(off, key === 'H' ? 1 : -1)
        if (next == null || (key === 'H' ? next > bottom : next < top)) break
        off = next
      }
    }
    return toLine(off)
  }

  viewport(view: VimView): { top: number; bottom: number } | null {
    if (view.viewport) return view.viewport()
    const pane = this.scroller(view)
    if (!pane) return null
    const rect = pane.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom }
  }

  find(L: Lines, cur: number, cmd: string, ch: string, count: number, repeat = false): MotionResult | null {
    const line = L.lineAt(cur)
    const text = L.lineText(line)
    let col = cur - L.offs[line]
    const forward = cmd === 'f' || cmd === 't'
    const till = cmd === 't' || cmd === 'T'
    // Repeating a 't' from right before the match would find the same character again.
    if (repeat && till) col += forward ? 1 : -1
    for (let k = 0; k < count; k++) {
      col = forward ? text.indexOf(ch, col + 1) : text.lastIndexOf(ch, col - 1)
      if (col < 0) return null
    }
    if (till) col += forward ? -1 : 1
    return { off: L.offs[line] + col, linewise: false, inclusive: forward }
  }

  move(view: VimView, p: { count: number; hasCount: boolean; motion: string[] }) {
    const { state } = view
    const L = new Lines(state.doc)
    const cur = this.cursor(state, L)
    const isVertical = p.motion[0] === 'j' || p.motion[0] === 'k'
    if (isVertical && this.goalCol == null) this.goalCol = cur - L.offs[L.lineAt(cur)]
    const r = this.motion(L, cur, p.motion, p.count, p.hasCount, false)
    if (!isVertical) this.goalCol = p.motion[0] === '$' ? Infinity : null
    if (!isScreenVertical(p.motion)) this.goalX = null
    if (!r) return this.setPending(view, [])
    const off = Math.min(r.off, L.last(L.lineAt(r.off)))
    this.commit(view, state.tr.setSelection(TextSelection.create(state.doc, L.pos(off))))
  }

  // --- operators ---

  textObject(L: Lines, cur: number, obj: string[]): [number, number] | null {
    const [kind, ch] = obj
    const inner = kind === 'i'
    const line = L.lineAt(cur)
    const text = L.lineText(line)
    const base = L.offs[line]
    const col = cur - base

    if (ch === 'w' || ch === 'W') {
      if (!text.length) return [cur, cur]
      const big = ch === 'W'
      const c = cls(text[col], big)
      let a = col
      let b = col
      while (a > 0 && cls(text[a - 1], big) === c) a--
      while (b < text.length && cls(text[b], big) === c) b++
      if (!inner) {
        if (c !== 0) {
          const before = b
          while (b < text.length && cls(text[b], big) === 0) b++
          if (b === before) while (a > 0 && cls(text[a - 1], big) === 0) a--
        } else if (b < text.length) {
          const c2 = cls(text[b], big)
          while (b < text.length && cls(text[b], big) === c2) b++
        }
      }
      return [base + a, base + b]
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quotes: number[] = []
      for (let k = 0; k < text.length; k++) if (text[k] === ch) quotes.push(k)
      for (let k = 0; k + 1 < quotes.length; k += 2) {
        if (quotes[k + 1] >= col) {
          const [a, b] = [quotes[k], quotes[k + 1]]
          return inner ? [base + a + 1, base + b] : [base + a, base + b + 1]
        }
      }
      return null
    }

    const pairs: Record<string, [string, string]> = {
      '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'],
      '[': ['[', ']'], ']': ['[', ']'],
      '{': ['{', '}'], '}': ['{', '}'], B: ['{', '}'],
      '<': ['<', '>'], '>': ['<', '>'],
    }
    const pair = pairs[ch]
    if (!pair) return null
    const s = L.text
    const [open, close] = pair
    let a = cur
    let depth = 0
    if (s[a] !== open) {
      for (a = cur - (s[cur] === close ? 1 : 0); a >= 0; a--) {
        if (s[a] === close) depth++
        else if (s[a] === open) {
          if (depth === 0) break
          depth--
        }
      }
      if (a < 0) return null
    }
    depth = 0
    let b = a + 1
    for (; b < s.length; b++) {
      if (s[b] === open) depth++
      else if (s[b] === close) {
        if (depth === 0) break
        depth--
      }
    }
    if (b >= s.length) return null
    return inner ? [a + 1, b] : [a, b + 1]
  }

  operator(view: VimView, p: { count: number; hasCount: boolean; op: string; target: Target }) {
    const { state } = view
    const L = new Lines(state.doc)
    const cur = this.cursor(state, L)
    const line = L.lineAt(cur)
    this.goalCol = null
    this.goalX = null

    if (p.target.type === 'line') {
      return this.applyLines(view, L, p.op, line, Math.min(line + p.count - 1, L.lastLine), cur)
    }
    if (p.target.type === 'object') {
      const range = this.textObject(L, cur, p.target.obj)
      if (!range) return this.setPending(view, [])
      return this.applyChars(view, L, p.op, range[0], range[1])
    }

    let motion = p.target.motion
    // "cw" on a word behaves like "ce", as in Vim.
    if (p.op === 'c' && (motion[0] === 'w' || motion[0] === 'W') && cls(L.text[cur], false) !== 0) {
      motion = [motion[0] === 'w' ? 'e' : 'E']
    }
    const r = this.motion(L, cur, motion, p.count, p.hasCount, true)
    if (!r) return this.setPending(view, [])
    if (r.linewise) {
      const target = L.lineAt(r.off)
      return this.applyLines(view, L, p.op, Math.min(line, target), Math.max(line, target), cur)
    }
    const a = Math.min(cur, r.off)
    let b = Math.min(Math.max(cur, r.off) + (r.inclusive ? 1 : 0), L.text.length)
    // An exclusive motion ending at the start of a later line stops at the end of the previous one.
    const bLine = L.lineAt(b)
    if (!r.inclusive && bLine > L.lineAt(a) && b === L.offs[bLine]) b = L.end(bLine - 1)
    this.applyChars(view, L, p.op, a, b)
  }

  applyChars(view: VimView, L: Lines, op: string, a: number, b: number) {
    const { state } = view
    if (op !== 'y' || b > a) this.register = { linewise: false, text: L.text.slice(a, b) }
    if (op === 'y') {
      return this.commit(view, state.tr.setSelection(TextSelection.create(state.doc, L.pos(a))), { mode: 'normal' })
    }
    const tr = closeHistory(state.tr)
    const from = L.pos(a)
    tr.delete(from, L.pos(b))
    this.place(tr, tr.mapping.map(from, -1), op === 'c' ? 'insert' : 'normal')
    this.commit(view, tr, { mode: op === 'c' ? 'insert' : 'normal' })
  }

  applyLines(view: VimView, L: Lines, op: string, la: number, lb: number, cur: number) {
    const { state } = view
    const element = state.schema.nodes.element
    this.register = {
      linewise: true,
      elements: Array.from({ length: lb - la + 1 }, (_, k) => ({ type: L.types[la + k], text: L.lineText(la + k) })),
    }
    if (op === 'y') {
      const off = L.lineAt(cur) === la ? cur : L.offs[la]
      return this.commit(view, state.tr.setSelection(TextSelection.create(state.doc, L.pos(off))), { mode: 'normal' })
    }
    const tr = closeHistory(state.tr)
    const from = L.starts[la]
    const to = L.nodeEnd(lb)
    if (op === 'c') {
      tr.replaceWith(from, to, element.create({ type: L.types[la] }))
      tr.setSelection(TextSelection.create(tr.doc, from + 1))
      return this.commit(view, tr, { mode: 'insert' })
    }
    if (la === 0 && lb === L.lastLine) tr.replaceWith(from, to, element.create({ type: 'action' }))
    else tr.delete(from, to)
    const after = new Lines(tr.doc)
    tr.setSelection(TextSelection.create(tr.doc, after.pos(after.firstNonBlank(Math.min(la, after.lastLine)))))
    this.commit(view, tr, { mode: 'normal' })
  }

  /** Puts the cursor at pos; in normal mode it may not sit past the last character. */
  place(tr: Transaction, pos: number, mode: VimMode) {
    const $p = tr.doc.resolve(Math.min(pos, tr.doc.content.size))
    let target = $p.pos
    if (mode !== 'insert' && $p.parent.isTextblock && $p.parentOffset > 0 && $p.parentOffset === $p.parent.content.size) target--
    tr.setSelection(TextSelection.create(tr.doc, target))
  }

  // --- commands ---

  command(view: VimView, p: { count: number; hasCount: boolean; cmd: string[] }) {
    const { state } = view
    const L = new Lines(state.doc)
    const cur = this.cursor(state, L)
    const line = L.lineAt(cur)
    const element = state.schema.nodes.element
    const insertAt = (off: number) => {
      const tr = closeHistory(state.tr).setSelection(TextSelection.create(state.doc, L.pos(off)))
      this.commit(view, tr, { mode: 'insert' })
    }
    const cmd = p.cmd[0]
    this.goalCol = null
    this.goalX = null

    switch (cmd) {
      case 'i':
        return insertAt(cur)
      case 'a':
        return insertAt(L.lens[line] ? cur + 1 : cur)
      case 'I':
        return insertAt(L.firstNonBlank(line))
      case 'A':
        return insertAt(L.end(line))
      case 'o':
      case 'O': {
        const below = cmd === 'o'
        const type = below ? NEXT_ON_ENTER[L.types[line]] : L.types[line]
        const at = below ? L.nodeEnd(line) : L.starts[line]
        const tr = closeHistory(state.tr).insert(at, element.create({ type }))
        tr.setSelection(TextSelection.create(tr.doc, at + 1))
        return this.commit(view, tr, { mode: 'insert' })
      }
      case 'x':
      case '<Del>':
        if (!L.lens[line]) return this.setPending(view, [])
        return this.applyChars(view, L, 'd', cur, Math.min(cur + p.count, L.end(line)))
      case 'X':
        if (cur === L.offs[line]) return this.setPending(view, [])
        return this.applyChars(view, L, 'd', Math.max(L.offs[line], cur - p.count), cur)
      case 's':
        return this.applyChars(view, L, 'c', cur, Math.min(cur + p.count, L.end(line)))
      case 'S':
        return this.applyLines(view, L, 'c', line, Math.min(line + p.count - 1, L.lastLine), cur)
      case 'D':
      case 'C':
      case 'Y': {
        const end = L.end(Math.min(line + p.count - 1, L.lastLine))
        return this.applyChars(view, L, cmd === 'D' ? 'd' : cmd === 'C' ? 'c' : 'y', cur, end)
      }
      case 'p':
      case 'P':
        return this.paste(view, L, cur, cmd === 'P', p.count)
      case 'u':
      case '<C-r>': {
        for (let k = 0; k < p.count; k++) (cmd === 'u' ? undo : redo)(view.state, view.dispatch)
        return this.setPending(view, [])
      }
      case 'J': {
        const tr = closeHistory(state.tr)
        const joins = Math.max(1, p.count - 1)
        let cursorPos = 0
        for (let k = 0; k < joins && line + 1 <= L.lastLine; k++) {
          const now = new Lines(tr.doc)
          if (line + 1 > now.lastLine) break
          const end = now.pos(now.end(line))
          const next = now.lineText(line + 1)
          const lead = next.length - next.trimStart().length
          tr.delete(end, now.starts[line + 1] + 1 + lead)
          const needsSpace = now.lens[line] > 0 && next.trim().length > 0 && !/\s$/.test(now.lineText(line))
          if (needsSpace) tr.insertText(' ', end)
          cursorPos = end
        }
        if (!cursorPos) return this.setPending(view, [])
        this.place(tr, cursorPos, 'normal')
        return this.commit(view, tr)
      }
      case '~': {
        const end = Math.min(cur + p.count, L.end(line))
        if (end <= cur) return this.setPending(view, [])
        const text = L.text.slice(cur, end)
        const swapped = [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')
        const tr = closeHistory(state.tr).insertText(swapped, L.pos(cur), L.pos(end))
        this.place(tr, L.pos(Math.min(end, L.last(line))), 'normal')
        return this.commit(view, tr)
      }
      case 'r': {
        const end = cur + p.count
        if (end > L.end(line) || p.cmd[1].length !== 1) return this.setPending(view, [])
        const tr = closeHistory(state.tr).insertText(p.cmd[1].repeat(p.count), L.pos(cur), L.pos(end))
        this.place(tr, L.pos(end - 1), 'normal')
        return this.commit(view, tr)
      }
      case 'v':
      case 'V':
        return this.enterVisual(view, L, cmd === 'v' ? 'visual' : 'visual-line', cur, cur)
      case '.':
        return this.repeat(view, p.count)
      case '<C-d>':
      case '<C-u>':
        return this.halfPage(view, cmd === '<C-d>' ? 1 : -1)
      case 'z':
        return this.center(view)
      case ':':
        return this.setPending(view, [':'])
    }
  }

  paste(view: VimView, L: Lines, cur: number, before: boolean, count: number) {
    const { state } = view
    const reg = this.register
    const line = L.lineAt(cur)
    const tr = closeHistory(state.tr)
    if (reg.linewise) {
      const element = state.schema.nodes.element
      const nodes = Array.from({ length: count }, () => reg.elements).flat()
        .map((e) => element.create({ type: e.type }, e.text ? state.schema.text(e.text) : undefined))
      const at = before ? L.starts[line] : L.nodeEnd(line)
      tr.insert(at, nodes)
      const firstText = nodes[0].textContent
      const lead = firstText.length - firstText.trimStart().length
      this.place(tr, at + 1 + Math.min(lead, Math.max(firstText.length - 1, 0)), 'normal')
      return this.commit(view, tr)
    }
    if (!reg.text) return this.setPending(view, [])
    const text = reg.text.repeat(count)
    let pos = L.pos(before || !L.lens[line] ? cur : cur + 1)
    const parts = text.split('\n')
    parts.forEach((part, k) => {
      if (k > 0) {
        tr.split(pos)
        pos += 2
      }
      if (part) tr.insertText(part, pos)
      pos += part.length
    })
    this.place(tr, Math.max(pos - 1, 0), 'normal')
    this.commit(view, tr)
  }

  repeat(view: VimView, count: number) {
    const change = this.lastChange
    if (!change) return this.setPending(view, [])
    this.replaying = true
    try {
      for (let k = 0; k < count; k++) {
        const parsed = parse(change.tokens)
        if (parsed.kind === 'incomplete' || parsed.kind === 'invalid') break
        this.run(view, parsed, change.tokens)
        if (this.vim(view.state).mode !== 'insert') continue
        for (const t of change.insert) {
          const { state } = view
          if (t === '<CR>') this.options.enter(state, view.dispatch)
          else if (t === '<BS>') {
            const { $from } = state.selection
            if ($from.parentOffset > 0) view.dispatch(state.tr.delete($from.pos - 1, $from.pos))
            else joinBackward(state, view.dispatch)
          } else view.dispatch(state.tr.insertText(t))
        }
        this.exitInsert(view)
      }
    } finally {
      this.replaying = false
    }
  }

  exitInsert(view: VimView) {
    this.recording = false
    const { state } = view
    const { $head } = state.selection
    const tr = closeHistory(state.tr)
    tr.setSelection(TextSelection.create(state.doc, $head.parentOffset > 0 ? $head.pos - 1 : $head.pos))
    this.commit(view, tr, { mode: 'normal' })
  }

  // --- visual mode ---

  enterVisual(view: VimView, L: Lines, mode: 'visual' | 'visual-line', anchor: number, head: number) {
    const { state } = view
    let from: number
    let to: number
    if (mode === 'visual-line') {
      const la = L.lineAt(Math.min(anchor, head))
      const lb = L.lineAt(Math.max(anchor, head))
      from = L.starts[la] + 1
      to = L.starts[lb] + 1 + L.lens[lb]
    } else {
      from = L.pos(Math.min(anchor, head))
      to = L.pos(Math.min(Math.max(anchor, head) + 1, L.text.length))
    }
    const selection = head < anchor ? TextSelection.create(state.doc, to, from) : TextSelection.create(state.doc, from, to)
    this.commit(view, state.tr.setSelection(selection), { mode, anchor, head, cursor: L.pos(head) })
  }

  exitVisual(view: VimView) {
    const vs = this.vim(view.state)
    const L = new Lines(view.state.doc)
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, L.pos(Math.min(vs.head, L.last(L.lineAt(vs.head))))))
    this.commit(view, tr, { mode: 'normal' })
  }

  visualMotion(view: VimView, p: { count: number; hasCount: boolean; motion: string[] }) {
    const vs = this.vim(view.state)
    const L = new Lines(view.state.doc)
    const isVertical = p.motion[0] === 'j' || p.motion[0] === 'k'
    if (isVertical && this.goalCol == null) this.goalCol = vs.head - L.offs[L.lineAt(vs.head)]
    const r = this.motion(L, vs.head, p.motion, p.count, p.hasCount, false)
    if (!isVertical) this.goalCol = null
    if (!isScreenVertical(p.motion)) this.goalX = null
    if (!r) return this.setPending(view, [])
    this.enterVisual(view, L, vs.mode as 'visual' | 'visual-line', vs.anchor, Math.min(r.off, L.last(L.lineAt(r.off))))
  }

  /** Handles keys that mean something special in visual mode. Returns false to fall back to motions. */
  visualKey(view: VimView, tokens: string[]): boolean {
    const vs = this.vim(view.state)
    const L = new Lines(view.state.doc)
    const t = tokens[tokens.length - 1]
    const mode = vs.mode as 'visual' | 'visual-line'
    if (tokens.length === 2 && (tokens[0] === 'i' || tokens[0] === 'a')) {
      const range = this.textObject(L, vs.head, tokens)
      if (range && range[1] > range[0]) this.enterVisual(view, L, 'visual', range[0], range[1] - 1)
      else this.setPending(view, [])
      return true
    }
    if (tokens.length !== 1) return false
    const a = Math.min(vs.anchor, vs.head)
    const b = Math.max(vs.anchor, vs.head)
    const la = L.lineAt(a)
    const lb = L.lineAt(b)
    const op = (o: string) =>
      mode === 'visual-line' ? this.applyLines(view, L, o, la, lb, a) : this.applyChars(view, L, o, a, Math.min(b + 1, L.text.length))

    switch (t) {
      case 'i':
      case 'a':
        this.setPending(view, tokens)
        return true
      case 'o':
        this.enterVisual(view, L, mode, vs.head, vs.anchor)
        return true
      case 'v':
      case 'V': {
        const next = t === 'v' ? 'visual' : 'visual-line'
        if (next === mode) this.exitVisual(view)
        else this.enterVisual(view, L, next, vs.anchor, vs.head)
        return true
      }
      case 'd':
      case 'x':
      case '<Del>':
        op('d')
        return true
      case 'y':
        op('y')
        return true
      case 'c':
      case 's':
        op('c')
        return true
      case 'D':
      case 'X':
        this.applyLines(view, L, 'd', la, lb, a)
        return true
      case 'Y':
        this.applyLines(view, L, 'y', la, lb, a)
        return true
      case 'C':
      case 'S':
      case 'R':
        this.applyLines(view, L, 'c', la, lb, a)
        return true
      case '~':
      case 'u':
      case 'U': {
        const from = mode === 'visual-line' ? L.offs[la] : a
        const to = mode === 'visual-line' ? L.end(lb) : Math.min(b + 1, L.text.length)
        const text = L.text.slice(from, to)
        const changed = [...text]
          .map((c) => (t === 'u' ? c.toLowerCase() : t === 'U' ? c.toUpperCase() : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
          .join('')
        const tr = closeHistory(view.state.tr)
        // Replace line by line so element boundaries survive.
        let k = 0
        for (let l = L.lineAt(from); l <= L.lineAt(Math.max(to - 1, from)); l++) {
          const s = Math.max(from, L.offs[l])
          const e = Math.min(to, L.end(l))
          if (e > s) tr.insertText(changed.slice(s - from, e - from), tr.mapping.map(L.pos(s)), tr.mapping.map(L.pos(e)))
          k++
        }
        this.place(tr, tr.mapping.map(L.pos(from)), 'normal')
        this.commit(view, tr, { mode: 'normal' })
        return true
      }
    }
    return false
  }

  // --- scrolling (needs the real view) ---

  scroller(view: VimView): HTMLElement | null {
    return (view.dom?.closest('.desk') as HTMLElement | null) ?? null
  }

  halfPage(view: VimView, dir: 1 | -1) {
    const scroller = this.scroller(view)
    if (!scroller || !view.coordsAtPos || !view.posAtCoords) return this.setPending(view, [])
    const { state } = view
    const c = view.coordsAtPos(state.selection.head)
    const before = scroller.scrollTop
    scroller.scrollBy(0, (scroller.clientHeight / 2) * dir)
    const L = new Lines(state.doc)
    let pos: number
    if (scroller.scrollTop === before) {
      pos = L.pos(L.firstNonBlank(dir > 0 ? L.lastLine : 0))
    } else {
      const rect = scroller.getBoundingClientRect()
      const top = Math.min(Math.max(c.top + 2, rect.top + 4), rect.bottom - 4)
      pos = view.posAtCoords({ left: c.left + 1, top })?.pos ?? state.selection.head
    }
    const tr = state.tr
    this.place(tr, L.pos(L.off(pos)), 'normal')
    this.commit(view, tr, {}, false)
  }

  center(view: VimView) {
    const scroller = this.scroller(view)
    if (scroller && view.coordsAtPos) {
      const c = view.coordsAtPos(view.state.selection.head)
      const rect = scroller.getBoundingClientRect()
      scroller.scrollBy(0, c.top - (rect.top + scroller.clientHeight / 2))
    }
    this.setPending(view, [])
  }

  // --- command line ---

  runSearch(view: VimView, pending: string[]) {
    const vs = this.vim(view.state)
    const forward = pending[0] === '/'
    const pattern = pending.slice(1).join('') || vs.search?.pattern
    if (!pattern) return this.setPending(view, [], 'E35: No previous regular expression')
    this.extra.search = { pattern, forward }
    const L = new Lines(view.state.doc)
    const visual = vs.mode === 'visual' || vs.mode === 'visual-line'
    const r = this.searchMotion(L, visual ? vs.head : this.cursor(view.state, L), pattern, forward, 1)
    if (!r) return this.setPending(view, [])
    if (visual) return this.enterVisual(view, L, vs.mode as 'visual' | 'visual-line', vs.anchor, r.off)
    this.goalCol = null
    this.commit(view, view.state.tr.setSelection(TextSelection.create(view.state.doc, L.pos(r.off))))
  }

  commandLine(view: VimView, pending: string[], token: string): boolean {
    if (token === '<Esc>') return this.setPending(view, []), true
    if (token === '<BS>') return this.setPending(view, pending.length > 1 ? pending.slice(0, -1) : []), true
    if (token === '<CR>') {
      if (pending[0] !== ':') return this.runSearch(view, pending), true
      const cmd = pending.slice(1).join('').trim()
      if (/^noh(lsearch)?$/.test(cmd)) {
        this.setPending(view, [], '')
        this.commit(view, view.state.tr, { highlight: false }, false)
      } else if (/^(w|write|w!|wq|x|wa)$/.test(cmd)) {
        this.options.onWrite?.()
        this.setPending(view, [], this.options.onWrite ? 'Backup downloaded' : '')
      } else if (/^q!?$|^qa!?$/.test(cmd)) {
        this.setPending(view, [], 'Nothing to quit: your script autosaves. Use :w to download a backup.')
      } else if (cmd) {
        this.setPending(view, [], `E492: Not an editor command: ${cmd}`)
      } else this.setPending(view, [])
      return true
    }
    if (token.length === 1) this.setPending(view, [...pending, token])
    return true
  }
}

// --- Plugin --------------------------------------------------------------------------------------

function cursorWidget() {
  const dom = document.createElement('span')
  dom.className = 'vim-cursor vim-cursor-eol'
  return dom
}

let matchCache: { doc: PMNode; pattern: string; ranges: [number, number][] } | null = null

/** Highlights search matches: the typed pattern while searching (incsearch), else the last search. */
function searchDecorations(state: EditorState, vs: VimState): Decoration[] {
  const typing = vs.pending[0] === '/' || vs.pending[0] === '?'
  const pattern = typing ? vs.pending.slice(1).join('') : vs.highlight ? vs.search?.pattern : null
  if (!pattern) return []
  if (!matchCache || matchCache.doc !== state.doc || matchCache.pattern !== pattern) {
    const L = new Lines(state.doc)
    const re = compileSearch(pattern)
    const ranges = re ? findMatches(L.text, re).map(([a, b]): [number, number] => [L.pos(a), L.pos(b)]) : []
    matchCache = { doc: state.doc, pattern, ranges }
  }
  let current = -1
  if (typing) {
    // The match Enter would jump to.
    const L = new Lines(state.doc)
    const hit = searchFrom(L, L.off(state.selection.head), pattern, vs.pending[0] === '/')
    current = hit ? L.pos(hit.off) : -1
  } else current = vs.mode === 'normal' ? state.selection.head : vs.cursor
  return matchCache.ranges.map(([a, b]) => Decoration.inline(a, b, { class: a === current ? 'vim-match vim-match-current' : 'vim-match' }))
}

export function vimPlugin(options: VimOptions): Plugin<VimState> {
  const controller = new VimController(options)
  const plugin: Plugin<VimState> = new Plugin<VimState>({
    key: vimKey,
    state: {
      init: () => ({ enabled: options.enabled, mode: 'normal', pending: [], anchor: 0, head: 0, cursor: 0, message: '', search: null, highlight: false }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(vimKey) as Partial<VimState> | undefined
        if (meta) return { ...value, ...meta }
        if (!value.enabled || !tr.selectionSet) return value
        // A selection made outside Vim (mouse, scene tree, undo) ends visual mode; a mouse drag starts it.
        // Only selection-only changes count as a drag: undo restores old visual ranges along with the text.
        if (value.mode === 'visual' || value.mode === 'visual-line') return { ...value, mode: 'normal', pending: [] }
        if (value.mode === 'normal' && !state.selection.empty && !tr.docChanged) {
          const L = new Lines(state.doc)
          const anchor = L.off(state.selection.anchor)
          let head = L.off(state.selection.head)
          if (head > anchor) head--
          return { ...value, mode: 'visual', anchor, head, cursor: L.pos(head), pending: [] }
        }
        return value
      },
    },
    appendTransaction(trs, _old, state) {
      const vs = vimKey.getState(state)
      if (!vs?.enabled || vs.mode !== 'normal') return null
      let pos = state.selection.head
      if (!state.selection.empty) {
        // Undo/redo restore the selection from before the change, which may be an old visual range.
        // Like Vim, land in normal mode at the start of it.
        if (!trs.some((tr) => tr.docChanged && !tr.getMeta(vimKey))) return null
        pos = state.selection.from
      }
      // Normal mode's cursor sits on a character, never past the last one.
      const $p = state.doc.resolve(pos)
      if ($p.depth >= 1 && $p.parentOffset > 0 && $p.parentOffset === $p.parent.content.size) pos--
      if (state.selection.empty && pos === state.selection.head) return null
      return state.tr.setSelection(TextSelection.create(state.doc, pos))
    },
    props: {
      handleKeyDown(view, event) {
        const token = tokenOf(event)
        if (token == null) return false
        const vs = vimKey.getState(view.state)
        if (!vs?.enabled) return false
        if (controller.key(view, token)) return true
        // In normal/visual mode, printable keys must never type into the script.
        return vs.mode !== 'insert' && token.length === 1
      },
      handleTextInput(view) {
        const vs = vimKey.getState(view.state)
        return Boolean(vs?.enabled && vs.mode !== 'insert')
      },
      attributes(state): Record<string, string> {
        const vs = vimKey.getState(state)
        return vs?.enabled ? { class: `vim vim-${vs.mode}` } : {}
      },
      decorations(state) {
        const vs = vimKey.getState(state)
        if (!vs?.enabled) return null
        const decos = searchDecorations(state, vs)
        if (vs.mode !== 'insert') {
          const pos = vs.mode === 'normal' ? state.selection.head : Math.min(vs.cursor, state.doc.content.size)
          const $p = state.doc.resolve(pos)
          if ($p.parent.isTextblock) {
            decos.push(
              $p.parentOffset < $p.parent.content.size
                ? Decoration.inline(pos, pos + 1, { class: 'vim-cursor' })
                : Decoration.widget(pos, cursorWidget, { side: 1, key: 'vim-eol' }),
            )
          }
        }
        return decos.length ? DecorationSet.create(state.doc, decos) : null
      },
    },
  })
  controllers.set(plugin, controller)
  return plugin
}

/** Feeds a token (e.g. "d", "<Esc>", "<C-r>") to the Vim layer, as a key press would. */
export function vimFeed(view: VimView, token: string): boolean {
  const plugin = vimKey.get(view.state)
  const controller = plugin && controllers.get(plugin)
  return controller ? controller.key(view, token) : false
}

export function setVimEnabled(view: VimView, enabled: boolean) {
  const tr = view.state.tr.setMeta(vimKey, { enabled, mode: 'normal', pending: [], message: '' })
  view.dispatch(tr)
}
