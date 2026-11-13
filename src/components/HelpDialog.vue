<script setup lang="ts">
import { ref } from 'vue'
import { ELEMENT_LABELS, ELEMENT_TYPES, NEXT_ON_ENTER, NEXT_ON_TAB, type ElementType } from '../lib/screenplay'
import { APP_NAME } from '../lib/about'

const dialog = ref<HTMLDialogElement>()
const body = ref<HTMLElement>()
defineExpose({
  open: () => {
    dialog.value?.showModal()
    body.value?.scrollTo({ top: 0 })
  },
})

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'
const focusKey = isMac ? '⌘⇧F' : 'Ctrl+Shift+F'
const fullscreenKey = isMac ? '⌃⌘F' : 'F11'
const typeKey = (i: number) => (isMac ? `⌘⌥${i + 1}` : `Ctrl+Alt+${i + 1}`)

const EXAMPLES: Record<ElementType, string> = {
  scene: 'INT. LAUNDROMAT - NIGHT',
  action: 'Maya feeds quarters into a dryer.',
  character: 'MAYA',
  parenthetical: '(quietly)',
  dialogue: 'I think it needs a better owner.',
  transition: 'CUT TO:',
  shot: 'CLOSE ON THE SCARF',
}

const SECTIONS = [
  { id: 'help-basics', label: 'The basics' },
  { id: 'help-writing', label: 'Writing' },
  { id: 'help-navigating', label: 'Finding your way' },
  { id: 'help-saving', label: 'Saving & backups' },
  { id: 'help-exporting', label: 'Exporting' },
  { id: 'help-shortcuts', label: 'Shortcuts' },
]

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-wide" aria-labelledby="help-title" @click.self="dialog?.close()">
    <div class="help">
      <header class="help-head">
        <h2 id="help-title">How {{ APP_NAME }} works</h2>
        <button class="ghost" data-tip="Close help" data-tip-kbd="Esc" @click="dialog?.close()">Close</button>
      </header>
      <nav class="help-toc" aria-label="Help sections">
        <button v-for="s in SECTIONS" :key="s.id" class="chip-btn" :data-tip="`Jump to “${s.label}”`" @click="jump(s.id)">
          {{ s.label }}
        </button>
      </nav>

      <div ref="body" class="help-body">
        <section :id="SECTIONS[0].id">
          <h3>The basics</h3>
          <p>
            {{ APP_NAME }} formats your screenplay for you. You never set margins, indents or capital letters:
            you only say what each line <em>is</em> (a scene heading, action, a character's name, dialogue…) and
            the page follows the industry standard automatically, exactly as it will print.
          </p>
          <p>Each line is one of seven <strong>elements</strong>:</p>
          <ul class="help-elements">
            <li v-for="t in ELEMENT_TYPES" :key="t">
              <span class="node-type" :class="`t-${t}`">{{ ELEMENT_LABELS[t] }}</span>
              <code>{{ EXAMPLES[t] }}</code>
            </li>
          </ul>
          <p class="help-tip">
            The element you're on is tagged in the margin next to the cursor, and shown in the toolbar and status bar.
          </p>
        </section>

        <section :id="SECTIONS[1].id">
          <h3>Writing</h3>
          <p>
            Just type. <kbd>Enter</kbd> starts the element that usually comes next, and <kbd>Tab</kbd> switches the
            current line to its most common alternative. Most scenes can be written without touching the mouse:
          </p>
          <table class="help-table">
            <thead>
              <tr><th>On a…</th><th><kbd>Enter</kbd> starts</th><th><kbd>Tab</kbd> turns it into</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in ELEMENT_TYPES" :key="t">
                <td><span class="node-type" :class="`t-${t}`">{{ ELEMENT_LABELS[t] }}</span></td>
                <td>{{ ELEMENT_LABELS[NEXT_ON_ENTER[t]] }}</td>
                <td>{{ ELEMENT_LABELS[NEXT_ON_TAB[t]] }}</td>
              </tr>
            </tbody>
          </table>
          <ul>
            <li><kbd>Enter</kbd> on an empty line turns it into Action, so pressing it twice after dialogue gets you back to action.</li>
            <li>Typing <code>INT.</code> or <code>EXT.</code> at the start of an action line makes it a scene heading; <code>CUT TO:</code> becomes a transition.</li>
            <li>In empty dialogue, typing <kbd>(</kbd> starts a parenthetical, and <kbd>)</kbd> at its end takes you back to dialogue. The parentheses are added for you.</li>
            <li>Choose any element directly with the dropdown in the toolbar or <kbd>{{ typeKey(0) }}</kbd>…<kbd>{{ typeKey(6) }}</kbd>.</li>
            <li>Copy and paste work in the <a href="https://fountain.io" target="_blank" rel="noopener" data-tip="fountain.io (opens in a new tab)">Fountain</a> plain-text format, so pasting a scene from another app keeps its elements.</li>
          </ul>
          <p class="help-tip">A wavy red underline means dialogue without a character name above it.</p>
        </section>

        <section :id="SECTIONS[2].id">
          <h3>Finding your way</h3>
          <ul>
            <li><strong>Scenes sidebar.</strong> Every scene with its page and cast. Click the arrow to see its lines, and click any line to jump there.</li>
            <li>
              <strong>Hide the sidebar</strong> with the panel button at the end of its header, and bring it back with the
              small button that stays at the top left (or <kbd>{{ mod }}+\</kbd>). On smaller screens it tucks away by itself and slides in over the page when you open it.
              Drag its edge to make it wider.
            </li>
            <li>
              <strong>Focus mode</strong> (the corners button in the toolbar, or <kbd>{{ focusKey }}</kbd>) hides everything
              but the page. Press <kbd>Esc</kbd> to come back (with Vim keybindings on, press it twice quickly). For a truly
              full screen, add your browser's full-screen mode: <kbd>{{ fullscreenKey }}</kbd>.
            </li>
            <li>
              <strong>Zoom</strong> from the status bar: <em>Fit width</em> makes the page fill the writing area edge to edge
              (great together with focus mode), or pick a fixed size. Zooming only changes the size on screen; lines and pages stay exactly as printed.
            </li>
            <li><strong>Follow cursor</strong> (◎ above the scene list) keeps the scene you're writing in open and highlighted. Turn it off to browse freely.</li>
            <li><strong>Page breaks</strong> appear right in the page, in the same places as in the PDF. The status bar shows which page you're on.</li>
            <li><strong>Title page.</strong> Click the script's name in the toolbar (or File › Title page…) to set the title, author, contact details and draft date.</li>
          </ul>
        </section>

        <section :id="SECTIONS[3].id">
          <h3>Saving & backups</h3>
          <p>
            Every change saves automatically, but only <strong>in this browser</strong>. Clearing your browser data, a private
            window or switching computers can lose it. So keep backups:
          </p>
          <ul>
            <li><strong>File › Download backup</strong> or <kbd>{{ mod }}+S</kbd> saves a <code>.fountain</code> file you can keep anywhere.</li>
            <li>After a new page or half an hour of writing, a reminder offers to do it for you (you can turn reminders off in ⚙ Settings). The status bar shows when you last backed up.</li>
            <li><strong>File › Import Fountain…</strong> opens a backup again, or a script from Trelby, Highland, Fade In and other apps that speak Fountain.</li>
            <li><strong>File › Open…</strong> switches between the scripts saved in this browser.</li>
          </ul>
        </section>

        <section :id="SECTIONS[4].id">
          <h3>Exporting</h3>
          <p>
            <strong>Export PDF</strong> creates a print-ready script in 12pt Courier with standard margins, a title page, page
            numbers and proper page breaks: scene headings are never stranded at the bottom of a page, and dialogue that
            continues on the next page gets <code>(MORE)</code> and <code>(CONT'D)</code>.
          </p>
        </section>

        <section :id="SECTIONS[5].id">
          <h3>Shortcuts</h3>
          <table class="help-table">
            <tbody>
              <tr><td><kbd>Enter</kbd></td><td>Next element</td></tr>
              <tr><td><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd></td><td>Change the current element</td></tr>
              <tr v-for="(t, i) in ELEMENT_TYPES" :key="t"><td><kbd>{{ typeKey(i) }}</kbd></td><td>{{ ELEMENT_LABELS[t] }}</td></tr>
              <tr><td><kbd>{{ mod }}+S</kbd></td><td>Download a Fountain backup</td></tr>
              <tr><td><kbd>{{ mod }}+Z</kbd> / <kbd>{{ isMac ? '⌘⇧Z' : 'Ctrl+Y' }}</kbd></td><td>Undo / redo</td></tr>
              <tr><td><kbd>{{ mod }}+\</kbd></td><td>Show or hide the scenes sidebar</td></tr>
              <tr><td><kbd>{{ focusKey }}</kbd></td><td>Focus mode (<kbd>Esc</kbd> to leave)</td></tr>
              <tr><td><kbd>F1</kbd> or <kbd>{{ mod }}+/</kbd></td><td>This help</td></tr>
            </tbody>
          </table>
          <p class="help-tip">
            Power users: modal editing with Vim keybindings can be turned on in ⚙ Settings.
          </p>
        </section>
      </div>
    </div>
  </dialog>
</template>
