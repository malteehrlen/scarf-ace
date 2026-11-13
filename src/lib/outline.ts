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

  elements.forEach((el, index) => {
    if (el.type === 'scene') {
      if (scene) scene.end = index
      scene = {
        index,
        number: scenes.filter((s) => s.index >= 0).length + 1,
        heading: displayText(el),
        children: [],
        characters: [],
        end: elements.length,
      }
      scenes.push(scene)
      cue = null
      return
    }
    if (!el.text.trim() && index !== keep) return
    if (!scene) {
      scene = { index: -1, number: 0, heading: '', children: [], characters: [], end: elements.length }
      scenes.push(scene)
    }

    const node: OutlineNode = { index, type: el.type, text: displayText(el), children: [] }
    if ((el.type === 'dialogue' || el.type === 'parenthetical') && cue) {
      cue.children.push(node)
      return
    }
    scene.children.push(node)
    cue = el.type === 'character' ? node : null
    if (el.type === 'character') {
      const name = characterName(el.text)
      if (name && !scene.characters.includes(name)) scene.characters.push(name)
    }
  })
  return scenes
}
