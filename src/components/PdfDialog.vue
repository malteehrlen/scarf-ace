<script setup lang="ts">
import { ref } from 'vue'
import type { PdfSettings } from '../lib/screenplay'

const settings = defineModel<PdfSettings>({ required: true })
const autoContd = defineModel<boolean>('autoContd', { required: true })
defineProps<{ busy: boolean; hasTitlePage: boolean }>()
const emit = defineEmits<{ export: [] }>()
const dialog = ref<HTMLDialogElement>()

defineExpose({ open: () => dialog.value?.showModal() })

/** Enter exports from anywhere in the dialog (e.g. after ticking a box); a focused button keeps its own Enter. */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || (e.target as Element).closest('button')) return
  e.preventDefault()
  exportNow()
}

function exportNow() {
  dialog.value?.close()
  emit('export')
}
</script>

<template>
  <dialog ref="dialog" class="modal" aria-labelledby="pdf-title" @click.self="dialog?.close()" @keydown="onKeydown">
    <div class="form">
      <h2 id="pdf-title">Export PDF</h2>
      <label class="check">
        <input v-model="settings.sceneNumbers" type="checkbox" />
        <span>
          Scene numbers
          <small>In both margins, for shooting scripts. Leave off for spec scripts.</small>
        </span>
      </label>
      <label class="check">
        <input v-model="autoContd" type="checkbox" />
        <span>
          Automatic (CONT'D)
          <small>When a character speaks again after action in the same scene. Also shown while writing.</small>
        </span>
      </label>
      <p class="hint">
        {{ hasTitlePage ? 'Includes the title page.' : 'No title page: set a title in File › Title page… to add one.' }}
        Scene numbers are remembered for this script.
      </p>
      <div class="actions">
        <button data-tip="Close without exporting" data-tip-kbd="Esc" @click="dialog?.close()">Cancel</button>
        <!-- Focused when the dialog opens, so Enter exports right away. -->
        <button class="primary" :disabled="busy" autofocus data-tip="Download the PDF" data-tip-kbd="Enter" @click="exportNow">
          Export PDF
        </button>
      </div>
    </div>
  </dialog>
</template>
