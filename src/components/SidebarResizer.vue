<script setup lang="ts">
import { computed, ref } from 'vue'

// Drag handle on the sidebar's right edge. Also keyboard-operable (arrows, Shift+arrows, Home/End).
const props = defineProps<{ min: number; max: number; defaultWidth: number }>()
const width = defineModel<number>({ required: true })

const dragging = ref(false)
const clamp = (w: number) => Math.round(Math.min(Math.max(w, props.min), props.max))
const percent = computed(() => Math.round(((width.value - props.min) / (props.max - props.min)) * 100))
let startX = 0
let startWidth = 0

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = true
  startX = e.clientX
  startWidth = width.value
  document.body.classList.add('resizing')
}

function onPointerMove(e: PointerEvent) {
  if (dragging.value) width.value = clamp(startWidth + e.clientX - startX)
}

function onPointerUp() {
  dragging.value = false
  document.body.classList.remove('resizing')
}

function onKeyDown(e: KeyboardEvent) {
  const step = e.shiftKey ? 64 : 16
  const next: Record<string, number> = {
    ArrowLeft: width.value - step,
    ArrowRight: width.value + step,
    Home: props.min,
    End: props.max,
  }
  if (!(e.key in next)) return
  e.preventDefault()
  width.value = clamp(next[e.key])
}
</script>

<template>
  <div
    class="sidebar-resizer"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize the scenes sidebar"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
    tabindex="0"
    data-tip="Drag to resize · double-click to reset"
    data-tip-side="right"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="width = defaultWidth"
    @keydown="onKeyDown"
  />
</template>
