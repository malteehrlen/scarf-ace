// When to nudge the writer to download a Fountain backup. localStorage is easy to lose
// (clearing site data, private windows, switching browsers), so we remind after real progress.

export interface BackupState {
  /** When the script was last exported to (or imported from) Fountain; null if never. */
  lastAt: number | null
  /** Page count at that moment. */
  pages: number
  /** Active writing time since then. */
  activeMs: number
}

export type ReminderReason = { kind: 'never' } | { kind: 'pages'; pages: number } | { kind: 'time'; minutes: number }

/** Baseline the reminder counts from; it never fires below this. */
export interface Snooze {
  pages: number
  activeMs: number
}

export const MINUTE = 60_000
export const REMIND_AFTER_MS = 30 * MINUTE
export const SNOOZE_MS = 15 * MINUTE
/** Edits further apart than this are separate sessions; the gap isn't counted as writing time. */
export const IDLE_GAP_MS = 2 * MINUTE

export function emptyBackup(pages = 1): BackupState {
  return { lastAt: null, pages, activeMs: 0 }
}

export function markBackedUp(pages: number, now = Date.now()): BackupState {
  return { lastAt: now, pages, activeMs: 0 }
}

/** Adds the time since the previous edit to the active writing time, unless the writer was idle. */
export function recordActivity(state: BackupState, previousEdit: number | null, now = Date.now()): BackupState {
  if (previousEdit == null) return state
  const gap = now - previousEdit
  if (gap <= 0 || gap > IDLE_GAP_MS) return state
  return { ...state, activeMs: state.activeMs + gap }
}

export function reminderReason(state: BackupState, pages: number, snooze: Snooze | null = null): ReminderReason | null {
  const basePages = Math.max(state.pages, snooze?.pages ?? 0)
  const baseActive = snooze ? snooze.activeMs + SNOOZE_MS : REMIND_AFTER_MS
  const newPages = pages - state.pages

  if (pages >= basePages + 1) return state.lastAt == null ? { kind: 'never' } : { kind: 'pages', pages: newPages }
  if (state.activeMs >= baseActive) {
    return state.lastAt == null ? { kind: 'never' } : { kind: 'time', minutes: Math.floor(state.activeMs / MINUTE) }
  }
  return null
}

export function snoozeAt(state: BackupState, pages: number): Snooze {
  return { pages, activeMs: state.activeMs }
}
