<script setup lang="ts">
import { computed } from 'vue'
import type { ReminderReason } from '../lib/backup'

const props = defineProps<{ reason: ReminderReason | null; shortcut: string }>()
const emit = defineEmits<{ backup: []; later: [] }>()

const message = computed(() => {
  const r = props.reason
  if (!r) return ''
  if (r.kind === 'never') return 'This script hasn’t been saved outside this browser yet.'
  if (r.kind === 'pages') return `You’ve written ${r.pages} new page${r.pages === 1 ? '' : 's'} since your last backup.`
  return `You’ve been writing for ${r.minutes} minutes since your last backup.`
})
</script>

<template>
  <Transition name="toast">
    <aside v-if="reason" class="reminder" role="status">
      <svg class="reminder-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <div class="reminder-body">
        <strong>Back up your script</strong>
        <p>{{ message }}</p>
        <p class="reminder-why">Scripts are stored only in this browser. Clearing site data or switching browsers loses them.</p>
        <div class="reminder-actions">
          <button class="primary" @click="emit('backup')">Download .fountain</button>
          <button class="ghost" @click="emit('later')">Later</button>
        </div>
        <div class="reminder-hint">Tip: <kbd>{{ shortcut }}</kbd> downloads a backup any time.</div>
      </div>
    </aside>
  </Transition>
</template>
