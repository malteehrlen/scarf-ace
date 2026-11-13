import { describe, expect, it } from 'vitest'
import {
  IDLE_GAP_MS,
  MINUTE,
  REMIND_AFTER_MS,
  SNOOZE_MS,
  emptyBackup,
  markBackedUp,
  recordActivity,
  reminderReason,
  snoozeAt,
} from '../src/lib/backup'

describe('recordActivity', () => {
  it('accumulates time between close edits', () => {
    const s = recordActivity(emptyBackup(), 1000, 1000 + 30_000)
    expect(s.activeMs).toBe(30_000)
  })
  it('ignores idle gaps and the first edit of a session', () => {
    expect(recordActivity(emptyBackup(), 0, IDLE_GAP_MS + 1).activeMs).toBe(0)
    expect(recordActivity(emptyBackup(), null, 5000).activeMs).toBe(0)
  })
})

describe('reminderReason', () => {
  const backedUp = markBackedUp(3, 1)

  it('stays quiet right after a backup', () => {
    expect(reminderReason(backedUp, 3)).toBeNull()
  })
  it('reminds after a new page', () => {
    expect(reminderReason(backedUp, 4)).toEqual({ kind: 'pages', pages: 1 })
  })
  it('reminds after enough active writing time', () => {
    expect(reminderReason({ ...backedUp, activeMs: REMIND_AFTER_MS - 1 }, 3)).toBeNull()
    expect(reminderReason({ ...backedUp, activeMs: REMIND_AFTER_MS }, 3)).toEqual({ kind: 'time', minutes: 30 })
  })
  it('says "never" for a script that was never backed up', () => {
    expect(reminderReason(emptyBackup(1), 1)).toBeNull()
    expect(reminderReason(emptyBackup(1), 2)).toEqual({ kind: 'never' })
    // Pre-existing multi-page scripts with no backup get reminded straight away.
    expect(reminderReason(emptyBackup(), 5)).toEqual({ kind: 'never' })
  })
  it('snoozes until another page or more writing time', () => {
    const state = { ...backedUp, activeMs: 40 * MINUTE }
    const snooze = snoozeAt(state, 4)
    expect(reminderReason(state, 4, snooze)).toBeNull()
    expect(reminderReason(state, 5, snooze)).toEqual({ kind: 'pages', pages: 2 })
    expect(reminderReason({ ...state, activeMs: 40 * MINUTE + SNOOZE_MS }, 4, snooze)).toEqual({ kind: 'time', minutes: 55 })
  })
})
