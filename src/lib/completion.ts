// The autocomplete popup in the editor: suggestions below the cursor; ↑/↓ choose, Tab/Enter accept,
// Esc dismisses. Only active at the end of a character cue, scene heading or transition.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { NAME_COMPLETION_TYPES, suggest, suggestName, vocabulary, type Suggestions, type Vocabulary } from './autocomplete'
import { vimKey } from './vim'
import type { ElementType, ScriptElement } from './screenplay'

export const completionKey = new PluginKey('completion')

interface Active extends Suggestions {
  /** Document position of the completed part's start, and of the cursor. */
  start: number
  end: number
}

class CompletionView {
  dom = document.createElement('ul')
  active: Active | null = null
  selected = 0
  /** Suggestions are hidden after Esc until the text changes. */
  dismissedText: string | null = null
  private vocab: { doc: PMNode; vocab: Vocabulary } | null = null
  private onScroll = () => this.position()

  constructor(
    readonly view: EditorView,
    readonly elementsOf: (doc: PMNode) => ScriptElement[],
  ) {
    this.dom.className = 'completion'
    this.dom.setAttribute('role', 'listbox')
    this.dom.setAttribute('aria-label', 'Suggestions')
    this.dom.hidden = true
    // Keep focus in the editor when an item is clicked.
    this.dom.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const li = (e.target as HTMLElement).closest('li')
      if (li?.dataset.index) this.accept(Number(li.dataset.index))
    })
    document.body.append(this.dom)
    window.addEventListener('scroll', this.onScroll, true)
    this.update()
  }

  private vocabularyFor(doc: PMNode, skip: number): Vocabulary {
    // Rebuilt only when the document changes (skip only matters for the line being typed).
    if (this.vocab?.doc !== doc) this.vocab = { doc, vocab: vocabulary(this.elementsOf(doc), skip) }
    return this.vocab.vocab
  }

  private compute(state: EditorState): Active | null {
    const { selection } = state
    if (!selection.empty || !this.view.hasFocus()) return null
    const vim = vimKey.getState(state)
    if (vim?.enabled && vim.mode !== 'insert') return null
    const { $head } = selection
    if ($head.depth !== 1 || $head.parentOffset !== $head.parent.content.size) return null
    const type = $head.parent.attrs.type as ElementType
    if (type !== 'character' && type !== 'scene' && type !== 'transition') return null
    const text = $head.parent.textContent
    if (text === this.dismissedText) return null
    this.dismissedText = null
    const result = suggest(type, text, this.vocabularyFor(state.doc, $head.index(0)))
    if (!result) return null
    const start = $head.start()
    return { ...result, start: start + result.from, end: $head.pos }
  }

  update() {
    const next = this.compute(this.view.state)
    const same = next && this.active && next.items.join('\n') === this.active.items.join('\n')
    this.active = next
    if (!same) this.selected = 0
    this.render()
  }

  private render() {
    if (!this.active) {
      this.dom.hidden = true
      return
    }
    this.dom.replaceChildren(
      ...this.active.items.map((item, i) => {
        const li = document.createElement('li')
        li.textContent = item
        li.dataset.index = String(i)
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', String(i === this.selected))
        return li
      }),
    )
    const hint = document.createElement('li')
    hint.className = 'completion-hint'
    hint.textContent = 'Tab or Enter to accept · Esc to dismiss'
    this.dom.append(hint)
    this.dom.hidden = false
    this.position()
  }

  private position() {
    if (!this.active || this.dom.hidden) return
    const c = this.view.coordsAtPos(this.active.start)
    this.dom.style.left = `${Math.round(c.left)}px`
    this.dom.style.top = `${Math.round(c.bottom + 4)}px`
  }

  move(dir: 1 | -1) {
    if (!this.active) return
    this.selected = (this.selected + dir + this.active.items.length) % this.active.items.length
    this.render()
  }

  accept(index = this.selected) {
    const a = this.active
    if (!a) return
    const tr = this.view.state.tr.insertText(a.items[index] + a.suffix, a.start, a.end)
    this.view.dispatch(tr.scrollIntoView())
    this.view.focus()
  }

  dismiss() {
    this.dismissedText = this.view.state.selection.$head.parent.textContent
    this.active = null
    this.render()
  }

  destroy() {
    window.removeEventListener('scroll', this.onScroll, true)
    this.dom.remove()
  }
}

export function completionPlugin(elementsOf: (doc: PMNode) => ScriptElement[]): Plugin {
  let ui: CompletionView | null = null
  return new Plugin({
    key: completionKey,
    view(view) {
      ui = new CompletionView(view, elementsOf)
      return { update: () => ui?.update(), destroy: () => ui?.destroy() }
    },
    props: {
      handleKeyDown(_view, e) {
        if (!ui?.active || e.ctrlKey || e.metaKey || e.altKey) return false
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') ui.move(e.key === 'ArrowDown' ? 1 : -1)
        else if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') ui.accept()
        else if (e.key === 'Escape') {
          ui.dismiss()
          e.stopPropagation() // only close the popup, not e.g. focus mode
        }
        else return false
        return true
      },
      handleDOMEvents: {
        blur: () => {
          ui?.update()
          return false
        },
        focus: () => {
          ui?.update()
          return false
        },
      },
    },
  })
}

// --- Character names in prose: inline "ghost text", accepted with Tab -------------------------
// A popup would get in the way while writing sentences (Enter starts a new line, arrows move), so
// prose gets the rest of the name in grey after the cursor. Tab accepts; anything else ignores it.

interface NameState {
  /** Shown only right after typing, not when the cursor is merely moved next to a word. */
  typing: boolean
  /** "pos:text before the cursor" where the writer pressed Esc. */
  dismissed: string | null
}

export const nameKey = new PluginKey<NameState>('name-completion')

interface Ghost {
  /** Start of the word being completed, and the cursor. */
  from: number
  to: number
  name: string
}

export function namePlugin(elementsOf: (doc: PMNode) => ScriptElement[]): Plugin<NameState> {
  let cache: { doc: PMNode; vocab: Vocabulary } | null = null
  const vocabFor = (doc: PMNode) => {
    if (cache?.doc !== doc) cache = { doc, vocab: vocabulary(elementsOf(doc)) }
    return cache.vocab
  }

  const ghostFor = (state: EditorState): Ghost | null => {
    const ns = nameKey.getState(state)
    const { selection } = state
    if (!ns?.typing || !selection.empty) return null
    const vim = vimKey.getState(state)
    if (vim?.enabled && vim.mode !== 'insert') return null
    const { $head } = selection
    if ($head.depth !== 1 || !NAME_COMPLETION_TYPES.includes($head.parent.attrs.type)) return null
    const text = $head.parent.textContent
    const before = text.slice(0, $head.parentOffset)
    if (ns.dismissed === `${$head.pos}:${before}`) return null
    const name = suggestName(before, text.charAt($head.parentOffset), vocabFor(state.doc))
    if (!name) return null
    const typed = /[\p{L}][\p{L}'-]*$/u.exec(before)![0]
    return { from: $head.pos - typed.length, to: $head.pos, name }
  }

  const ghostWidget = (rest: string) => () => {
    const dom = document.createElement('span')
    dom.className = 'name-ghost'
    dom.contentEditable = 'false'
    dom.setAttribute('aria-hidden', 'true')
    dom.textContent = rest
    return dom
  }

  return new Plugin<NameState>({
    key: nameKey,
    state: {
      init: () => ({ typing: false, dismissed: null }),
      apply(tr, value) {
        const dismissed = tr.getMeta(nameKey) as string | undefined
        if (dismissed !== undefined) return { ...value, dismissed }
        // Esc means "not now": any further typing offers names again.
        if (tr.docChanged) return { typing: true, dismissed: null }
        return tr.selectionSet ? { typing: false, dismissed: null } : value
      },
    },
    props: {
      decorations(state) {
        const ghost = ghostFor(state)
        if (!ghost) return null
        const typedLength = ghost.to - ghost.from
        const rest = ghost.name.slice(typedLength)
        return DecorationSet.create(state.doc, [Decoration.widget(ghost.to, ghostWidget(rest), { side: 1, key: `ghost-${rest}` })])
      },
      handleKeyDown(view, e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
        const ghost = ghostFor(view.state)
        if (!ghost) return false
        if (e.key === 'Tab') {
          // Replace the typed part too, so its case matches the name ("De" stays "De…", "MA" → "MAYA").
          view.dispatch(view.state.tr.insertText(ghost.name, ghost.from, ghost.to).scrollIntoView())
          return true
        }
        if (e.key === 'Escape') {
          const { $head } = view.state.selection
          view.dispatch(view.state.tr.setMeta(nameKey, `${$head.pos}:${$head.parent.textContent.slice(0, $head.parentOffset)}`))
          e.stopPropagation() // only hide the suggestion, not e.g. focus mode
          return true
        }
        return false
      },
    },
  })
}
