<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { buildOutline, type OutlineScene } from '../lib/outline'
import type { ElementType, ScriptElement } from '../lib/screenplay'

const props = defineProps<{
  elements: ScriptElement[]
  /** Index of the element containing the cursor. */
  active: number
  pageStarts: { page: number; el: number }[]
  /** Shortcut shown in the hide button's tooltip. */
  hideShortcut: string
}>()
const emit = defineEmits<{ select: [index: number]; hide: [] }>()
const hideButton = ref<HTMLButtonElement>()
defineExpose({ focusHide: () => hideButton.value?.focus() })

const NODE_NAMES: Record<ElementType, string> = {
  scene: 'scene_heading',
  action: 'action',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  transition: 'transition',
  shot: 'shot',
}

const root = ref<HTMLElement>()
const follow = ref(true)
/** Scenes the user expanded, keyed by scene number (0 = before the first scene). */
const pinned = ref(new Set<number>())
/** The active scene, if the user collapsed it while following the cursor. */
const suppressed = ref<number | null>(null)

/** The cursor as far as the tree is concerned: with follow off, the tree ignores it entirely. */
const cursor = computed(() => (follow.value ? props.active : -1))

const scenes = computed(() => buildOutline(props.elements, cursor.value))
const activeScene = computed(() => scenes.value.find((s) => cursor.value >= Math.max(s.index, 0) && cursor.value < s.end))
const activeCue = computed(() => {
  for (const node of activeScene.value?.children ?? []) {
    if (node.children.some((c) => c.index === cursor.value)) return node.index
  }
  return -1
})

function pageOf(index: number) {
  let page = 1
  for (const start of props.pageStarts) if (start.el <= index) page = start.page
  return page
}

function isOpen(scene: OutlineScene) {
  if (pinned.value.has(scene.number)) return true
  return activeScene.value === scene && suppressed.value !== scene.number
}

function toggleFollow() {
  if (follow.value) {
    // Freeze the tree as it is: keep whatever the cursor had auto-expanded open.
    pinned.value = new Set(scenes.value.filter(isOpen).map((s) => s.number))
    suppressed.value = null
  }
  follow.value = !follow.value
}

function toggle(scene: OutlineScene) {
  const set = new Set(pinned.value)
  if (isOpen(scene)) {
    set.delete(scene.number)
    if (activeScene.value === scene) suppressed.value = scene.number
  } else {
    set.add(scene.number)
    if (suppressed.value === scene.number) suppressed.value = null
  }
  pinned.value = set
}

function expandAll() {
  pinned.value = new Set(scenes.value.map((s) => s.number))
  suppressed.value = null
}

function collapseAll() {
  pinned.value = new Set()
  suppressed.value = activeScene.value?.number ?? null
}

watch(
  () => activeScene.value?.number,
  () => (suppressed.value = null),
)

// Keep the highlighted node visible as the cursor moves.
watch(
  cursor,
  async () => {
    if (!follow.value) return
    await nextTick()
    root.value?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  },
)

const preview = (text: string) => text || '∅'
</script>

<template>
  <div ref="root" class="tree">
    <div class="tree-head">
      <h3>Scenes <span class="count">{{ scenes.filter((s) => s.number > 0).length }}</span></h3>
      <div class="tree-tools">
        <button
          class="icon"
          :class="{ on: follow }"
          :aria-pressed="follow"
          aria-label="Follow cursor"
          :data-tip="follow ? 'Following the cursor: the scene you\'re in stays open. Click to browse freely' : 'Follow the cursor: keep the scene you\'re in open and highlighted'"
          @click="toggleFollow"
        >
          ◎
        </button>
        <button class="icon" aria-label="Expand all" data-tip="Expand all scenes" @click="expandAll">⊞</button>
        <button class="icon" aria-label="Collapse all" data-tip="Collapse all scenes" @click="collapseAll">⊟</button>
        <span class="tree-tools-sep" />
        <button
          ref="hideButton"
          class="icon"
          aria-label="Hide scenes sidebar"
          aria-controls="scene-sidebar"
          aria-expanded="true"
          data-tip="Hide the sidebar"
          :data-tip-kbd="hideShortcut"
          @click="emit('hide')"
        >
          <svg class="panel-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16M16 9l-3 3 3 3" />
          </svg>
        </button>
      </div>
    </div>

    <p v-if="!scenes.length" class="hint">No scenes yet. Start a line with INT. or EXT.</p>

    <ol class="scenes">
      <li
        v-for="scene in scenes"
        :key="scene.number"
        class="scene"
        :class="{ 'is-current': activeScene === scene, open: isOpen(scene) }"
      >
        <div class="scene-row" :class="{ 'is-active': cursor === scene.index }">
          <button class="chevron" :aria-expanded="isOpen(scene)" :aria-label="isOpen(scene) ? 'Collapse scene' : 'Expand scene'"
            :data-tip="isOpen(scene) ? 'Hide this scene\'s lines' : 'Show this scene\'s lines'" @click="toggle(scene)">
            <svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 1.5 L7 5 L3 8.5" /></svg>
          </button>
          <button
            class="scene-main"
            :data-tip="`Jump to scene ${scene.number || 'start'} (page ${pageOf(Math.max(scene.index, 0))})`"
            @click="emit('select', Math.max(scene.index, 0))"
          >
            <span class="scene-line">
              <span class="scene-num">{{ scene.number || '·' }}</span>
              <span class="scene-heading">{{ scene.number ? scene.heading || '(untitled scene)' : 'Before first scene' }}</span>
              <span class="scene-page">p{{ pageOf(Math.max(scene.index, 0)) }}</span>
            </span>
            <span v-if="scene.characters.length" class="cast">
              <span v-for="c in scene.characters" :key="c" class="chip">{{ c }}</span>
            </span>
          </button>
        </div>

        <div class="collapse">
          <ul class="nodes">
            <li v-for="node in scene.children" :key="node.index">
              <button
                class="node"
                :class="{ 'is-active': cursor === node.index, 'is-path': activeCue === node.index }"
                :tabindex="isOpen(scene) ? 0 : -1"
                data-tip="Jump to this line"
                data-tip-side="right"
                @click="emit('select', node.index)"
              >
                <span class="node-type" :class="`t-${node.type}`">{{ NODE_NAMES[node.type] }}</span>
                <span class="node-text">{{ preview(node.text) }}</span>
              </button>
              <ul v-if="node.children.length" class="nodes">
                <li v-for="child in node.children" :key="child.index">
                  <button
                    class="node"
                    :class="{ 'is-active': cursor === child.index }"
                    :tabindex="isOpen(scene) ? 0 : -1"
                    data-tip="Jump to this line"
                    data-tip-side="right"
                    @click="emit('select', child.index)"
                  >
                    <span class="node-type" :class="`t-${child.type}`">{{ NODE_NAMES[child.type] }}</span>
                    <span class="node-text">{{ preview(child.text) }}</span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </li>
    </ol>
  </div>
</template>
