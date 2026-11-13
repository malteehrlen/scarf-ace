<script setup lang="ts">
import { ref } from 'vue'
import type { TitlePage } from '../lib/screenplay'

const model = defineModel<TitlePage>({ required: true })
const dialog = ref<HTMLDialogElement>()

defineExpose({ open: () => dialog.value?.showModal() })
</script>

<template>
  <dialog ref="dialog" class="modal" @click.self="dialog?.close()">
    <form method="dialog" class="form">
      <h2>Title page</h2>
      <label>Title <input v-model="model.title" autofocus /></label>
      <label>Credit <input v-model="model.credit" placeholder="Written by" /></label>
      <label>Author(s) <input v-model="model.author" /></label>
      <label>Source <input v-model="model.source" placeholder="Based on the novel by…" /></label>
      <label>Draft date <input v-model="model.draftDate" placeholder="First Draft, November 2026" /></label>
      <label>Contact <textarea v-model="model.contact" rows="4" placeholder="Name&#10;Email&#10;Phone" /></label>
      <p class="hint">The title page is included in the PDF when a title is set.</p>
      <div class="actions"><button class="primary" data-tip="Changes save as you type" data-tip-kbd="Esc">Done</button></div>
    </form>
  </dialog>
</template>
