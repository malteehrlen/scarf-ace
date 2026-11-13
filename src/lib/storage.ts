import { emptyBackup } from './backup'
import { emptyTitlePage, newScript, type Script } from './screenplay'

export const INDEX_KEY = 'scarfAce:index'
const LAST_KEY = 'scarfAce:last'
export const scriptKey = (id: string) => `scarfAce:script:${id}`

export interface ScriptSummary {
  id: string
  title: string
  updatedAt: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function listScripts(): ScriptSummary[] {
  return readJson<ScriptSummary[]>(INDEX_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadScript(id: string): Script | null {
  const script = readJson<Script | null>(scriptKey(id), null)
  if (!script) return null
  return {
    ...script,
    titlePage: { ...emptyTitlePage(), ...script.titlePage },
    backup: script.backup ?? emptyBackup(),
    pdf: { sceneNumbers: script.pdf?.sceneNumbers ?? false },
  }
}

/** Throws if storage is full or unavailable so the caller can surface it. Returns what was stored. */
export function saveScript(script: Script): string {
  script.updatedAt = Date.now()
  const json = JSON.stringify(script)
  localStorage.setItem(scriptKey(script.id), json)
  const index = listScripts().filter((s) => s.id !== script.id)
  index.push({ id: script.id, title: script.titlePage.title || 'Untitled', updatedAt: script.updatedAt })
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  localStorage.setItem(LAST_KEY, script.id)
  return json
}

export function deleteScript(id: string) {
  localStorage.removeItem(scriptKey(id))
  localStorage.setItem(INDEX_KEY, JSON.stringify(listScripts().filter((s) => s.id !== id)))
  if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY)
}

export function lastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function sampleScript(): Script {
  return newScript(
    [
      { type: 'scene', text: 'INT. LAUNDROMAT - NIGHT' },
      { type: 'action', text: 'Fluorescent tubes buzz over rows of empty machines. MAYA (30s), still in a waitress uniform, feeds quarters into a dryer one at a time.' },
      { type: 'action', text: 'The door chimes. THEO (60s) shuffles in carrying a single wool scarf.' },
      { type: 'character', text: 'Theo' },
      { type: 'parenthetical', text: 'holding it up' },
      { type: 'dialogue', text: 'You think this needs a full cycle?' },
      { type: 'character', text: 'Maya' },
      { type: 'dialogue', text: "I think it needs a better owner. That thing's older than me." },
      { type: 'transition', text: 'Cut to:' },
      { type: 'scene', text: 'EXT. PARKING LOT - CONTINUOUS' },
      { type: 'action', text: 'Press Enter, Tab and Ctrl+Alt+1..7 to explore the element types.' },
    ],
    { title: 'The Scarf', author: 'Your Name' },
  )
}
