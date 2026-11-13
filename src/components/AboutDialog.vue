<script setup lang="ts">
import { ref } from 'vue'
import { APP_AUTHOR, APP_NAME, APP_VERSION, FEEDBACK_URL } from '../lib/about'

const dialog = ref<HTMLDialogElement>()
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
          {{ APP_NAME }} is free to use. There is exactly one condition: by using it, you agree that if your script gets
          made, you invite {{ APP_AUTHOR }} to the premiere.
        </p>
      </div>

      <p class="hint">
        Scripts use the open <a href="https://fountain.io" target="_blank" rel="noopener" data-tip="fountain.io (opens in a new tab)">Fountain</a> format. Typeset in
        Courier Prime by Quote-Unquote Apps (SIL Open Font License).
      </p>
      <div class="actions">
        <button class="primary" data-tip="Close" data-tip-kbd="Esc" @click="dialog?.close()">Close</button>
      </div>
    </div>
  </dialog>
</template>
