<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const props = defineProps<{ elements: ScriptElement[]; vim: boolean }>()
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

watch(
  () => props.vim,
  (enabled) => {
    if (!view) return
    setVimEnabled(view, enabled)
    view.focus()
  },
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
  <div class="paper">
    <div ref="mount" />
  </div>
</template>
