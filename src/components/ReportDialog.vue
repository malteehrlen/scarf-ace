<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { buildReport, formatEighths, type Report } from '../lib/report'
import { paginate } from '../lib/paginate'
import type { ScriptElement } from '../lib/screenplay'

const props = defineProps<{ elements: ScriptElement[]; autoContd: boolean; title: string }>()
const emit = defineEmits<{ select: [index: number] }>()

const dialog = ref<HTMLDialogElement>()
const tab = ref<'overview' | 'scenes' | 'characters'>('overview')
const report = shallowRef<Report | null>(null)

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'characters', label: 'Characters' },
] as const

defineExpose({
  open() {
    report.value = buildReport(props.elements, paginate(props.elements, { autoContd: props.autoContd }))
    dialog.value?.showModal()
  },
})

function jump(index: number) {
  dialog.value?.close()
  emit('select', index)
}

const percent = (x: number) => `${Math.round(x * 100)}%`
</script>

<template>
  <dialog ref="dialog" class="modal modal-wide" aria-labelledby="report-title" @click.self="dialog?.close()">
    <div v-if="report" class="help report">
      <header class="help-head">
        <h2 id="report-title">Script report<small v-if="title"> · {{ title }}</small></h2>
        <button class="ghost" data-tip="Close the report" data-tip-kbd="Esc" @click="dialog?.close()">Close</button>
      </header>
      <nav class="help-toc" role="tablist" aria-label="Report sections">
        <button
          v-for="t in TABS"
          :key="t.id"
          class="chip-btn"
          :class="{ on: tab === t.id }"
          role="tab"
          :aria-selected="tab === t.id"
          :data-tip="`Show ${t.label.toLowerCase()}`"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>

      <div class="help-body" role="tabpanel">
        <div v-if="tab === 'overview'" class="report-stats">
          <div class="stat"><strong>{{ report.pages }}</strong><span>pages</span></div>
          <div class="stat"><strong>~{{ report.minutes }} min</strong><span>screen time (a page a minute)</span></div>
          <div class="stat"><strong>{{ report.scenes.length }}</strong><span>scenes</span></div>
          <div class="stat"><strong>{{ report.characters.length }}</strong><span>speaking characters</span></div>
          <div class="stat"><strong>{{ report.words.toLocaleString() }}</strong><span>words</span></div>
          <div class="stat"><strong>{{ percent(report.dialogueShare) }}</strong><span>of words are dialogue</span></div>
          <div class="stat"><strong>{{ report.interior }} / {{ report.exterior }}</strong><span>interior / exterior scenes</span></div>
          <div class="stat"><strong>{{ report.day }} / {{ report.night }}</strong><span>day / night scenes</span></div>
        </div>

        <table v-else-if="tab === 'scenes'" class="help-table report-table">
          <thead>
            <tr><th>#</th><th>Scene</th><th>Page</th><th>Length</th><th>Speaking</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in report.scenes" :key="s.index">
              <td class="num">{{ s.number }}</td>
              <td>
                <button class="link" :data-tip="`Jump to scene ${s.number}`" @click="jump(s.index)">{{ s.heading }}</button>
              </td>
              <td class="num">{{ s.page }}</td>
              <td class="num">{{ formatEighths(s.eighths) }}</td>
              <td class="muted">{{ s.characters.join(', ') }}</td>
            </tr>
            <tr v-if="!report.scenes.length"><td colspan="5" class="muted">No scenes yet.</td></tr>
          </tbody>
        </table>

        <table v-else class="help-table report-table">
          <thead>
            <tr><th>Character</th><th>Speeches</th><th>Words</th><th>Scenes</th><th>First page</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in report.characters" :key="c.name">
              <td><strong>{{ c.name }}</strong></td>
              <td class="num">{{ c.speeches }}</td>
              <td class="num">{{ c.words.toLocaleString() }}</td>
              <td class="num">{{ c.scenes }}</td>
              <td class="num">{{ c.firstPage }}</td>
            </tr>
            <tr v-if="!report.characters.length"><td colspan="5" class="muted">No dialogue yet.</td></tr>
          </tbody>
        </table>
        <p v-if="tab === 'scenes'" class="help-tip">Lengths are in eighths of a page, the unit used for scheduling.</p>
      </div>
    </div>
  </dialog>
</template>
