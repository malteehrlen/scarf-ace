<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onSystemThemeChange, resolveTheme, type ThemePreference } from '../lib/theme'

const model = defineModel<ThemePreference>({ required: true })

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const open = ref(false)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
/** Menu options in document order (a v-for ref array doesn't guarantee order). */
const options = () => [...(root.value?.querySelectorAll<HTMLButtonElement>('.theme-option') ?? [])]
const current = computed(() => OPTIONS.find((o) => o.value === model.value)!)

// Shown next to "System" so it's clear what it resolves to right now.
const systemTheme = ref(resolveTheme('system'))
const stop = onSystemThemeChange(() => (systemTheme.value = resolveTheme('system')))
onBeforeUnmount(stop)

async function show(focusChecked = true) {
  open.value = true
  await nextTick()
  if (focusChecked) options()[OPTIONS.indexOf(current.value)]?.focus()
}

function close(returnFocus = true) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function choose(value: ThemePreference) {
  model.value = value
  close()
}

// Opened from the keyboard (Enter/Space give a click with detail 0), focus moves into the menu.
function onTriggerClick(e: MouseEvent) {
  if (open.value) close()
  else show(e.detail === 0)
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    show()
  } else if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    close()
  }
}

function onMenuKey(e: KeyboardEvent) {
  const list = options()
  const index = list.indexOf(document.activeElement as HTMLButtonElement)
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

function onPointerDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) close(false)
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onPointerDown, true)
  else document.removeEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="root" class="theme-menu">
    <button
      ref="trigger"
      class="theme-trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-controls="theme-menu-list"
      :title="`Theme: ${current.label}`"
      @click="onTriggerClick"
      @keydown="onTriggerKey"
    >
      <svg class="theme-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <use :href="`#theme-icon-${current.value}`" />
      </svg>
      <span>{{ current.label }}</span>
      <svg class="theme-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
    </button>

    <Transition name="pop">
      <div v-if="open" id="theme-menu-list" class="theme-list" role="menu" aria-label="Theme" @keydown="onMenuKey">
        <button
          v-for="option in OPTIONS"
          :key="option.value"
          class="theme-option"
          role="menuitemradio"
          :aria-checked="model === option.value"
          :tabindex="model === option.value ? 0 : -1"
          @click="choose(option.value)"
        >
          <span class="radio" aria-hidden="true" />
          <svg class="theme-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <use :href="`#theme-icon-${option.value}`" />
          </svg>
          <span class="theme-option-label">{{ option.label }}</span>
          <span v-if="option.value === 'system'" class="theme-option-note">{{ systemTheme }} now</span>
        </button>
      </div>
    </Transition>

    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <symbol id="theme-icon-system" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </symbol>
      <symbol id="theme-icon-light" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </symbol>
      <symbol id="theme-icon-dark" viewBox="0 0 24 24">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
      </symbol>
    </svg>
  </div>
</template>
