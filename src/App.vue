<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
import SidebarResizer from './components/SidebarResizer.vue'
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
import { ZOOM_LEVELS, fitScale, parseZoom, zoomLabel, type Zoom } from './lib/zoom'
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

const SIDEBAR_KEY = 'scarfAce:sidebarWidth'
const SIDEBAR_DEFAULT = 320
const SIDEBAR_MIN = 220
const sidebarWidth = ref(readSidebarWidth())
function readSidebarWidth() {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY))
    return Number.isFinite(saved) && saved > 0 ? saved : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}
watch(sidebarWidth, (width) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(width))
  } catch {
    // Not persisting the width is harmless.
  }
})
// The sidebar may take at most half the window (and 600px), so the page always keeps room.
const windowWidth = ref(window.innerWidth)
const onResize = () => (windowWidth.value = window.innerWidth)
window.addEventListener('resize', onResize)
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
// Room the page needs: 8.5in of paper plus the desk's padding and a scrollbar.
const PAGE_SPACE = 864
const sidebarMax = computed(() =>
  Math.max(SIDEBAR_MIN, Math.min(600, Math.floor(windowWidth.value / 2), windowWidth.value - PAGE_SPACE)),
)
// Docked, the sidebar must leave room for the page; as a drawer over the page it can use the chosen width.
const sidebarWidthShown = computed(() =>
  Math.min(Math.max(sidebarWidth.value, SIDEBAR_MIN), narrow.value ? 600 : sidebarMax.value),
)

// Wide windows dock the sidebar (open/closed is remembered). When there's no room for the sidebar and
// a full page side by side, it collapses and opens as a drawer over the page instead.
const SIDEBAR_OPEN_KEY = 'scarfAce:sidebar'
const narrow = computed(() => windowWidth.value < SIDEBAR_MIN + PAGE_SPACE)
const sidebarDocked = ref(readSidebarOpen())
const drawerOpen = ref(false)
const sidebarVisible = computed(() => (narrow.value ? drawerOpen.value : sidebarDocked.value))
const sceneTree = ref<InstanceType<typeof SceneTree>>()
const sidebarReveal = ref<HTMLButtonElement>()
function readSidebarOpen() {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) !== 'closed'
  } catch {
    return true
  }
}
watch(sidebarDocked, (open) => {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, open ? 'open' : 'closed')
  } catch {
    // Not persisting is harmless.
  }
})
watch(narrow, () => (drawerOpen.value = false))
/** With moveFocus, focus follows to the control that replaces the one just used (hide ⇄ reveal). */
async function toggleSidebar(moveFocus = false) {
  if (narrow.value) drawerOpen.value = !drawerOpen.value
  else sidebarDocked.value = !sidebarDocked.value
  if (!moveFocus) return
  await nextTick()
  if (sidebarVisible.value) sceneTree.value?.focusHide()
  else sidebarReveal.value?.focus()
}
async function closeDrawer(returnFocus = false) {
  drawerOpen.value = false
  if (!returnFocus) return
  await nextTick()
  sidebarReveal.value?.focus()
}
function selectFromTree(index: number) {
  editor.value?.scrollToElement(index)
  if (narrow.value) closeDrawer()
}

/** Boolean preferences stored as 'on' / 'off'. */
function readFlag(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'on'
  } catch {
    return fallback
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // Not persisting the preference is harmless.
  }
}

// Focus mode: only the page. Esc leaves it (a quick double Esc with Vim on, whose Esc is busy).
const focusMode = ref(false)
const focusHint = ref(false)
const focusAwake = ref(false)
const FOCUS_DOUBLE_ESC_MS = 400
let lastFocusEsc = 0
let focusHintTimer: ReturnType<typeof setTimeout> | undefined
let focusAwakeTimer: ReturnType<typeof setTimeout> | undefined
function setFocusMode(on: boolean) {
  focusMode.value = on
  lastFocusEsc = 0
  clearTimeout(focusHintTimer)
  focusHint.value = on
  if (on) focusHintTimer = setTimeout(() => (focusHint.value = false), 4000)
  nextTick(() => editor.value?.focus())
}
/** The exit button fades in while the mouse moves, and out after a moment of stillness. */
function onFocusPointerMove() {
  if (!focusMode.value) return
  focusAwake.value = true
  clearTimeout(focusAwakeTimer)
  focusAwakeTimer = setTimeout(() => (focusAwake.value = false), 2000)
}
function onFocusEscape(e: KeyboardEvent) {
  if (!focusMode.value || e.repeat || (e.target as Element | null)?.closest?.('dialog')) return
  if (!vimEnabled.value) return setFocusMode(false)
  const now = Date.now()
  if (now - lastFocusEsc < FOCUS_DOUBLE_ESC_MS) setFocusMode(false)
  else lastFocusEsc = now
}
const exitHint = computed(() => (vimEnabled.value ? 'Double-press Esc' : 'Press Esc'))
const fullscreenKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌃⌘F' : 'F11'
const focusShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⇧F' : 'Ctrl+Shift+F'

// Page zoom. "Fit" fills the writing area's width, so it follows window and sidebar size.
const ZOOM_KEY = 'scarfAce:zoom'
const zoom = ref<Zoom>(readZoom())
function readZoom(): Zoom {
  try {
    return parseZoom(localStorage.getItem(ZOOM_KEY))
  } catch {
    return 1
  }
}
watch(zoom, (value) => {
  try {
    localStorage.setItem(ZOOM_KEY, String(value))
  } catch {
    // Not persisting the zoom is harmless.
  }
})
const desk = ref<HTMLElement>()
const deskWidth = ref(0)
const deskObserver = new ResizeObserver(([entry]) => (deskWidth.value = (entry.target as HTMLElement).clientWidth))
watch(desk, (el, old) => {
  if (old) deskObserver.unobserve(old)
  if (el) deskObserver.observe(el)
})
onBeforeUnmount(() => deskObserver.disconnect())
// In fit mode the desk drops its side padding, so the page spans the whole writing area.
const effectiveZoom = computed(() => (zoom.value === 'fit' ? fitScale(deskWidth.value) : zoom.value))

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

const REMINDERS_KEY = 'scarfAce:reminders'
const remindersEnabled = ref(readFlag(REMINDERS_KEY, true))
watch(remindersEnabled, (on) => writeFlag(REMINDERS_KEY, on))

const reminder = computed(() =>
  remindersEnabled.value && statusReady.value
    ? reminderReason(script.value.backup, status.value.pageCount, snooze.value)
    : null,
)

/** Height reserved at the bottom of the writing area while the reminder card is showing. */
const REMINDER_INSET = 260

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
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    setFocusMode(!focusMode.value)
    return
  }
  if (e.key === 'Escape' && focusMode.value) {
    onFocusEscape(e)
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '\\') {
    e.preventDefault()
    toggleSidebar()
    return
  }
  if (e.key === 'Escape' && narrow.value && drawerOpen.value) {
    closeDrawer(true)
    return
  }
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
const sidebarShortcut = isMac ? '⌘\\' : 'Ctrl+\\'
</script>

<template>
  <div class="app" :class="{ focus: focusMode }" @pointermove="onFocusPointerMove">
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
      <button
        class="focus-enter"
        aria-label="Focus mode"
        data-tip="Focus mode: just the page"
        :data-tip-kbd="focusShortcutLabel"
        @click="setFocusMode(true)"
      >
        <svg class="panel-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
        </svg>
      </button>
      <SettingsMenu v-model:theme="theme" v-model:vim="vimEnabled" v-model:reminders="remindersEnabled" />
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

    <main
      class="workspace"
      :class="{ 'sidebar-docked': sidebarVisible && !narrow, 'sidebar-drawer': narrow }"
      :style="{ '--sidebar-width': `${sidebarWidthShown}px` }"
    >
      <SidebarResizer
        v-if="sidebarVisible && !narrow"
        v-model="sidebarWidth"
        :min="SIDEBAR_MIN"
        :max="sidebarMax"
        :default-width="SIDEBAR_DEFAULT"
      />
      <Transition name="reveal">
        <button
          v-if="!sidebarVisible"
          ref="sidebarReveal"
          class="sidebar-reveal"
          aria-label="Show scenes sidebar"
          aria-controls="scene-sidebar"
          aria-expanded="false"
          data-tip="Show the scenes sidebar"
          :data-tip-kbd="sidebarShortcut"
          data-tip-side="right"
          @click="toggleSidebar(true)"
        >
          <svg class="panel-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16M13 9l3 3-3 3" />
          </svg>
        </button>
      </Transition>
      <Transition name="drawer-backdrop">
        <div v-if="narrow && drawerOpen" class="drawer-backdrop" @click="closeDrawer()" />
      </Transition>
      <Transition :name="narrow ? 'drawer' : ''">
        <aside v-show="sidebarVisible" id="scene-sidebar" class="sidebar" aria-label="Scenes">
          <SceneTree
            ref="sceneTree"
            :elements="script.elements"
            :hide-shortcut="sidebarShortcut"
            @hide="toggleSidebar(true)"
            :active="status.index"
            :page-starts="status.pageStarts"
            @select="selectFromTree"
          />
        </aside>
      </Transition>
      <section ref="desk" class="desk" :class="{ fit: zoom === 'fit' }" :style="reminder ? { paddingBottom: `${REMINDER_INSET}px` } : undefined">
        <ScriptEditor
          ref="editor"
          :key="script.id"
          :elements="script.elements"
          :vim="vimEnabled"
          :bottom-inset="reminder ? REMINDER_INSET : 0"
          :zoom="effectiveZoom"
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
      <MenuButton label="Zoom" tip="Page zoom" align="right" direction="up" trigger-class="status-trigger">
        <template #trigger>{{ zoomLabel(zoom, effectiveZoom) }}</template>
        <button
          class="menu-item"
          role="menuitemradio"
          :aria-checked="zoom === 'fit'"
          tabindex="-1"
          data-tip="The page fills the width of the writing area"
          data-tip-side="left"
          @click="zoom = 'fit'"
        >
          <span class="radio" aria-hidden="true" />
          <span class="menu-label">Fit width</span>
          <span v-if="zoom === 'fit'" class="menu-note">{{ Math.round(effectiveZoom * 100) }}%</span>
        </button>
        <div class="menu-separator" role="separator" />
        <button
          v-for="level in ZOOM_LEVELS"
          :key="level"
          class="menu-item"
          role="menuitemradio"
          :aria-checked="zoom === level"
          tabindex="-1"
          :data-tip="level === 1 ? 'Actual size, as printed' : `Show the page at ${level * 100}%`"
          data-tip-side="left"
          @click="zoom = level"
        >
          <span class="radio" aria-hidden="true" />
          <span class="menu-label">{{ level * 100 }}%</span>
        </button>
      </MenuButton>
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
    <template v-if="focusMode">
      <Transition name="fade">
        <div v-if="focusHint" class="focus-hint" role="status">
          Focus mode · {{ exitHint }} to exit · <kbd>{{ fullscreenKey }}</kbd> for full screen
        </div>
      </Transition>
      <button
        class="focus-exit"
        :class="{ awake: focusAwake }"
        aria-label="Exit focus mode"
        data-tip="Exit focus mode"
        :data-tip-kbd="vimEnabled ? 'Esc Esc' : 'Esc'"
        data-tip-side="left"
        @click="setFocusMode(false)"
      >
        <svg class="panel-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4" />
        </svg>
      </button>
      <div v-if="status.vim.enabled" class="focus-vim" :class="{ busy: status.vim.pending || status.vim.message || status.vim.mode !== 'normal' }">
        <span class="vim-mode" :class="`vim-mode-${status.vim.mode}`">{{ VIM_MODE_LABELS[status.vim.mode] }}</span>
        <span v-if="status.vim.pending" class="vim-pending">{{ status.vim.pending }}</span>
        <span v-else-if="status.vim.message" class="vim-message">{{ status.vim.message }}</span>
      </div>
    </template>
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
