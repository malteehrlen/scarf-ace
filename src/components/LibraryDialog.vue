<script setup lang="ts">
import { ref } from 'vue'
import type { ScriptSummary } from '../lib/storage'

defineProps<{ scripts: ScriptSummary[]; currentId: string }>()
const emit = defineEmits<{ open: [id: string]; delete: [id: string] }>()
const dialog = ref<HTMLDialogElement>()

defineExpose({ open: () => dialog.value?.showModal() })

function choose(id: string) {
  emit('open', id)
  dialog.value?.close()
}

function remove(s: ScriptSummary) {
  if (confirm(`Delete "${s.title}"? This cannot be undone.`)) emit('delete', s.id)
}

const fmt = (t: number) => new Date(t).toLocaleString()
</script>

<template>
  <dialog ref="dialog" class="modal" @click.self="dialog?.close()">
    <div class="form">
      <h2>Your scripts</h2>
      <p class="hint">Scripts are saved in this browser only. Use File › Download backup to keep a copy elsewhere.</p>
      <ul class="library">
        <li v-for="s in scripts" :key="s.id" :class="{ current: s.id === currentId }">
          <button class="link" :data-tip="s.id === currentId ? 'This script is already open' : 'Open this script'" @click="choose(s.id)">
            <strong>{{ s.title }}</strong>
            <small>{{ fmt(s.updatedAt) }}</small>
          </button>
          <button class="ghost" data-tip="Delete this script from this browser (asks first)" @click="remove(s)">Delete</button>
        </li>
      </ul>
      <div class="actions"><button data-tip="Close" data-tip-kbd="Esc" @click="dialog?.close()">Close</button></div>
    </div>
  </dialog>
</template>
