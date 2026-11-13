<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

// One tooltip for the whole app. Any element with data-tip="…" gets it on hover (after a short delay)
// or keyboard focus. Optional: data-tip-kbd="…" shows a shortcut, data-tip-side="top|bottom|left|right".
type Side = 'top' | 'bottom' | 'left' | 'right'

const ID = 'app-tooltip'
const DELAY_MS = 450
/** After a tooltip was just visible, the next one shows immediately (moving along a toolbar). */
const WARM_MS = 500

const tip = ref<{ text: string; kbd: string } | null>(null)
const pos = ref({ left: 0, top: 0, visible: false })
const el = ref<HTMLElement>()
let current: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let lastHidden = 0
/** Keyboard tooltips are for navigating (Tab, arrows), not for focus a dialog returns on close. */
let lastNavKey = 0
const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

const targetOf = (e: Event) => ((e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null

async function show(target: HTMLElement) {
  current = target
  tip.value = { text: target.dataset.tip ?? '', kbd: target.dataset.tipKbd ?? '' }
  pos.value = { ...pos.value, visible: false }
  target.setAttribute('aria-describedby', ID)
  await nextTick()
  if (current !== target || !el.value) return
  const r = target.getBoundingClientRect()
  const { offsetWidth: w, offsetHeight: h } = el.value
  const gap = 8
  let side = (target.dataset.tipSide as Side | undefined) ?? (r.bottom + gap + h < window.innerHeight - 8 ? 'bottom' : 'top')
  if (side === 'right' && r.right + gap + w > window.innerWidth - 8) side = 'left'
  if (side === 'left' && r.left - gap - w < 8) side = 'right'
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  let left = side === 'right' ? r.right + gap : side === 'left' ? r.left - gap - w : cx - w / 2
  let top = side === 'bottom' ? r.bottom + gap : side === 'top' ? r.top - gap - h : cy - h / 2
  left = Math.min(Math.max(left, 8), window.innerWidth - w - 8)
  top = Math.min(Math.max(top, 8), window.innerHeight - h - 8)
  pos.value = { left, top, visible: true }
}

function hide() {
  clearTimeout(timer)
  if (current) {
    current.removeAttribute('aria-describedby')
    if (pos.value.visible) lastHidden = Date.now()
  }
  current = null
  tip.value = null
  pos.value = { ...pos.value, visible: false }
}

function onPointerOver(e: PointerEvent) {
  if (e.pointerType === 'touch') return
  const target = targetOf(e)
  if (target === current) return
  hide()
  if (!target) return
  const warm = Date.now() - lastHidden < WARM_MS
  timer = setTimeout(() => show(target), warm ? 0 : DELAY_MS)
  current = target
}

function onPointerOut(e: PointerEvent) {
  if (current && !current.contains(e.relatedTarget as Node | null)) hide()
}

function onFocusIn(e: FocusEvent) {
  const target = targetOf(e)
  if (target && target.matches(':focus-visible') && Date.now() - lastNavKey < 200) show(target)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
  // Any other key (Enter, Escape…) means the next focus change isn't the user navigating.
  lastNavKey = NAV_KEYS.has(e.key) ? Date.now() : 0
}

const listeners: [string, EventListener][] = [
  ['pointerover', onPointerOver as EventListener],
  ['pointerout', onPointerOut as EventListener],
  ['focusin', onFocusIn as EventListener],
  ['focusout', hide],
  ['pointerdown', hide],
  ['keydown', onKeyDown as EventListener],
]
onMounted(() => {
  for (const [type, fn] of listeners) document.addEventListener(type, fn, true)
  window.addEventListener('scroll', hide, true)
})
onBeforeUnmount(() => {
  for (const [type, fn] of listeners) document.removeEventListener(type, fn, true)
  window.removeEventListener('scroll', hide, true)
})
</script>

<template>
  <div
    v-if="tip"
    :id="ID"
    ref="el"
    class="app-tooltip"
    :class="{ visible: pos.visible }"
    role="tooltip"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
  >
    {{ tip.text }}<kbd v-if="tip.kbd">{{ tip.kbd }}</kbd>
  </div>
</template>
