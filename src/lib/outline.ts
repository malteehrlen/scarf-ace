import { plainText, stripNotes } from './markup'
import { displayText, type ElementType, type ScriptElement } from './screenplay'

export interface OutlineNode {
  /** Index of the element in the script. */
  index: number
  type: ElementType
  text: string
  children: OutlineNode[]
}

export interface OutlineScene {
  /** Index of the scene heading, or -1 for content before the first scene. */
  index: number
  number: number
  heading: string
  children: OutlineNode[]
  characters: string[]
  /** Exclusive index of the scene's last element. */
  end: number
  /** Section headings ("# Act One") that open just before this scene. */
  sections: { index: number; text: string; depth: number; synopsis: string }[]
  /** The scene's synopsis ("= …"), if it has one. */
  synopsis: string
}

/** Character cue without extensions like (V.O.) or (CONT'D). */
export function characterName(text: string): string {
  return text.replace(/\(.*?\)/g, '').trim().toUpperCase()
}

/**
 * Groups elements into scenes, nesting parentheticals and dialogue under their character cue.
 * Empty elements are left out unless the cursor is in one (`keep`).
 */
export function buildOutline(elements: ScriptElement[], keep = -1): OutlineScene[] {
  const scenes: OutlineScene[] = []
  let scene: OutlineScene | null = null
  let cue: OutlineNode | null = null
  let sections: OutlineScene['sections'] = []

  elements.forEach((el, index) => {
    if (el.type === 'section') {
      const m = /^(#*)\s*(.*)$/.exec(el.text.trim())!
      if (m[2]) sections.push({ index, text: m[2], depth: Math.max(1, m[1].length), synopsis: '' })
      return
    }
    // A synopsis describes the section or scene it follows.
    if (el.type === 'synopsis' && el.text.trim()) {
      const section = sections[sections.length - 1]
      if (section && !section.synopsis) section.synopsis = el.text.trim()
      else if (scene && scene.index >= 0 && !scene.synopsis) scene.synopsis = el.text.trim()
      else return
      return
    }
    if (el.type === 'scene') {
      if (scene) scene.end = index
      scene = {
        index,
        number: scenes.filter((s) => s.index >= 0).length + 1,
        heading: displayText(el),
        children: [],
        characters: [],
        end: elements.length,
        sections,
        synopsis: '',
      }
      sections = []
      scenes.push(scene)
      cue = null
      return
    }
    if (!el.text.trim() && index !== keep) return
    if (!scene) {
      scene = { index: -1, number: 0, heading: '', children: [], characters: [], end: elements.length, sections: [], synopsis: '' }
      scenes.push(scene)
    }

    // Non-printing lines (synopses, notes) still preview their text in the outline.
    const node: OutlineNode = { index, type: el.type, text: displayText(el) || plainText(stripNotes(el.text)).trim() || plainText(el.text).trim(), children: [] }
    if ((el.type === 'dialogue' || el.type === 'parenthetical') && cue) {
      cue.children.push(node)
      return
    }
    scene.children.push(node)
    cue = el.type === 'character' ? node : null
    if (el.type === 'character') {
      const name = characterName(displayText(el))
      if (name && !scene.characters.includes(name)) scene.characters.push(name)
    }
  })
  return scenes
}
