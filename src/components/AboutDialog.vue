<script setup lang="ts">
import { ref } from 'vue'
import { APP_NAME, APP_VERSION, CREATOR_EMAIL, FEEDBACK_URL } from '../lib/about'

const dialog = ref<HTMLDialogElement>()
const BASE = import.meta.env.BASE_URL
defineExpose({ open: () => dialog.value?.showModal() })
</script>

<template>
  <dialog ref="dialog" class="modal" aria-labelledby="about-title" @click.self="dialog?.close()">
    <div class="form about">
      <h2 id="about-title">{{ APP_NAME }} <small>v{{ APP_VERSION }}</small></h2>
      <p>
        A free screenwriting app that runs in your browser. No account and no subscription; your scripts stay on your
        computer.
      </p>

      <h3>Feedback</h3>
      <p v-if="FEEDBACK_URL">
        Found a bug or have an idea?
        <a :href="FEEDBACK_URL" target="_blank" rel="noopener" data-tip="Opens GitHub in a new tab">Open an issue on GitHub</a>.
      </p>
      <p v-else>Found a bug or have an idea? Feedback goes through GitHub. The link is coming soon.</p>

      <div class="fine-print">
        <h3>The fine print</h3>
        <p>
          {{ APP_NAME }} is free and open source (MIT). Just one small request: if your script gets made, please
          <a :href="`mailto:${CREATOR_EMAIL}`" :data-tip="`Email ${CREATOR_EMAIL}`">invite me</a>
          to the premiere.
        </p>
      </div>

      <p class="hint">
        Scripts use the open <a href="https://fountain.io" target="_blank" rel="noopener" data-tip="fountain.io (opens in a new tab)">Fountain</a> format. Typeset in
        Courier Prime (© The Courier Prime Project Authors, SIL Open Font License). Built with open source software:
        <a :href="`${BASE}third-party-licenses.txt`" target="_blank" rel="noopener" data-tip="Licenses of the libraries Scarf Ace uses (opens in a new tab)">licenses</a>.
      </p>
      <div class="actions">
        <button class="primary" data-tip="Close" data-tip-kbd="Esc" @click="dialog?.close()">Close</button>
      </div>
    </div>
  </dialog>
</template>
