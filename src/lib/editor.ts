// ProseMirror setup: a document is a flat list of typed screenplay elements.
import { Fragment, Schema, Slice, type Node as PMNode } from 'prosemirror-model'
import { EditorState, Plugin, PluginKey, TextSelection, type Command } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { history, redo, undo } from 'prosemirror-history'
import { baseKeymap } from 'prosemirror-commands'
import { fromFountain, toFountain } from './fountain'
import { paginate } from './paginate'
import {
  ELEMENT_TYPES,
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
      marks: '',
      attrs: { type: { default: 'action' } },
      parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ type: validType((dom as HTMLElement).dataset.type) }) }],
      toDOM: (node) => ['p', { class: `el el-${node.attrs.type}`, 'data-type': node.attrs.type }, 0],
    },
    text: {},
  },
})

const elementNode = (el: ScriptElement) =>
  schema.nodes.element.create({ type: el.type }, el.text ? schema.text(el.text) : undefined)

export function docFromElements(elements: ScriptElement[]): PMNode {
  const els = elements.length ? elements : [{ type: 'action' as const, text: '' }]
  return schema.nodes.doc.create(null, els.map(elementNode))
}

export function elementsFromDoc(doc: PMNode | Fragment): ScriptElement[] {
  const out: ScriptElement[] = []
  doc.forEach((node) => {
    if (node.type === schema.nodes.element) out.push({ type: node.attrs.type, text: node.textContent })
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
  const i = ELEMENT_TYPES.indexOf(currentType(state))
  return setType(ELEMENT_TYPES[(i - 1 + ELEMENT_TYPES.length) % ELEMENT_TYPES.length])(state, dispatch)
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
    if (becomes(SCENE_HEADING_RE)) return state.tr.setNodeMarkup($from.before(), undefined, { type: 'scene' })
    if (becomes(/^[A-Z][A-Z .'-]*TO:$/)) return state.tr.setNodeMarkup($from.before(), undefined, { type: 'transition' })
    return null
  },
})

export interface LayoutInfo {
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

function computeLayout(doc: PMNode): LayoutInfo {
  const elements = elementsFromDoc(doc)
  const { pages, pageStarts } = paginate(elements)
  const offsets: number[] = []
  doc.forEach((_node, offset) => offsets.push(offset))

  const decorations: Decoration[] = pageStarts.map(({ page, el }) =>
    Decoration.widget(offsets[el], () => pageBreakWidget(page), { side: -1, key: `pb-${page}`, ignoreSelection: true }),
  )

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

  return { pageCount: pages.length, pageStarts, decorations: DecorationSet.create(doc, decorations) }
}

const layout = new Plugin<LayoutInfo>({
  key: layoutKey,
  state: {
    init: (_config, state) => computeLayout(state.doc),
    apply: (tr, value) => (tr.docChanged ? computeLayout(tr.doc) : value),
  },
  props: {
    decorations: (state) => layoutKey.getState(state)?.decorations,
  },
})

/** Plain-text clipboard speaks Fountain, so pasting between apps keeps element types. */
const fountainClipboard = new Plugin({
  props: {
    clipboardTextParser(text) {
      if (!text.includes('\n')) return text ? new Slice(Fragment.from(schema.text(text)), 0, 0) : Slice.empty
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

export function createState(elements: ScriptElement[]): EditorState {
  const typeKeys = Object.fromEntries(ELEMENT_TYPES.map((t, i) => [`Mod-Alt-${i + 1}`, setType(t)]))
  return EditorState.create({
    doc: docFromElements(elements),
    plugins: [
      history(),
      smartTyping,
      keymap({
        Enter: enter,
        'Shift-Enter': enter,
        Tab: tab,
        'Shift-Tab': shiftTab,
        Backspace: backspaceEmptyPrevious,
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        ...typeKeys,
      }),
      keymap(baseKeymap),
      layout,
      fountainClipboard,
    ],
  })
}
