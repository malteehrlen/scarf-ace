<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import MenuButton from './MenuButton.vue'
import { onSystemThemeChange, resolveTheme, type ThemePreference } from '../lib/theme'

const theme = defineModel<ThemePreference>('theme', { required: true })
const vim = defineModel<boolean>('vim', { required: true })
const reminders = defineModel<boolean>('reminders', { required: true })

const THEMES: { value: ThemePreference; label: string; tip: string }[] = [
  { value: 'system', label: 'System', tip: "Follow your computer's light or dark setting" },
  { value: 'light', label: 'Light', tip: 'Always use the light theme' },
  { value: 'dark', label: 'Dark', tip: 'Always use the dark theme' },
]

// Shown next to "System" so it's clear what it resolves to right now.
const systemTheme = ref(resolveTheme('system'))
const stop = onSystemThemeChange(() => (systemTheme.value = resolveTheme('system')))
onBeforeUnmount(stop)
</script>

<template>
  <MenuButton label="Settings" tip="Settings: theme, reminders and keyboard" align="right" trigger-class="icon-trigger">
    <template #trigger>
      <svg class="menu-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        />
      </svg>
    </template>

    <div role="group" aria-labelledby="settings-theme-heading">
      <div id="settings-theme-heading" class="menu-heading">Theme</div>
      <button
        v-for="option in THEMES"
        :key="option.value"
        class="menu-item"
        role="menuitemradio"
        :aria-checked="theme === option.value"
        tabindex="-1"
        :data-tip="option.tip"
        data-tip-side="left"
        @click="theme = option.value"
      >
        <span class="radio" aria-hidden="true" />
        <svg class="menu-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <use :href="`#theme-icon-${option.value}`" />
        </svg>
        <span class="menu-label">{{ option.label }}</span>
        <span v-if="option.value === 'system'" class="menu-note">{{ systemTheme }} now</span>
      </button>
    </div>
    <div class="menu-separator" role="separator" />
    <button
      class="menu-item"
      role="menuitemcheckbox"
      :aria-checked="reminders"
      tabindex="-1"
      data-tip="After a new page or 30 minutes of writing, suggest downloading a backup"
      data-tip-side="left"
      @click="reminders = !reminders"
    >
      <span class="checkbox" aria-hidden="true" />
      <span class="menu-label">Backup reminders</span>
    </button>
    <button class="menu-item" role="menuitemcheckbox"
      :aria-checked="vim"
      tabindex="-1"
      data-tip="Modal editing for Vim users"
      data-tip-side="left"
      @click="vim = !vim"
    >
      <span class="checkbox" aria-hidden="true" />
      <span class="menu-label">Vim keybindings</span>
    </button>

    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <symbol id="theme-icon-system" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </symbol>
      <symbol id="theme-icon-light" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </symbol>
      <symbol id="theme-icon-dark" viewBox="0 0 24 24">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
      </symbol>
    </svg>
  </MenuButton>
</template>
