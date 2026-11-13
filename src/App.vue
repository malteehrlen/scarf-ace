<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ScriptEditor, { type EditorStatus } from './components/ScriptEditor.vue'
import TitlePageDialog from './components/TitlePageDialog.vue'
import LibraryDialog from './components/LibraryDialog.vue'
import SceneTree from './components/SceneTree.vue'
import BackupReminder from './components/BackupReminder.vue'
import MenuButton from './components/MenuButton.vue'
import SettingsMenu from './components/SettingsMenu.vue'
import HelpDialog from './components/HelpDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import AppTooltip from './components/AppTooltip.vue'
import { APP_NAME } from './lib/about'
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
import { paginate } from './lib/paginate'
import {
  applyTheme,
  onSystemThemeChange,
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from './lib/theme'
import { MINUTE, markBackedUp, recordActivity, reminderReason, snoozeAt, type Snooze } from './lib/backup'

const editor = ref<InstanceType<typeof ScriptEditor>>()
const titleDialog = ref<InstanceType<typeof TitlePageDialog>>()
const libraryDialog = ref<InstanceType<typeof LibraryDialog>>()
const fileInput = ref<HTMLInputElement>()
const helpDialog = ref<InstanceType<typeof HelpDialog>>()
const aboutDialog = ref<InstanceType<typeof AboutDialog>>()

const saveState = ref<'saved' | 'pending' | 'error'>('saved')
const busy = ref(false)
const scripts = ref(listScripts())
const script = ref<Script>(initialScript())
const status = ref<EditorStatus>({
  type: 'scene',
  index: 0,
  page: 1,
  pageCount: 1,
  pageStarts: [],
  vim: { enabled: false, mode: 'normal', pending: '', message: '' },
})
/** False between switching scripts and the new editor reporting its page count. */
const statusReady = ref(false)
const snooze = ref<Snooze | null>(null)
let lastEdit: number | null = null
const theme = ref<ThemePreference>(readThemePreference())
watch(theme, (preference) => {
  saveThemePreference(preference)
  applyTheme(preference)
})
const stopFollowingSystem = onSystemThemeChange(() => {
  if (theme.value === 'system') applyTheme('system')
})
onBeforeUnmount(stopFollowingSystem)

const VIM_KEY = 'scarfAce:vim'
const vimEnabled = ref(readVimSetting())
function readVimSetting() {
  try {
    return localStorage.getItem(VIM_KEY) === 'on'
  } catch {
    return false
  }
}
watch(vimEnabled, (on) => {
  try {
    localStorage.setItem(VIM_KEY, on ? 'on' : 'off')
  } catch {
    // Not persisting the preference is harmless.
  }
})
const VIM_MODE_LABELS = { normal: 'NORMAL', insert: 'INSERT', visual: 'VISUAL', 'visual-line': 'V-LINE' } as const

const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(clock))

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
  script.value.backup = recordActivity(script.value.backup, lastEdit)
  lastEdit = Date.now()
  scheduleSave()
}

function onStatus(next: EditorStatus) {
  status.value = next
  statusReady.value = true
}

function open(s: Script) {
  flushSave()
  script.value = s
  statusReady.value = false
  snooze.value = null
  lastEdit = null
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
  const imported = newScript(elements, titlePage)
  // The writer already has this file, so it counts as a backup.
  imported.backup = markBackedUp(paginate(elements).pages.length)
  open(imported)
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportFountain() {
  download(`${scriptFileName(script.value)}.fountain`, toFountain(script.value.elements, script.value.titlePage), 'text/plain')
  script.value.backup = markBackedUp(status.value.pageCount)
  snooze.value = null
  clearTimeout(saveTimer)
  persist(script.value)
}

const reminder = computed(() =>
  statusReady.value ? reminderReason(script.value.backup, status.value.pageCount, snooze.value) : null,
)

function remindLater() {
  snooze.value = snoozeAt(script.value.backup, status.value.pageCount)
}

const backupLabel = computed(() => {
  const at = script.value.backup.lastAt
  if (at == null) return 'Not backed up'
  const minutes = Math.floor((now.value - at) / MINUTE)
  if (minutes < 1) return 'Backed up just now'
  if (minutes < 60) return `Backed up ${minutes} min ago`
  if (minutes < 24 * 60) return `Backed up ${Math.floor(minutes / 60)} h ago`
  return `Backed up ${new Date(at).toLocaleDateString()}`
})

// Writers press Ctrl/Cmd+S out of habit; make it do the one save that leaves the browser.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.key === '/')) {
    e.preventDefault()
    helpDialog.value?.open()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    exportFountain()
  }
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

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

const typeModel = computed({
  get: () => status.value.type,
  set: (t: ElementType) => editor.value?.setType(t),
})

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const typeShortcuts = `${isMac ? '⌘⌥' : 'Ctrl+Alt+'}1–${ELEMENT_TYPES.length}`
const saveShortcut = isMac ? '⌘S' : 'Ctrl+S'
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <span class="brand">Scarf&nbsp;Ace</span>
      <MenuButton label="File" tip="New, open, import and export scripts" trigger-class="text-trigger">
        <template #trigger>File</template>
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="Start a new, empty script" data-tip-side="right" @click="createNew">
          <span class="menu-label">New script</span>
        </button>
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="Switch to another script saved in this browser" data-tip-side="right" @click="libraryDialog?.open()">
          <span class="menu-label">Open…</span>
        </button>
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="Open a .fountain file: a backup, or a script from another app" data-tip-side="right" @click="fileInput?.click()">
          <span class="menu-label">Import Fountain…</span>
        </button>
        <div class="menu-separator" role="separator" />
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="Title, author, contact details and draft date" data-tip-side="right" @click="titleDialog?.open()">
          <span class="menu-label">Title page…</span>
        </button>
        <div class="menu-separator" role="separator" />
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="Save a copy of this script as a Fountain file" data-tip-side="right" @click="exportFountain">
          <span class="menu-label">Download backup (.fountain)</span>
          <kbd class="menu-note">{{ saveShortcut }}</kbd>
        </button>
        <button class="menu-item" role="menuitem" tabindex="-1" :disabled="busy" data-tip="Print-ready, industry-standard PDF" data-tip-side="right" @click="exportAsPdf">
          <span class="menu-label">Export PDF</span>
        </button>
      </MenuButton>
      <input ref="fileInput" type="file" accept=".fountain,.spmd,.txt,text/plain" hidden @change="importFile" />
      <span class="sep" />
      <button class="doc-title" data-tip="Edit the title page" @click="titleDialog?.open()">
        <span class="doc-title-text">{{ script.titlePage.title || 'Untitled' }}</span>
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg>
      </button>
      <span class="sep" />
      <select v-model="typeModel" class="type-select" :data-tip="'Element type of the current line'" :data-tip-kbd="`Tab · ${typeShortcuts}`" aria-label="Element type">
        <option v-for="t in ELEMENT_TYPES" :key="t" :value="t">{{ ELEMENT_LABELS[t] }}</option>
      </select>
      <span class="spacer" />
      <SettingsMenu v-model:theme="theme" v-model:vim="vimEnabled" />
      <MenuButton label="Help" tip="Help and about" align="right" trigger-class="icon-trigger">
        <template #trigger>
          <svg class="menu-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.6M12 17h.01" />
          </svg>
        </template>
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="How everything works, with all shortcuts" data-tip-side="left" @click="helpDialog?.open()">
          <span class="menu-label">Help &amp; shortcuts</span>
          <kbd class="menu-note">F1</kbd>
        </button>
        <button class="menu-item" role="menuitem" tabindex="-1" data-tip="Free software, feedback and the fine print" data-tip-side="left" @click="aboutDialog?.open()">
          <span class="menu-label">About {{ APP_NAME }}</span>
        </button>
      </MenuButton>
      <button class="primary" :disabled="busy" data-tip="Download a print-ready PDF" @click="exportAsPdf">{{ busy ? 'Exporting…' : 'Export PDF' }}</button>
    </header>

    <main class="workspace">
      <aside class="sidebar">
        <SceneTree
          :elements="script.elements"
          :active="status.index"
          :page-starts="status.pageStarts"
          @select="editor?.scrollToElement($event)"
        />
      </aside>
      <section class="desk">
        <ScriptEditor
          ref="editor"
          :key="script.id"
          :elements="script.elements"
          :vim="vimEnabled"
          @change="onChange"
          @write="exportFountain"
          @status="onStatus"
        />
      </section>
    </main>

    <footer class="statusbar">
      <template v-if="status.vim.enabled">
        <span class="vim-mode" :class="`vim-mode-${status.vim.mode}`" tabindex="0" data-tip="Vim mode (turn off in ⚙ Settings)">{{ VIM_MODE_LABELS[status.vim.mode] }}</span>
        <span v-if="status.vim.pending" class="vim-pending">{{ status.vim.pending }}</span>
        <span v-else-if="status.vim.message" class="vim-message">{{ status.vim.message }}</span>
      </template>
      <strong tabindex="0" data-tip="Element type of the current line">{{ ELEMENT_LABELS[status.type] }}</strong>
      <span tabindex="0" data-tip="What Enter starts next">Enter → {{ ELEMENT_LABELS[NEXT_ON_ENTER[status.type]] }}</span>
      <span tabindex="0" data-tip="What Tab turns this line into">Tab → {{ ELEMENT_LABELS[NEXT_ON_TAB[status.type]] }}</span>
      <span class="spacer" />
      <span tabindex="0" data-tip="Page with the cursor, and total pages as in the PDF">Page {{ status.page }} of {{ status.pageCount }}</span>
      <button
        class="backup-status"
        :class="{ due: reminder }"
        data-tip="Download a Fountain backup"
        :data-tip-kbd="saveShortcut"
        @click="exportFountain"
      >
        {{ backupLabel }}
      </button>
      <span :class="['save', saveState]" tabindex="0" data-tip="Every change is saved automatically in this browser">{{
        saveState === 'saved' ? 'Saved locally' : saveState === 'pending' ? 'Saving…' : 'Save failed — storage full?'
      }}</span>
    </footer>

    <HelpDialog ref="helpDialog" />
    <AboutDialog ref="aboutDialog" />
    <AppTooltip />
    <BackupReminder :reason="reminder" :shortcut="saveShortcut" @backup="exportFountain" @later="remindLater" />
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
