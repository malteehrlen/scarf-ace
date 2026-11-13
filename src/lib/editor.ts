// ProseMirror setup: a document is a flat list of typed screenplay elements.
import { Fragment, Schema, Slice, type Node as PMNode } from 'prosemirror-model'
import { EditorState, Plugin, PluginKey, TextSelection, type Command } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { history, redo, undo } from 'prosemirror-history'
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { fromFountain, toFountain } from './fountain'
import { paginate } from './paginate'
import { NOTE_RE, SCENE_NUMBER_RE, parseRuns, serializeRuns, type Run } from './markup'
import { vimPlugin } from './vim'
import { findPlugin } from './find'
import { completionPlugin } from './completion'
import {
  ELEMENT_LABELS,
  ELEMENT_TYPES,
  PRIMARY_TYPES,
  NEXT_ON_ENTER,
  NEXT_ON_TAB,
  SCENE_HEADING_RE,
  isDialogueType,
  type ElementType,
  type ScriptElement,
} from './screenplay'

const validType = (t: unknown): ElementType =>
  ELEMENT_TYPES.includes(t as ElementType) ? (t as ElementType) : 'action'

export const schema = new Schema({
  nodes: {
    doc: { content: 'element+' },
    element: {
      content: 'text*',
      marks: 'strong em underline',
      attrs: { type: { default: 'action' }, dual: { default: false } },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (dom) => ({
            type: validType((dom as HTMLElement).dataset.type),
            dual: (dom as HTMLElement).dataset.dual === 'true',
          }),
        },
      ],
      toDOM: (node) => [
        'p',
        { class: `el el-${node.attrs.type}`, 'data-type': node.attrs.type, ...(node.attrs.dual ? { 'data-dual': 'true' } : {}) },
        0,
      ],
    },
    text: {},
  },
  // Fountain emphasis. Stored in element text as markup (**bold**, *italic*, _underline_).
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
  },
})

/** Text nodes (with emphasis marks) for a line of Fountain markup. */
function inlineNodes(markup: string): PMNode[] {
  return parseRuns(markup).map((run) => {
    const marks = [
      ...(run.bold ? [schema.marks.strong.create()] : []),
      ...(run.italic ? [schema.marks.em.create()] : []),
      ...(run.underline ? [schema.marks.underline.create()] : []),
    ]
    return schema.text(run.text, marks)
  })
}

/** An element's content as Fountain markup. */
function markupOf(node: PMNode): string {
  const runs: Run[] = []
  node.forEach((child) => {
    const has = (name: string) => child.marks.some((m) => m.type.name === name)
    runs.push({ text: child.text ?? '', bold: has('strong'), italic: has('em'), underline: has('underline') })
  })
  return serializeRuns(runs)
}

const elementNode = (el: ScriptElement) =>
  schema.nodes.element.create({ type: el.type, dual: Boolean(el.dual) }, el.text ? inlineNodes(el.text) : undefined)

export function docFromElements(elements: ScriptElement[]): PMNode {
  const els = elements.length ? elements : [{ type: 'action' as const, text: '' }]
  return schema.nodes.doc.create(null, els.map(elementNode))
}

// ProseMirror keeps unchanged nodes as the same objects between edits, so each element is
// serialized once and reused until it changes. (Treat the returned elements as read-only.)
const elementCache = new WeakMap<PMNode, ScriptElement>()

export function elementsFromDoc(doc: PMNode | Fragment): ScriptElement[] {
  const out: ScriptElement[] = []
  doc.forEach((node) => {
    if (node.type !== schema.nodes.element) return
    let el = elementCache.get(node)
    if (!el) {
      el = { type: node.attrs.type, text: markupOf(node) }
      if (node.attrs.dual) el.dual = true
      elementCache.set(node, el)
    }
    out.push(el)
  })
  return out
}

export function currentType(state: EditorState): ElementType {
  return state.selection.$from.parent.attrs.type ?? 'action'
}

// --- Commands -------------------------------------------------------------

export function setType(type: ElementType): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr
      const { from, to } = state.selection
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === schema.nodes.element && node.attrs.type !== type) tr.setNodeMarkup(pos, undefined, { type })
        return false
      })
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const enter: Command = (state, dispatch) => {
  const tr = state.tr
  if (!state.selection.empty) tr.deleteSelection()
  const { $from } = tr.selection
  const node = $from.parent
  const type = validType(node.attrs.type)

  if (node.content.size === 0 && type !== 'action') {
    // Enter on an empty element bails out to action, like most screenwriting apps.
    tr.setNodeMarkup($from.before(), undefined, { type: 'action' })
  } else if ($from.parentOffset === node.content.size) {
    const after = $from.after()
    tr.insert(after, schema.nodes.element.create({ type: NEXT_ON_ENTER[type] }))
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
  } else if ($from.parentOffset === 0) {
    tr.insert($from.before(), schema.nodes.element.create({ type }))
  } else {
    tr.split($from.pos, 1, [{ type: schema.nodes.element, attrs: { type } }])
  }
  dispatch?.(tr.scrollIntoView())
  return true
}

export const tab: Command = (state, dispatch) => setType(NEXT_ON_TAB[currentType(state)])(state, dispatch)

export const shiftTab: Command = (state, dispatch) => {
  const i = PRIMARY_TYPES.indexOf(currentType(state))
  if (i < 0) return setType('action')(state, dispatch)
  return setType(PRIMARY_TYPES[(i - 1 + PRIMARY_TYPES.length) % PRIMARY_TYPES.length])(state, dispatch)
}

/** Backspace at the start of an element whose predecessor is empty removes the empty one. */
const backspaceEmptyPrevious: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  const index = $from.index(0)
  if (index === 0) return false
  const prev = state.doc.child(index - 1)
  if (prev.content.size !== 0) return false
  if (dispatch) {
    const start = $from.before() - prev.nodeSize
    dispatch(state.tr.delete(start, start + prev.nodeSize).scrollIntoView())
  }
  return true
}

// --- Plugins --------------------------------------------------------------

/** Turns typed text into the right element: "INT. " → scene heading, "CUT TO:" → transition, "(" → parenthetical. */
const smartTyping = new Plugin({
  props: {
    handleTextInput(view, _from, _to, text) {
      const { state } = view
      const { $from, empty } = state.selection
      if (!empty) return false
      const node = $from.parent
      const type = node.attrs.type as ElementType
      const atEnd = $from.parentOffset === node.content.size

      // Typing into a page break starts a new action line after it.
      if (type === 'pagebreak') {
        const after = $from.after()
        const tr = state.tr.insert(after, schema.nodes.element.create({ type: 'action' }, schema.text(text)))
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1 + text.length)).scrollIntoView())
        return true
      }
      // Fountain's "^" after a character name: dual dialogue (speaks at the same time as the previous speech).
      if (type === 'character' && text === '^' && atEnd) {
        view.dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...node.attrs, dual: !node.attrs.dual }))
        return true
      }
      if (text === '(' && node.content.size === 0 && type === 'dialogue') {
        view.dispatch(state.tr.setNodeMarkup($from.before(), undefined, { type: 'parenthetical' }))
        return true
      }
      if (type === 'parenthetical' && text === '(' && $from.parentOffset === 0) return true
      if (type === 'parenthetical' && text === ')' && atEnd) {
        const after = $from.after()
        const tr = state.tr.insert(after, schema.nodes.element.create({ type: 'dialogue' }))
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView())
        return true
      }
      return false
    },
  },
  appendTransaction(trs, oldState, state) {
    if (!trs.some((tr) => tr.docChanged)) return null
    const { $from } = state.selection
    if ($from.depth !== 1 || oldState.doc.childCount !== state.doc.childCount) return null
    const index = $from.index(0)
    const node = state.doc.child(index)
    const old = oldState.doc.child(index)
    // Only react to the text changing, so explicitly choosing "action" is respected.
    if (node.attrs.type !== 'action' || old.attrs.type !== 'action' || old.textContent === node.textContent) return null

    const text = node.textContent
    const becomes = (re: RegExp) => re.test(text) && !re.test(old.textContent)
    const start = $from.before()
    const retype = (type: ElementType, strip: [number, number] = [0, 0]) => {
      const tr = state.tr.setNodeMarkup(start, undefined, { type })
      // Remove Fountain syntax that only served to pick the type (e.g. "= " or "> … <").
      if (strip[1]) tr.delete(start + 1 + text.length - strip[1], start + 1 + text.length)
      if (strip[0]) tr.delete(start + 1, start + 1 + strip[0])
      return tr
    }
    if (becomes(SCENE_HEADING_RE)) return retype('scene')
    if (becomes(/^[A-Z][A-Z .'-]*TO:$/)) return retype('transition')
    // Fountain shortcuts: "===" page break, "# " section, "= " synopsis, "> text <" centered.
    if (becomes(/^={3,}$/)) return retype('pagebreak', [text.length, 0])
    if (becomes(/^#+ /)) return retype('section')
    if (becomes(/^= /) && !/^==/.test(text)) return retype('synopsis', [2, 0])
    if (becomes(/^>.*\S.*<$/)) {
      const lead = /^>\s*/.exec(text)![0].length
      const trail = /\s*<$/.exec(text)![0].length
      return retype('centered', [lead, trail])
    }
    return null
  },
})

export interface LayoutOptions {
  /** Show and print (CONT'D) when a character speaks again after action in the same scene. */
  autoContd: boolean
}

export interface LayoutInfo {
  options: LayoutOptions
  pageCount: number
  pageStarts: { page: number; el: number }[]
  decorations: DecorationSet
}

export const layoutKey = new PluginKey<LayoutInfo>('layout')

function pageBreakWidget(page: number) {
  const dom = document.createElement('div')
  dom.className = 'page-break'
  dom.contentEditable = 'false'
  dom.dataset.page = String(page)
  dom.innerHTML = `<span>${page}.</span>`
  return dom
}

function autoContdWidget() {
  const dom = document.createElement('span')
  dom.className = 'auto-contd'
  dom.contentEditable = 'false'
  dom.textContent = " (CONT'D)"
  return dom
}

/** Marks the elements of a dual-dialogue pair so CSS can put the two speeches side by side. */
function dualDecorations(doc: PMNode, offsets: number[]): Decoration[] {
  const out: Decoration[] = []
  const nodes: PMNode[] = []
  doc.forEach((n) => nodes.push(n))
  const speechEnd = (start: number) => {
    let i = start + 1
    while (i < nodes.length && ['parenthetical', 'dialogue'].includes(nodes[i].attrs.type)) i++
    return i
  }
  const mark = (from: number, to: number, cls: string) => {
    for (let i = from; i < to; i++) out.push(Decoration.node(offsets[i], offsets[i] + nodes[i].nodeSize, { class: cls }))
  }
  nodes.forEach((node, i) => {
    if (node.attrs.type !== 'character' || !node.attrs.dual) return
    // The left speech is the character block right before this one.
    let left = i - 1
    while (left >= 0 && ['parenthetical', 'dialogue'].includes(nodes[left].attrs.type)) left--
    if (left < 0 || nodes[left].attrs.type !== 'character' || nodes[left].attrs.dual) return
    const end = speechEnd(i)
    mark(left, i, 'el-dual el-dual-left')
    mark(i, end, 'el-dual el-dual-right')
    if (end < nodes.length) mark(end, end + 1, 'el-after-dual')
  })
  return out
}

function computeLayout(doc: PMNode, options: LayoutOptions): LayoutInfo {
  const elements = elementsFromDoc(doc)
  const { pages, pageStarts, autoContd } = paginate(elements, { autoContd: options.autoContd })
  const offsets: number[] = []
  doc.forEach((_node, offset) => offsets.push(offset))

  const decorations: Decoration[] = pageStarts.map(({ page, el }) =>
    Decoration.widget(offsets[el], () => pageBreakWidget(page), { side: -1, key: `pb-${page}`, ignoreSelection: true }),
  )
  for (const el of autoContd) {
    const end = offsets[el] + doc.child(el).nodeSize - 1
    decorations.push(Decoration.widget(end, autoContdWidget, { side: 1, key: 'auto-contd', ignoreSelection: true }))
  }
  decorations.push(...dualDecorations(doc, offsets))

  // Notes and Fountain scene numbers stay in the text but are drawn as non-printing.
  doc.forEach((node, offset) => {
    const text = node.textContent
    for (const m of text.matchAll(NOTE_RE)) {
      decorations.push(Decoration.inline(offset + 1 + m.index, offset + 1 + m.index + m[0].length, { class: 'md-note' }))
    }
    if (node.attrs.type === 'scene') {
      const m = SCENE_NUMBER_RE.exec(text)
      if (m) decorations.push(Decoration.inline(offset + 1 + m.index, offset + 1 + text.length, { class: 'md-scenenum' }))
    }
  })

  let prev: ElementType | null = null
  doc.forEach((node, offset) => {
    const type = node.attrs.type as ElementType
    if ((type === 'dialogue' || type === 'parenthetical') && !(prev && isDialogueType(prev))) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: 'el-orphan',
          title: 'Dialogue and parentheticals must follow a character name',
        }),
      )
    }
    prev = type
  })

  return { options, pageCount: pages.length, pageStarts, decorations: DecorationSet.create(doc, decorations) }
}

function layoutPlugin(initial: LayoutOptions) {
  return new Plugin<LayoutInfo>({
    key: layoutKey,
    state: {
      init: (_config, state) => computeLayout(state.doc, initial),
      apply(tr, value) {
        const options = tr.getMeta(layoutKey) as LayoutOptions | undefined
        if (options) return computeLayout(tr.doc, options)
        if (!tr.docChanged) return value
        const next = computeLayout(tr.doc, value.options)
        // Keep the old page starts when nothing moved, so views watching them don't re-render.
        const same =
          next.pageStarts.length === value.pageStarts.length &&
          next.pageStarts.every((s, i) => s.page === value.pageStarts[i].page && s.el === value.pageStarts[i].el)
        return same ? { ...next, pageStarts: value.pageStarts } : next
      },
    },
    props: {
      decorations: (state) => layoutKey.getState(state)?.decorations,
    },
  })
}

export function setLayoutOptions(view: EditorView, options: LayoutOptions) {
  view.dispatch(view.state.tr.setMeta(layoutKey, options).setMeta('addToHistory', false))
}

/** Plain-text clipboard speaks Fountain, so pasting between apps keeps element types. */
const fountainClipboard = new Plugin({
  props: {
    clipboardTextParser(text) {
      if (!text.includes('\n')) return text ? new Slice(Fragment.from(inlineNodes(text)), 0, 0) : Slice.empty
      const { elements } = fromFountain(text, { titlePage: false })
      return elements.length ? new Slice(Fragment.from(elements.map(elementNode)), 1, 1) : Slice.empty
    },
    clipboardTextSerializer(slice) {
      const elements = elementsFromDoc(slice.content)
      if (elements.length <= 1) return slice.content.textBetween(0, slice.content.size, '\n')
      return toFountain(elements).trimEnd()
    },
  },
})

/** Small tag naming the current element's type, drawn in the margin beside it. */
function typeLabel(type: ElementType) {
  const dom = document.createElement('span')
  dom.className = `el-label t-${type}`
  dom.contentEditable = 'false'
  dom.setAttribute('aria-hidden', 'true')
  dom.textContent = ELEMENT_LABELS[type]
  return dom
}

/** Position of an element being flashed after a jump, or null. */
const flashKey = new PluginKey<number | null>('flash')
const FLASH_MS = 900

/** Tints the element holding the cursor, and briefly flashes elements jumped to. */
const cursorHighlight = new Plugin<number | null>({
  key: flashKey,
  state: {
    init: () => null,
    apply(tr, value) {
      const meta = tr.getMeta(flashKey)
      if (meta !== undefined) return meta
      return value == null ? null : tr.mapping.map(value)
    },
  },
  props: {
    decorations(state) {
      const decorations: Decoration[] = []
      const { $head } = state.selection
      if ($head.depth >= 1) {
        const start = $head.before(1)
        const type = validType($head.node(1).attrs.type)
        decorations.push(
          Decoration.node(start, start + $head.node(1).nodeSize, { class: 'el-current' }),
          Decoration.widget(start + 1, () => typeLabel(type), { side: -1, key: `label-${type}`, ignoreSelection: true }),
        )
      }
      const flash = flashKey.getState(state)
      const node = flash == null ? null : state.doc.nodeAt(flash)
      if (flash != null && node) decorations.push(Decoration.node(flash, flash + node.nodeSize, { class: 'el-flash' }))
      return DecorationSet.create(state.doc, decorations)
    },
  },
})

/** Briefly highlights the element starting at `pos` so the eye can find it after a jump. */
export function flashElement(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setMeta(flashKey, pos).setMeta('addToHistory', false))
  setTimeout(() => {
    if (view.isDestroyed || flashKey.getState(view.state) == null) return
    view.dispatch(view.state.tr.setMeta(flashKey, null).setMeta('addToHistory', false))
  }, FLASH_MS)
}

export interface EditorOptions {
  vim?: boolean
  autoContd?: boolean
  /** Called for Vim's :w. */
  onWrite?: () => void
}

export function createState(elements: ScriptElement[], options: EditorOptions = {}): EditorState {
  const typeKeys = Object.fromEntries(PRIMARY_TYPES.map((t, i) => [`Mod-Alt-${i + 1}`, setType(t)]))
  return EditorState.create({
    doc: docFromElements(elements),
    plugins: [
      history(),
      vimPlugin({ enabled: Boolean(options.vim), enter, onWrite: options.onWrite }),
      completionPlugin(elementsFromDoc),
      smartTyping,
      keymap({
        Enter: enter,
        'Shift-Enter': enter,
        Tab: tab,
        'Shift-Tab': shiftTab,
        Backspace: backspaceEmptyPrevious,
        'Mod-z': undo,
        'Mod-y': redo,
        'Mod-b': toggleMark(schema.marks.strong),
        'Mod-i': toggleMark(schema.marks.em),
        'Mod-u': toggleMark(schema.marks.underline),
        'Shift-Mod-z': redo,
        ...typeKeys,
      }),
      keymap(baseKeymap),
      layoutPlugin({ autoContd: options.autoContd ?? true }),
      cursorHighlight,
      findPlugin,
      fountainClipboard,
    ],
  })
}
