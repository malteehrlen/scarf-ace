<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

// A button that opens a menu, with the usual keyboard behavior. Menu items are elements with
// class "menu-item" (role menuitem / menuitemradio / menuitemcheckbox); activating one closes the menu.
const props = withDefaults(
  defineProps<{ label: string; tip?: string; tipKbd?: string; align?: 'left' | 'right'; triggerClass?: string }>(),
  { tip: undefined, tipKbd: undefined, align: 'left', triggerClass: '' },
)

const open = ref(false)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const listId = useId()

/** Items in document order (a v-for ref array doesn't guarantee order). */
const items = () => [...(root.value?.querySelectorAll<HTMLElement>('.menu-item:not([disabled])') ?? [])]

async function show(focusItem: boolean) {
  open.value = true
  await nextTick()
  if (!focusItem) return
  const list = items()
  ;(list.find((el) => el.getAttribute('aria-checked') === 'true' && el.getAttribute('role') === 'menuitemradio') ?? list[0])?.focus()
}

function close(returnFocus = true) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

// From the keyboard (Enter/Space give a click with detail 0), focus moves into the menu.
function onTriggerClick(e: MouseEvent) {
  if (open.value) close()
  else show(e.detail === 0)
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    show(true)
  } else if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    close()
  }
}

function onMenuKey(e: KeyboardEvent) {
  const list = items()
  const index = list.indexOf(document.activeElement as HTMLElement)
  const focus = (i: number) => list[(i + list.length) % list.length]?.focus()
  if (e.key === 'ArrowDown') focus(index + 1)
  else if (e.key === 'ArrowUp') focus(index - 1)
  else if (e.key === 'Home') focus(0)
  else if (e.key === 'End') focus(list.length - 1)
  else if (e.key === 'Escape') close()
  else if (e.key === 'Tab') close(false)
  else return
  if (e.key !== 'Tab') e.preventDefault()
}

function onMenuClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.menu-item')) close()
}

function onPointerDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) close(false)
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onPointerDown, true)
  else document.removeEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))

defineExpose({ close })
</script>

<template>
  <div ref="root" class="menu-button">
    <button
      ref="trigger"
      class="menu-trigger"
      :class="props.triggerClass"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-label="props.label"
      :data-tip="props.tip ?? props.label"
      :data-tip-kbd="props.tipKbd"
      @click="onTriggerClick"
      @keydown="onTriggerKey"
    >
      <slot name="trigger" />
      <svg class="menu-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
    </button>
    <Transition name="pop">
      <div
        v-if="open"
        :id="listId"
        class="menu-list"
        :class="`menu-${props.align}`"
        role="menu"
        :aria-label="props.label"
        @keydown="onMenuKey"
        @click="onMenuClick"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>
