<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { createState, currentType, elementsFromDoc, flashElement, layoutKey, setType } from '../lib/editor'
import type { ElementType, ScriptElement } from '../lib/screenplay'
import { setVimEnabled, vimKey, type VimMode } from '../lib/vim'

export interface EditorStatus {
  type: ElementType
  /** Index of the element containing the cursor. */
  index: number
  page: number
  pageCount: number
  pageStarts: { page: number; el: number }[]
  vim: { enabled: boolean; mode: VimMode; pending: string; message: string }
}

const props = withDefaults(
  defineProps<{
    elements: ScriptElement[]
    vim: boolean
    /** Space at the bottom of the window covered by something (the backup reminder) to keep the cursor out of. */
    bottomInset?: number
    /** Page scale (CSS zoom). Line breaks and pagination don't change, only the size. */
    zoom?: number
  }>(),
  { bottomInset: 0, zoom: 1 },
)
const emit = defineEmits<{
  change: [elements: ScriptElement[]]
  status: [status: EditorStatus]
  write: []
}>()

const mount = ref<HTMLElement>()
let view: EditorView | null = null

function status(): EditorStatus {
  const state = view!.state
  const layout = layoutKey.getState(state)!
  const index = state.selection.$from.index(0)
  let page = 1
  for (const start of layout.pageStarts) if (start.el <= index) page = start.page
  const vim = vimKey.getState(state)!
  return {
    type: currentType(state),
    index,
    page,
    pageCount: layout.pageCount,
    pageStarts: layout.pageStarts,
    vim: { enabled: vim.enabled, mode: vim.mode, pending: vim.pending.join(''), message: vim.message },
  }
}

onMounted(() => {
  view = new EditorView(mount.value!, {
    state: createState(props.elements, { vim: props.vim, onWrite: () => emit('write') }),
    attributes: { class: 'script', spellcheck: 'true' },
    ...scrollProps(props.bottomInset),
    dispatchTransaction(tr) {
      const state = view!.state.apply(tr)
      view!.updateState(state)
      if (tr.docChanged) emit('change', elementsFromDoc(state.doc))
      emit('status', status())
    },
  })
  emit('status', status())
  view.focus()
})

// Keep the cursor out of the covered area: start scrolling when it gets there (threshold),
// and scroll it clear (margin). 5px is ProseMirror's default margin.
const scrollProps = (inset: number) => ({
  scrollThreshold: { top: 0, left: 0, right: 0, bottom: inset },
  scrollMargin: { top: 5, left: 5, right: 5, bottom: 5 + inset },
})
watch(
  () => props.bottomInset,
  (inset, before) => {
    if (!view) return
    view.setProps(scrollProps(inset))
    // Something just started covering the bottom (after layout, so the extra padding exists): move the cursor clear.
    if (inset > before) view.dispatch(view.state.tr.scrollIntoView())
  },
  { flush: 'post' },
)

watch(
  () => props.vim,
  (enabled) => {
    if (!view) return
    setVimEnabled(view, enabled)
    view.focus()
  },
)

// A zoom change keeps the cursor's line at the same height on screen instead of jumping away.
watch(
  () => props.zoom,
  () => {
    const scroller = view?.dom.closest('.desk')
    if (!view || !scroller) return
    const before = view.coordsAtPos(view.state.selection.head).top
    nextTick(() => {
      if (view) scroller.scrollTop += view.coordsAtPos(view.state.selection.head).top - before
    })
  },
  { flush: 'pre' },
)

onBeforeUnmount(() => view?.destroy())

defineExpose({
  setType(type: ElementType) {
    if (!view) return
    setType(type)(view.state, view.dispatch)
    view.focus()
  },
  scrollToElement(index: number) {
    if (!view) return
    let pos = 0
    for (let i = 0; i < index && i < view.state.doc.childCount; i++) pos += view.state.doc.child(i).nodeSize
    const sel = TextSelection.create(view.state.doc, pos + 1)
    view.dispatch(view.state.tr.setSelection(sel))
    view.focus()
    flashElement(view, pos)
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
  },
  focus: () => view?.focus(),
})
</script>

<template>
  <div class="paper" :style="props.zoom === 1 ? undefined : { zoom: props.zoom }">
    <div ref="mount" />
  </div>
</template>
