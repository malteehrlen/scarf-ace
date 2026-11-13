<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ count: number; current: number; replaceMode: boolean; initial: string }>()
const emit = defineEmits<{
  search: [options: { query: string; matchCase: boolean; wholeWord: boolean }]
  step: [dir: 1 | -1]
  replace: [text: string]
  replaceAll: [text: string]
  close: []
}>()

const query = ref(props.initial)
const replacement = ref('')
const matchCase = ref(false)
const wholeWord = ref(false)
const showReplace = ref(props.replaceMode)
const message = ref('')
const findInput = ref<HTMLInputElement>()
const replaceInput = ref<HTMLInputElement>()

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const counter = computed(() => {
  if (message.value) return message.value
  if (!query.value) return ''
  return props.count ? `${props.current + 1} of ${props.count}` : 'No results'
})

watch([query, matchCase, wholeWord], () => {
  message.value = ''
  emit('search', { query: query.value, matchCase: matchCase.value, wholeWord: wholeWord.value })
}, { immediate: true })

function onFindKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('step', e.shiftKey ? -1 : 1)
  }
}

function onReplaceKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) doReplaceAll()
    else emit('replace', replacement.value)
  }
}

function doReplaceAll() {
  const n = props.count
  emit('replaceAll', replacement.value)
  message.value = n ? `Replaced ${n}` : ''
  // The buttons disable once nothing matches; keep the keyboard focus somewhere useful.
  replaceInput.value?.focus()
}

/** Re-opening (Ctrl+F again) focuses the right field, optionally with new text. */
async function focus(replace: boolean, text?: string) {
  if (replace) showReplace.value = true
  if (text) query.value = text
  await nextTick()
  const input = replace && query.value ? replaceInput.value : findInput.value
  input?.focus()
  input?.select()
}
defineExpose({ focus })
</script>

<template>
  <div class="find-bar" role="search" @keydown.esc.prevent="emit('close')">
    <button
      class="find-toggle-replace"
      :aria-expanded="showReplace"
      aria-label="Toggle replace"
      :data-tip="showReplace ? 'Hide replace' : 'Show replace'"
      @click="showReplace = !showReplace"
    >
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3 1.5 L7 5 L3 8.5" /></svg>
    </button>
    <div class="find-rows">
      <div class="find-row">
        <input
          ref="findInput"
          v-model="query"
          class="find-input"
          placeholder="Find"
          aria-label="Find"
          spellcheck="false"
          @keydown="onFindKey"
        />
        <span class="find-count" aria-live="polite">{{ counter }}</span>
        <button class="find-opt" :class="{ on: matchCase }" :aria-pressed="matchCase" aria-label="Match case" data-tip="Match case" @click="matchCase = !matchCase">Aa</button>
        <button class="find-opt" :class="{ on: wholeWord }" :aria-pressed="wholeWord" aria-label="Whole word" data-tip="Whole words only" @click="wholeWord = !wholeWord">
          <span class="whole-word">ab</span>
        </button>
        <button class="find-btn" aria-label="Previous match" data-tip="Previous match" data-tip-kbd="Shift+Enter" :disabled="!count" @click="emit('step', -1)">↑</button>
        <button class="find-btn" aria-label="Next match" data-tip="Next match" data-tip-kbd="Enter" :disabled="!count" @click="emit('step', 1)">↓</button>
        <button class="find-btn" aria-label="Close find" data-tip="Close" data-tip-kbd="Esc" @click="emit('close')">✕</button>
      </div>
      <div v-if="showReplace" class="find-row">
        <input
          ref="replaceInput"
          v-model="replacement"
          class="find-input"
          placeholder="Replace"
          aria-label="Replace with"
          spellcheck="false"
          @keydown="onReplaceKey"
        />
        <button
          class="find-text-btn"
          :disabled="!count"
          :data-tip="matchCase ? 'Replace this match' : 'Replace this match, keeping its capitalization (MAYA → MIA)'"
          data-tip-kbd="Enter"
          @click="emit('replace', replacement)"
        >
          Replace
        </button>
        <button
          class="find-text-btn"
          :disabled="!count"
          data-tip="Replace every match (one undo)"
          :data-tip-kbd="isMac ? '⌘Enter' : 'Ctrl+Enter'"
          @click="doReplaceAll"
        >
          All
        </button>
      </div>
    </div>
  </div>
</template>
