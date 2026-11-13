import { describe, expect, it, vi } from 'vitest'
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import { createState, elementsFromDoc, enter } from '../src/lib/editor'
import { tokenOf, vimFeed, vimKey } from '../src/lib/vim'
import type { ScriptElement } from '../src/lib/screenplay'

const A = (text: string): ScriptElement => ({ type: 'action', text })

function vimEditor(elements: ScriptElement[], at: [number, number] = [0, 0], onWrite?: () => void) {
  let state: EditorState = createState(elements, { vim: true, onWrite })
  const view = {
    get state() {
      return state
    },
    dispatch: (tr: Transaction) => {
      state = state.applyTransaction(tr).state
    },
  }
  let pos = 0
  for (let i = 0; i < at[0]; i++) pos += state.doc.child(i).nodeSize
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + at[1])))

  return {
    view,
    /** Feeds keys like a browser would: anything Vim doesn't handle in insert mode gets typed. */
    keys(input: string) {
      for (const t of input.match(/<[^>]+>|[\s\S]/g) ?? []) {
        if (vimFeed(view, t)) continue
        if (vimKey.getState(state)!.mode !== 'insert') continue
        if (t === '<CR>') enter(state, view.dispatch)
        else if (t === '<BS>') view.dispatch(state.tr.delete(state.selection.from - 1, state.selection.from))
        else view.dispatch(state.tr.insertText(t))
      }
      return this
    },
    get lines() {
      return elementsFromDoc(state.doc).map((e) => e.text)
    },
    get elements() {
      return elementsFromDoc(state.doc)
    },
    /** [element index, column] of the cursor. */
    get cursor() {
      const { $head } = state.selection
      return [$head.index(0), $head.parentOffset]
    },
    get mode() {
      return vimKey.getState(state)!.mode
    },
    get vim() {
      return vimKey.getState(state)!
    },
    get selectedText() {
      return state.doc.textBetween(state.selection.from, state.selection.to, '\n')
    },
  }
}

describe('modes', () => {
  it('starts in normal mode and does not type', () => {
    const e = vimEditor([A('hello')])
    e.keys('q')
    expect(e.mode).toBe('normal')
    expect(e.lines).toEqual(['hello'])
  })

  it('i / a / I / A enter insert at the right place; Esc steps back', () => {
    const e = vimEditor([A('  hello')], [0, 4])
    e.keys('iX<Esc>')
    expect(e.lines).toEqual(['  heXllo'])
    expect(e.cursor).toEqual([0, 4])
    e.keys('aY<Esc>')
    expect(e.lines).toEqual(['  heXYllo'])
    e.keys('I>')
    expect(e.lines).toEqual(['  >heXYllo'])
    e.keys('<Esc>A!<Esc>')
    expect(e.lines).toEqual(['  >heXYllo!'])
    expect(e.cursor).toEqual([0, 10])
    expect(e.mode).toBe('normal')
  })

  it('never leaves the cursor past the end of a line in normal mode', () => {
    const e = vimEditor([A('abc')])
    e.keys('A<Esc>')
    expect(e.cursor).toEqual([0, 2])
    e.keys('$l')
    expect(e.cursor).toEqual([0, 2])
  })
})

describe('motions', () => {
  it('moves by words across elements', () => {
    const e = vimEditor([A('one two.three'), A('four')])
    e.keys('w')
    expect(e.cursor).toEqual([0, 4])
    e.keys('w')
    expect(e.cursor).toEqual([0, 7]) // "." is its own word
    e.keys('2w')
    expect(e.cursor).toEqual([1, 0])
    e.keys('b')
    expect(e.cursor).toEqual([0, 8])
    e.keys('0W')
    expect(e.cursor).toEqual([0, 4])
    e.keys('e')
    expect(e.cursor).toEqual([0, 6])
  })

  it('stops on empty elements', () => {
    const e = vimEditor([A('a'), A(''), A('b')])
    e.keys('w')
    expect(e.cursor).toEqual([1, 0])
    e.keys('w')
    expect(e.cursor).toEqual([2, 0])
    e.keys('b')
    expect(e.cursor).toEqual([1, 0])
  })

  it('0 ^ $ and counts', () => {
    const e = vimEditor([A('  indented text')], [0, 8])
    e.keys('0')
    expect(e.cursor).toEqual([0, 0])
    e.keys('^')
    expect(e.cursor).toEqual([0, 2])
    e.keys('$')
    expect(e.cursor).toEqual([0, 14])
    e.keys('03l')
    expect(e.cursor).toEqual([0, 3])
  })

  it('j / k remember the column', () => {
    const e = vimEditor([A('long line here'), A('ab'), A('another long line')], [0, 10])
    e.keys('j')
    expect(e.cursor).toEqual([1, 1])
    e.keys('j')
    expect(e.cursor).toEqual([2, 10])
    e.keys('gg')
    expect(e.cursor).toEqual([0, 0])
    e.keys('G')
    expect(e.cursor).toEqual([2, 0])
    e.keys('2G')
    expect(e.cursor).toEqual([1, 0])
  })

  it('f / t / F / T with ; and ,', () => {
    const e = vimEditor([A('a,b,c,d')])
    e.keys('f,')
    expect(e.cursor).toEqual([0, 1])
    e.keys(';')
    expect(e.cursor).toEqual([0, 3])
    e.keys(',')
    expect(e.cursor).toEqual([0, 1])
    e.keys('$F,')
    expect(e.cursor).toEqual([0, 5])
    e.keys('0t,')
    expect(e.cursor).toEqual([0, 0])
    e.keys(';')
    expect(e.cursor).toEqual([0, 2])
  })

  it('[[ and ]] jump between scenes', () => {
    const e = vimEditor([
      { type: 'scene', text: 'INT. A' },
      A('x'),
      { type: 'scene', text: 'INT. B' },
      A('y'),
      { type: 'scene', text: 'INT. C' },
    ])
    e.keys(']]')
    expect(e.cursor).toEqual([2, 0])
    e.keys(']]')
    expect(e.cursor).toEqual([4, 0])
    e.keys('2[[')
    expect(e.cursor).toEqual([0, 0])
  })
})

describe('operators', () => {
  it('dw, d$, D, de', () => {
    const e = vimEditor([A('one two three four')])
    e.keys('dw')
    expect(e.lines).toEqual(['two three four'])
    e.keys('de')
    expect(e.lines).toEqual([' three four'])
    e.keys('wd$')
    expect(e.lines).toEqual([' '])
    const f = vimEditor([A('keep this')], [0, 4])
    f.keys('D')
    expect(f.lines).toEqual(['keep'])
    expect(f.cursor).toEqual([0, 3])
  })

  it('dw on the last word of a line does not join the next element', () => {
    const e = vimEditor([A('a last'), A('next')], [0, 2])
    e.keys('dw')
    expect(e.lines).toEqual(['a ', 'next'])
  })

  it('cw changes to the end of the word (like ce)', () => {
    const e = vimEditor([A('one two')])
    e.keys('cwONE<Esc>')
    expect(e.lines).toEqual(['ONE two'])
  })

  it('dd / yy / p / P work on whole elements and keep their types', () => {
    const els: ScriptElement[] = [
      { type: 'character', text: 'MAYA' },
      { type: 'dialogue', text: 'Hi.' },
      A('Rain.'),
    ]
    const e = vimEditor(els)
    e.keys('2yyGp')
    expect(e.elements).toEqual([...els, els[0], els[1]])
    expect(e.cursor).toEqual([3, 0])
    e.keys('2dd')
    expect(e.elements).toEqual(els)
    e.keys('ggddP')
    expect(e.elements).toEqual(els)
  })

  it('dd on the only element leaves an empty action', () => {
    const e = vimEditor([{ type: 'scene', text: 'INT. A' }])
    e.keys('dd')
    expect(e.elements).toEqual([A('')])
  })

  it('cc keeps the element type', () => {
    const e = vimEditor([{ type: 'dialogue', text: 'old line' }])
    e.keys('ccnew<Esc>')
    expect(e.elements).toEqual([{ type: 'dialogue', text: 'new' }])
  })

  it('charwise yank and paste', () => {
    const e = vimEditor([A('hello world')])
    e.keys('yw$p')
    expect(e.lines).toEqual(['hello worldhello '])
    e.keys('0P')
    expect(e.lines).toEqual(['hello hello worldhello '])
  })

  it('text objects', () => {
    const e = vimEditor([A('say "hello there" (to him) now')], [0, 7])
    e.keys('ci"bye<Esc>')
    expect(e.lines).toEqual(['say "bye" (to him) now'])
    e.keys('f(ldi(')
    expect(e.lines).toEqual(['say "bye" () now'])
    e.keys('wdaw')
    expect(e.lines).toEqual(['say "bye" ()'])
    const f = vimEditor([A('one two three')], [0, 5])
    f.keys('diw')
    expect(f.lines).toEqual(['one  three'])
  })

  it('operators with j / k are linewise', () => {
    const e = vimEditor([A('a'), A('b'), A('c'), A('d')], [1, 0])
    e.keys('dj')
    expect(e.lines).toEqual(['a', 'd'])
  })
})

describe('edits', () => {
  it('x X r ~ J', () => {
    const e = vimEditor([A('abcdef'), A('  next')], [0, 1])
    e.keys('x')
    expect(e.lines[0]).toBe('acdef')
    e.keys('2x')
    expect(e.lines[0]).toBe('aef')
    e.keys('X')
    expect(e.lines[0]).toBe('ef')
    e.keys('rZ')
    expect(e.lines[0]).toBe('Zf')
    e.keys('0~~')
    expect(e.lines[0]).toBe('zF')
    e.keys('J')
    expect(e.lines).toEqual(['zF next'])
    expect(e.cursor).toEqual([0, 2])
  })

  it('o opens the next element in screenplay order, O opens above', () => {
    const e = vimEditor([{ type: 'character', text: 'MAYA' }])
    e.keys('oHi.<Esc>')
    expect(e.elements).toEqual([
      { type: 'character', text: 'MAYA' },
      { type: 'dialogue', text: 'Hi.' },
    ])
    e.keys('Oquietly<Esc>')
    expect(e.elements[1]).toEqual({ type: 'dialogue', text: 'quietly' })
  })

  it('u and <C-r> undo and redo one command at a time', () => {
    const e = vimEditor([A('one two three')])
    e.keys('dwdw')
    expect(e.lines).toEqual(['three'])
    e.keys('u')
    expect(e.lines).toEqual(['two three'])
    e.keys('u')
    expect(e.lines).toEqual(['one two three'])
    e.keys('<C-r>')
    expect(e.lines).toEqual(['two three'])
  })

  it('. repeats the last change, including inserted text', () => {
    const e = vimEditor([A('a b c d')])
    e.keys('dw..')
    expect(e.lines).toEqual(['d'])
    const f = vimEditor([A('one two three')])
    f.keys('ciwX<Esc>w.w.')
    expect(f.lines).toEqual(['X X X'])
    const g = vimEditor([A('x')])
    g.keys('A!<Esc>..')
    expect(g.lines).toEqual(['x!!!'])
  })
})

describe('visual mode', () => {
  it('v selects inclusively and d deletes it', () => {
    const e = vimEditor([A('hello world')])
    e.keys('vlll')
    expect(e.mode).toBe('visual')
    expect(e.selectedText).toBe('hell')
    e.keys('d')
    expect(e.lines).toEqual(['o world'])
    expect(e.mode).toBe('normal')
  })

  it('o swaps ends, Esc leaves', () => {
    const e = vimEditor([A('abcdef')], [0, 2])
    e.keys('vlloh')
    expect(e.selectedText).toBe('bcde')
    e.keys('<Esc>')
    expect(e.mode).toBe('normal')
    expect(e.cursor).toEqual([0, 1])
  })

  it('V works on whole elements', () => {
    const e = vimEditor([A('a'), A('b'), A('c')])
    e.keys('Vjy')
    e.keys('Gp')
    expect(e.lines).toEqual(['a', 'b', 'c', 'a', 'b'])
    e.keys('ggVjd')
    expect(e.lines).toEqual(['c', 'a', 'b'])
  })

  it('viw selects a word, U uppercases', () => {
    const e = vimEditor([A('make this loud')], [0, 6])
    e.keys('viwU')
    expect(e.lines).toEqual(['make THIS loud'])
  })

  it('c in visual mode replaces the selection', () => {
    const e = vimEditor([A('one two three')], [0, 4])
    e.keys('vecTWO<Esc>')
    expect(e.lines).toEqual(['one TWO three'])
  })
})

describe('command line and misc', () => {
  it(':w downloads a backup; unknown commands report an error', () => {
    const onWrite = vi.fn()
    const e = vimEditor([A('x')], [0, 0], onWrite)
    e.keys(':w<CR>')
    expect(onWrite).toHaveBeenCalledOnce()
    expect(e.vim.pending).toEqual([])
    e.keys(':nope<CR>')
    expect(e.vim.message).toBe('E492: Not an editor command: nope')
  })

  it('shows pending keys and clears them with Esc', () => {
    const e = vimEditor([A('x')])
    e.keys('2d')
    expect(e.vim.pending).toEqual(['2', 'd'])
    e.keys('<Esc>')
    expect(e.vim.pending).toEqual([])
    expect(e.lines).toEqual(['x'])
  })

  it('maps key events to tokens', () => {
    const ev = (key: string, mods: Partial<KeyboardEvent> = {}) =>
      tokenOf({ key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods })
    expect(ev('d')).toBe('d')
    expect(ev('Escape')).toBe('<Esc>')
    expect(ev('[', { ctrlKey: true })).toBe('<Esc>')
    expect(ev('r', { ctrlKey: true })).toBe('<C-r>')
    expect(ev('ArrowDown')).toBeNull()
    expect(ev('Tab')).toBeNull()
    expect(ev('s', { metaKey: true })).toBeNull()
    expect(ev('2', { ctrlKey: true, altKey: true })).toBeNull() // element type shortcut
    expect(ev('@', { ctrlKey: true, altKey: true })).toBe('@') // AltGr
  })

  it('is inert when disabled', () => {
    const state = createState([A('abc')])
    expect(vimKey.getState(state)!.enabled).toBe(false)
  })
})

describe('search', () => {
  const doc = () => [A('The cat sat.'), A('A dog and a Cat.'), A('cats everywhere')]

  it('/ jumps to the next match, n / N repeat, and it wraps', () => {
    const e = vimEditor(doc())
    e.keys('/cat<CR>')
    expect(e.cursor).toEqual([0, 4])
    expect(e.vim.highlight).toBe(true)
    e.keys('n')
    expect(e.cursor).toEqual([1, 12]) // smartcase: "cat" also matches "Cat"
    e.keys('n')
    expect(e.cursor).toEqual([2, 0])
    e.keys('n')
    expect(e.cursor).toEqual([0, 4])
    expect(e.vim.message).toBe('search hit BOTTOM, continuing at TOP')
    e.keys('N')
    expect(e.cursor).toEqual([2, 0])
    e.keys('2n')
    expect(e.cursor).toEqual([1, 12])
  })

  it('is case-sensitive when the pattern has a capital', () => {
    const e = vimEditor(doc())
    e.keys('/Cat<CR>')
    expect(e.cursor).toEqual([1, 12])
    e.keys('n')
    expect(e.cursor).toEqual([1, 12])
  })

  it('? searches backwards, and / with no pattern reuses the last one', () => {
    const e = vimEditor(doc(), [2, 5])
    e.keys('?dog<CR>')
    expect(e.cursor).toEqual([1, 2])
    e.keys('gg/<CR>')
    expect(e.cursor).toEqual([1, 2])
    e.keys('n') // "/" reused the pattern going forward; the only match wraps to itself
    expect(e.cursor).toEqual([1, 2])
    expect(e.vim.message).toBe('search hit BOTTOM, continuing at TOP')
  })

  it('reports a missing pattern and leaves the cursor', () => {
    const e = vimEditor(doc(), [0, 2])
    e.keys('/zebra<CR>')
    expect(e.cursor).toEqual([0, 2])
    expect(e.vim.message).toBe('E486: Pattern not found: zebra')
    const f = vimEditor(doc())
    f.keys('n')
    expect(f.vim.message).toBe('E35: No previous regular expression')
  })

  it('Esc cancels a search; Backspace edits it', () => {
    const e = vimEditor(doc())
    e.keys('/dox')
    expect(e.vim.pending.join('')).toBe('/dox')
    e.keys('<BS>g')
    expect(e.vim.pending.join('')).toBe('/dog')
    e.keys('<Esc>')
    expect(e.cursor).toEqual([0, 0])
    expect(e.vim.pending).toEqual([])
  })

  it('* and # search the word under the cursor as a whole word', () => {
    const e = vimEditor([A('cat cats cat'), A('the cat')], [0, 1])
    e.keys('*')
    expect(e.cursor).toEqual([0, 9]) // skips "cats"
    e.keys('n')
    expect(e.cursor).toEqual([1, 4])
    e.keys('#')
    expect(e.cursor).toEqual([0, 9])
  })

  it('works as a motion for operators and in visual mode', () => {
    const e = vimEditor([A('keep delete these words stop here')])
    e.keys('w/stop<CR>0w')
    e.keys('dn')
    expect(e.lines).toEqual(['keep stop here'])
    const f = vimEditor([A('select up to here and no more')])
    f.keys('v/here<CR>')
    expect(f.mode).toBe('visual')
    expect(f.selectedText).toBe('select up to h')
  })

  it('treats regex syntax as regex, and falls back to literal text when invalid', () => {
    const e = vimEditor([A('scene 12 and (paren')])
    e.keys('/\\d+<CR>')
    expect(e.cursor).toEqual([0, 6])
    e.keys('0/(par<CR>')
    expect(e.cursor).toEqual([0, 13])
  })

  it(':noh clears the highlight', () => {
    const e = vimEditor(doc())
    e.keys('/cat<CR>')
    expect(e.vim.highlight).toBe(true)
    e.keys(':noh<CR>')
    expect(e.vim.highlight).toBe(false)
    e.keys('n')
    expect(e.vim.highlight).toBe(true)
  })
})

describe('screen rows and window motions', () => {
  /**
   * A fake layout: every element wraps at `width` characters, rows are 16px tall with a 16px gap
   * between elements, and each character is 8px wide.
   */
  function withLayout(e: ReturnType<typeof vimEditor>, width: number, viewport = { top: 0, bottom: 10_000 }) {
    const view = e.view as unknown as Record<string, unknown>
    view.coordsAtPos = (pos: number) => {
      const { state } = e.view
      const $p = state.doc.resolve(pos)
      const index = $p.index(0)
      let row = 0
      for (let i = 0; i < index; i++) row += Math.max(1, Math.ceil(state.doc.child(i).content.size / width)) + 1
      const len = $p.parent.content.size
      const col = $p.parentOffset
      // The end of a full row sits at that row's end, not the start of a new one.
      const r = col === len && len > 0 ? Math.floor((len - 1) / width) : Math.floor(col / width)
      const x = col === len && len > 0 ? ((len - 1) % width) + 1 : col % width
      const top = (row + r) * 16
      return { left: x * 8, top, bottom: top + 16 }
    }
    view.viewport = () => viewport
    return e
  }

  // Wraps (width 10) into rows: "aaaaaaaaaa" "bbbbbbbbbb" "ccc"
  const wrapped = () => [A('aaaaaaaaaabbbbbbbbbbccc'), A('next line'), A('xyz')]

  it('gj / gk move by screen row and keep the horizontal position', () => {
    const e = withLayout(vimEditor(wrapped(), [0, 4]), 10)
    e.keys('gj')
    expect(e.cursor).toEqual([0, 14])
    e.keys('gj')
    expect(e.cursor).toEqual([0, 22]) // short row: as close as it gets
    e.keys('gj')
    expect(e.cursor).toEqual([1, 4]) // back to the remembered x
    e.keys('gj')
    expect(e.cursor).toEqual([2, 2])
    e.keys('3gk')
    expect(e.cursor).toEqual([0, 14])
    e.keys('gk')
    expect(e.cursor).toEqual([0, 4])
  })

  it('j still moves by element', () => {
    const e = withLayout(vimEditor(wrapped(), [0, 4]), 10)
    e.keys('j')
    expect(e.cursor).toEqual([1, 4])
  })

  it('gh / gl and g0 / g^ / g$ go to the start and end of the screen row', () => {
    const e = withLayout(vimEditor(wrapped(), [0, 14]), 10)
    e.keys('gh')
    expect(e.cursor).toEqual([0, 10])
    e.keys('gl')
    expect(e.cursor).toEqual([0, 19])
    e.keys('gj')
    e.keys('g$')
    expect(e.cursor).toEqual([0, 22]) // last row: end of the element
    e.keys('g0')
    expect(e.cursor).toEqual([0, 20])
    const f = withLayout(vimEditor([A('   indented')], [0, 8]), 20)
    f.keys('g^')
    expect(f.cursor).toEqual([0, 3])
  })

  it('operators work with screen-row motions', () => {
    const e = withLayout(vimEditor(wrapped(), [0, 12]), 10)
    e.keys('dgl')
    expect(e.lines[0]).toBe('aaaaaaaaaabbccc')
    expect(e.cursor).toEqual([0, 12])
    e.keys('dgh') // deletes back to the start of the screen row: the two b's
    expect(e.lines[0]).toBe('aaaaaaaaaaccc')
  })

  it('falls back to line motions without a layout', () => {
    const e = vimEditor(wrapped(), [0, 4])
    e.keys('gj')
    expect(e.cursor).toEqual([1, 4])
    e.keys('gl')
    expect(e.cursor).toEqual([1, 8])
  })

  // Rows: 0 a, 16 b, 32 c, 48 gap, 64 "next line", 80 gap, 96 xyz, 112 gap, 128 "last"
  const four = () => [A('aaaaaaaaaabbbbbbbbbbccc'), A('next line'), A('  xyz'), A('last')]

  it('H / M / L go to the top, middle and bottom visible rows', () => {
    const e = withLayout(vimEditor(four(), [3, 0]), 10, { top: 16, bottom: 112 })
    e.keys('H')
    expect(e.cursor).toEqual([0, 10]) // first fully visible row is the middle of element 0
    e.keys('L')
    expect(e.cursor).toEqual([2, 2]) // first non-blank of "  xyz"
    e.keys('M') // visible rows b, c, "next line", xyz: the upper middle
    expect(e.cursor).toEqual([0, 20])
    e.keys('2H')
    expect(e.cursor).toEqual([0, 20])
    e.keys('2L')
    expect(e.cursor).toEqual([1, 0])
  })

  it('M counts rows rather than pixels', () => {
    // Visible rows: b (16), c (32), "next line" (64), xyz (96), last (128). Gaps don't count.
    const e = withLayout(vimEditor(four(), [0, 0]), 10, { top: 16, bottom: 144 })
    e.keys('M')
    expect(e.cursor).toEqual([1, 0])
    const f = withLayout(vimEditor(four(), [0, 0]), 10, { top: 0, bottom: 80 })
    f.keys('M') // rows a, b, c, "next line": the upper middle, like Vim
    expect(f.cursor).toEqual([0, 10])
  })

  it('H / L are linewise for operators', () => {
    const e = withLayout(vimEditor(four(), [1, 3]), 10, { top: 64, bottom: 144 })
    e.keys('dL')
    expect(e.lines).toEqual(['aaaaaaaaaabbbbbbbbbbccc'])
  })

  it('screen motions extend a visual selection', () => {
    const e = withLayout(vimEditor(wrapped(), [0, 2]), 10)
    e.keys('vgj')
    expect(e.selectedText).toBe('aaaaaaaabbb')
  })
})

describe('undo after visual-mode changes', () => {
  it('u stays in normal mode with the cursor at the start of the restored text', () => {
    const e = vimEditor([A('one two three')], [0, 4])
    e.keys('ved')
    expect(e.lines).toEqual(['one  three'])
    e.keys('u')
    expect(e.lines).toEqual(['one two three'])
    expect(e.mode).toBe('normal')
    expect(e.selectedText).toBe('')
    expect(e.cursor).toEqual([0, 4])
    e.keys('<C-r>')
    expect(e.lines).toEqual(['one  three'])
    expect(e.mode).toBe('normal')
  })

  it('works for visual-line changes and for Ctrl+Z (the editor keymap undo)', () => {
    const e = vimEditor([A('a'), A('b'), A('c')], [1, 0])
    e.keys('Vjd')
    expect(e.lines).toEqual(['a'])
    undo(e.view.state, e.view.dispatch)
    expect(e.lines).toEqual(['a', 'b', 'c'])
    expect(e.mode).toBe('normal')
    expect(e.selectedText).toBe('')
    expect(e.cursor).toEqual([1, 0])
    e.keys('x') // and normal-mode commands work on the cursor, not a leftover range
    expect(e.lines).toEqual(['a', '', 'c'])
  })

  it('a mouse drag (a selection-only change) still enters visual mode', () => {
    const e = vimEditor([A('hello world')])
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, 6)))
    expect(e.mode).toBe('visual')
  })
})
