<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_FDX_EXPORT,
  defaultImportOptions,
  fdxExportIssues,
  fdxImportIssues,
  type FdxExportOptions,
  type FdxImportOptions,
  type ParsedFdx,
} from '../lib/fdx'
import type { ScriptElement } from '../lib/screenplay'

// Final Draft import/export: asks only about the things in this script or file that don't map
// one-to-one, with defaults that keep content. Export choices are remembered.
const emit = defineEmits<{ export: [options: FdxExportOptions]; import: [options: FdxImportOptions] }>()

interface Question {
  key: string
  title: string
  detail: string
  options: { value: string; label: string; hint?: string }[]
}

const EXPORT_KEY = 'scarfAce:fdxExport'
const dialog = ref<HTMLDialogElement>()
const mode = ref<'export' | 'import'>('export')
const fileName = ref('')
const questions = ref<Question[]>([])
const notes = ref<string[]>([])
const choices = reactive<Record<string, string>>({})

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function readExportChoices(): FdxExportOptions {
  try {
    return { ...DEFAULT_FDX_EXPORT, ...JSON.parse(localStorage.getItem(EXPORT_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_FDX_EXPORT }
  }
}

function setChoices(values: object) {
  for (const k of Object.keys(choices)) delete choices[k]
  Object.assign(choices, values)
}

function openExport(elements: ScriptElement[]) {
  const issues = fdxExportIssues(elements)
  const q: Question[] = []
  if (issues.sections) {
    q.push({
      key: 'sections',
      title: plural(issues.sections, 'section heading'),
      detail: 'Final Draft has no sections (# Act One).',
      options: [
        { value: 'general', label: 'Keep as General paragraphs', hint: 'They will print.' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.synopses) {
    q.push({
      key: 'synopses',
      title: plural(issues.synopses, 'synopsis', 'synopses'),
      detail: 'Final Draft keeps scene summaries on its index cards.',
      options: [
        { value: 'summary', label: 'As scene summaries', hint: 'On the scene\'s index card; not printed.' },
        { value: 'general', label: 'As General paragraphs', hint: 'They will print.' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.notes) {
    q.push({
      key: 'notes',
      title: plural(issues.notes, 'note'),
      detail: 'Your [[notes]] are part of the text.',
      options: [
        { value: 'text', label: 'Keep them in the text as [[…]]', hint: 'They will print; remove them in Final Draft if needed.' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.scenes) {
    q.push({
      key: 'sceneNumbers',
      title: 'Scene numbers',
      detail: 'Numbered scenes are for shooting scripts.',
      options: [
        { value: 'custom', label: 'Only the numbers you set yourself (#12A#)', hint: 'Final Draft can still number scenes for you.' },
        { value: 'all', label: 'Number every scene', hint: 'Fixes the current numbering in the file.' },
      ],
    })
  }
  mode.value = 'export'
  questions.value = q
  notes.value = [
    "(MORE) and (CONT'D) are added by Final Draft itself.",
    'Formatting, dual dialogue, centered text, page breaks and the title page carry over.',
  ]
  setChoices(readExportChoices())
  dialog.value?.showModal()
}

/** Shows the import choices. Returns false (and shows nothing) when there is nothing to decide. */
function openImport(parsed: ParsedFdx, name: string): boolean {
  const issues = fdxImportIssues(parsed)
  const q: Question[] = []
  if (issues.general) {
    q.push({
      key: 'general',
      title: plural(issues.general, 'General paragraph'),
      detail: 'Scarf Ace has no General element.',
      options: [
        { value: 'action', label: 'Bring them in as action' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.acts) {
    q.push({
      key: 'acts',
      title: plural(issues.acts, 'act break'),
      detail: 'New Act / End of Act markers.',
      options: [
        { value: 'section', label: 'As sections', hint: 'Outline headings in the sidebar; not printed.' },
        { value: 'centered', label: 'As centered text', hint: 'Printed.' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.notes) {
    q.push({
      key: 'notes',
      title: plural(issues.notes, 'script note'),
      detail: "Final Draft's notes.",
      options: [
        { value: 'note', label: 'As notes [[…]]', hint: 'Shown while writing; never printed.' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.summaries) {
    q.push({
      key: 'summaries',
      title: plural(issues.summaries, 'scene summary', 'scene summaries'),
      detail: 'From the index cards.',
      options: [
        { value: 'synopsis', label: 'As synopses', hint: 'Under each scene heading; not printed.' },
        { value: 'omit', label: 'Leave them out' },
      ],
    })
  }
  if (issues.sceneNumbers) {
    q.push({
      key: 'sceneNumbers',
      title: plural(issues.sceneNumbers, 'scene number'),
      detail: issues.customNumbers ? 'Some are not simply 1, 2, 3 (e.g. 12A).' : 'They run 1, 2, 3…',
      options: [
        { value: 'keep', label: 'Keep them', hint: 'Fixed numbers, as in a shooting script.' },
        { value: 'drop', label: 'Drop them', hint: 'Scenes are numbered automatically.' },
      ],
    })
  }
  if (issues.titlePage) {
    q.push({
      key: 'titlePage',
      title: 'Title page',
      detail: "Final Draft's title page is free-form.",
      options: [
        { value: 'guess', label: 'Fill in the title page fields', hint: 'A best guess; check File › Title page… afterwards.' },
        { value: 'ignore', label: 'Ignore it' },
      ],
    })
  }
  const info: string[] = []
  if (issues.otherTypes.length) info.push(`Other elements (${issues.otherTypes.join(', ')}) come in as action.`)
  if (issues.droppedStyles) {
    info.push(`${plural(issues.droppedStyles, 'paragraph uses', 'paragraphs use')} formatting Scarf Ace doesn't have (e.g. strikeout); the text is kept without it.`)
  }
  if (!q.length && !info.length) return false
  mode.value = 'import'
  fileName.value = name
  questions.value = q
  notes.value = info
  setChoices(defaultImportOptions(issues))
  dialog.value?.showModal()
  return true
}

defineExpose({ openExport, openImport })

const title = computed(() => (mode.value === 'export' ? 'Export to Final Draft' : `Import ${fileName.value}`))

/** Enter confirms from anywhere (browsers don't submit on Enter in a radio group); buttons keep their own Enter. */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || (e.target as Element).closest('button')) return
  e.preventDefault()
  confirm()
}

function confirm() {
  dialog.value?.close()
  if (mode.value === 'export') {
    const options = { ...choices } as unknown as FdxExportOptions
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(options))
    } catch {
      // Not remembering the choices is harmless.
    }
    emit('export', options)
  } else emit('import', { ...choices } as unknown as FdxImportOptions)
}
</script>

<template>
  <dialog ref="dialog" class="modal" aria-labelledby="fdx-title" @click.self="dialog?.close()">
    <form class="form fdx" @submit.prevent="confirm" @keydown="onKeydown">
      <h2 id="fdx-title">{{ title }}</h2>
      <p v-if="questions.length" class="hint">
        {{ mode === 'export' ? 'Some parts of this script have no exact match in Final Draft.' : 'Some parts of this file have no exact match in Scarf Ace.' }}
        Choose what happens to them:
      </p>
      <p v-else class="hint">Everything in this script has a match in Final Draft.</p>

      <fieldset v-for="q in questions" :key="q.key" class="fdx-question">
        <legend><strong>{{ q.title }}</strong> <span>{{ q.detail }}</span></legend>
        <label v-for="o in q.options" :key="o.value" class="check" :data-tip="o.hint">
          <input v-model="choices[q.key]" type="radio" :name="q.key" :value="o.value" />
          <span>
            {{ o.label }}
            <small v-if="o.hint">{{ o.hint }}</small>
          </span>
        </label>
      </fieldset>

      <ul v-if="notes.length" class="fdx-notes">
        <li v-for="n in notes" :key="n">{{ n }}</li>
      </ul>

      <div class="actions">
        <button type="button" data-tip="Close without changing anything" data-tip-kbd="Esc" @click="dialog?.close()">Cancel</button>
        <button class="primary" type="submit" autofocus :data-tip="mode === 'export' ? 'Download the .fdx file' : 'Open it as a new script'" data-tip-kbd="Enter">
          {{ mode === 'export' ? 'Export .fdx' : 'Import' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
