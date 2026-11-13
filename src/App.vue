<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ScriptEditor, { type EditorStatus } from './components/ScriptEditor.vue'
import TitlePageDialog from './components/TitlePageDialog.vue'
import LibraryDialog from './components/LibraryDialog.vue'
import {
  ELEMENT_LABELS,
  ELEMENT_TYPES,
  NEXT_ON_ENTER,
  NEXT_ON_TAB,
  newScript,
  scriptFileName,
  type ElementType,
  type Script,
  type ScriptElement,
} from './lib/screenplay'
import { deleteScript, lastOpenedId, listScripts, loadScript, sampleScript, saveScript } from './lib/storage'
import { fromFountain, toFountain } from './lib/fountain'

const editor = ref<InstanceType<typeof ScriptEditor>>()
const titleDialog = ref<InstanceType<typeof TitlePageDialog>>()
const libraryDialog = ref<InstanceType<typeof LibraryDialog>>()
const fileInput = ref<HTMLInputElement>()

const saveState = ref<'saved' | 'pending' | 'error'>('saved')
const busy = ref(false)
const scripts = ref(listScripts())
const script = ref<Script>(initialScript())
const status = ref<EditorStatus>({ type: 'scene', page: 1, pageCount: 1 })

function initialScript(): Script {
  const last = lastOpenedId()
  const existing = (last && loadScript(last)) || (scripts.value[0] && loadScript(scripts.value[0].id))
  if (existing) return existing
  const sample = sampleScript()
  persist(sample)
  return sample
}

function persist(s: Script) {
  try {
    saveScript(s)
    saveState.value = 'saved'
  } catch (e) {
    console.error(e)
    saveState.value = 'error'
  }
  scripts.value = listScripts()
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave() {
  saveState.value = 'pending'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => persist(script.value), 400)
}

function flushSave() {
  if (saveState.value !== 'pending') return
  clearTimeout(saveTimer)
  persist(script.value)
}
window.addEventListener('beforeunload', flushSave)

watch(() => script.value.titlePage, scheduleSave, { deep: true })

function onChange(elements: ScriptElement[]) {
  script.value.elements = elements
  scheduleSave()
}

function open(s: Script) {
  flushSave()
  script.value = s
  persist(s)
}

function openById(id: string) {
  const s = loadScript(id)
  if (s) open(s)
}

function createNew() {
  open(newScript())
  titleDialog.value?.open()
}

function removeScript(id: string) {
  deleteScript(id)
  scripts.value = listScripts()
  if (id === script.value.id) {
    const next = scripts.value[0] && loadScript(scripts.value[0].id)
    script.value = next || newScript()
    persist(script.value)
  }
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const { elements, titlePage } = fromFountain(await file.text())
  if (!titlePage.title) titlePage.title = file.name.replace(/\.[^.]+$/, '')
  open(newScript(elements, titlePage))
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportFountain() {
  download(`${scriptFileName(script.value)}.fountain`, toFountain(script.value.elements, script.value.titlePage), 'text/plain')
}

async function exportAsPdf() {
  busy.value = true
  try {
    const { exportPdf } = await import('./lib/pdf')
    await exportPdf(script.value)
  } catch (e) {
    console.error(e)
    alert(`PDF export failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}

const scenes = computed(() => {
  const out: { index: number; number: number; text: string }[] = []
  script.value.elements.forEach((el, index) => {
    if (el.type === 'scene') out.push({ index, number: out.length + 1, text: el.text.trim().toUpperCase() || '(untitled scene)' })
  })
  return out
})

const typeModel = computed({
  get: () => status.value.type,
  set: (t: ElementType) => editor.value?.setType(t),
})

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const shortcut = (i: number) => `${isMac ? '⌘⌥' : 'Ctrl+Alt+'}${i + 1}`
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <span class="brand">Scarf&nbsp;Ace</span>
      <button @click="createNew">New</button>
      <button @click="libraryDialog?.open()">Open…</button>
      <button @click="fileInput?.click()">Import Fountain</button>
      <input ref="fileInput" type="file" accept=".fountain,.spmd,.txt,text/plain" hidden @change="importFile" />
      <span class="sep" />
      <select v-model="typeModel" class="type-select" title="Element type">
        <option v-for="(t, i) in ELEMENT_TYPES" :key="t" :value="t">{{ ELEMENT_LABELS[t] }} ({{ shortcut(i) }})</option>
      </select>
      <span class="sep" />
      <button class="title-btn" @click="titleDialog?.open()">{{ script.titlePage.title || 'Untitled' }}</button>
      <span class="spacer" />
      <button @click="exportFountain">Export Fountain</button>
      <button class="primary" :disabled="busy" @click="exportAsPdf">{{ busy ? 'Exporting…' : 'Export PDF' }}</button>
    </header>

    <main class="workspace">
      <aside class="sidebar">
        <h3>Scenes</h3>
        <ol v-if="scenes.length" class="scenes">
          <li v-for="s in scenes" :key="s.index">
            <button class="link" @click="editor?.scrollToElement(s.index)">
              <span class="num">{{ s.number }}</span>{{ s.text }}
            </button>
          </li>
        </ol>
        <p v-else class="hint">No scenes yet. Start a line with INT. or EXT.</p>
      </aside>
      <section class="desk">
        <ScriptEditor
          ref="editor"
          :key="script.id"
          :elements="script.elements"
          @change="onChange"
          @status="status = $event"
        />
      </section>
    </main>

    <footer class="statusbar">
      <strong>{{ ELEMENT_LABELS[status.type] }}</strong>
      <span>Enter → {{ ELEMENT_LABELS[NEXT_ON_ENTER[status.type]] }}</span>
      <span>Tab → {{ ELEMENT_LABELS[NEXT_ON_TAB[status.type]] }}</span>
      <span class="spacer" />
      <span>Page {{ status.page }} of {{ status.pageCount }}</span>
      <span :class="['save', saveState]">{{
        saveState === 'saved' ? 'Saved locally' : saveState === 'pending' ? 'Saving…' : 'Save failed — storage full?'
      }}</span>
    </footer>

    <TitlePageDialog ref="titleDialog" v-model="script.titlePage" />
    <LibraryDialog
      ref="libraryDialog"
      :scripts="scripts"
      :current-id="script.id"
      @open="openById"
      @delete="removeScript"
    />
  </div>
</template>
