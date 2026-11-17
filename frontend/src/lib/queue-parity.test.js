// The app (lib/queue.js) and the server's reminders (api/queue.js) each keep a copy of the queue's
// rules, and nothing else compares them: a drift shows up as a nudge for a session the app shows
// as done. Random profiles go through both; a failure names the seed that rebuilds the profile.
import { describe, expect, it } from 'vitest'
import { queueLiveOn, pinState } from './queue.js'
import { effectiveRoutineIds } from './history.js'
import { isoOf } from './format.js'
import * as srv from '../../../api/queue.js'

const day = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }

function rng (seed) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}

const START = '2026-11-02'
// The server dates a queue without startsOn in the reminder's zone, the app in the device's: the
// same zone here, so the two name the same day (api/queue.js dayIn).
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function profile (seed) {
  const r = rng(seed)
  const pick = a => a[Math.floor(r() * a.length)]
  const routines = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id === 'd' ? 'A + B' : id.toUpperCase() }))
  // 'gone' is a deleted routine; a repeated id is one session.
  const ids = ['a', 'b', 'c', 'd', 'a', 'gone'].filter(() => r() < 0.6)
  if (!ids.length) ids.push('a')
  const startsOn = day(START, Math.floor(r() * 3))
  const since = new Date(startsOn + 'T09:00:00').getTime() - Math.floor(r() * 3) * 86400000
  const queue = { ids, since, ...(r() < 0.8 ? { startsOn } : {}), ...(r() < 0.3 ? { strict: true } : {}) }
  const workouts = Array.from({ length: Math.floor(r() * 6) }, () => {
    const d = day(START, Math.floor(r() * 9) - 2)
    const rids = ['a', 'b', 'c', 'd'].filter(() => r() < 0.4)
    const names = rids.map(id => routines.find(x => x.id === id).name)
    const w = { d, start: new Date(d + 'T' + pick(['07', '12', '20']) + ':00:00').getTime(), name: r() < 0.8 ? names.join(' + ') : pick(['A', 'B', 'Other']) }
    if (rids.length === 1 && r() < 0.5) w.routineId = rids[0]
    else w.routineIds = rids
    return w
  })
  // Pins on queue sessions, plus the plain overrides: a rest day and a routine outside the queue.
  const dayPlan = {}
  for (let i = 0; i < 2; i++) if (r() < 0.5) dayPlan[day(START, Math.floor(r() * 7))] = pick([...ids, 'rest', 'c'])
  // A weekday plan beside the queue: its routines ride along on the queue's day and fill the rest.
  const week = {}
  for (let wd = 0; wd < 7; wd++) if (r() < 0.4) week[wd] = r() < 0.3 ? ['c', 'b'] : [pick(['a', 'b', 'c', 'gone'])]
  return { routines, queue, workouts, dayPlan, week, reminder: { tz: ZONE } }
}

describe('queue parity: app and server reminders', () => {
  it('agree on done, live and next for every day of random profiles', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const S = profile(seed)
      for (let n = -1; n <= 8; n++) {
        const d = day(START, n)
        const at = `seed ${seed}, ${d}`
        expect(srv.queueLiveOn(S, d), at).toBe(queueLiveOn(S, d, d))
        // The reminder's routine is the first of the app's day.
        expect(srv.effectiveRoutineId(S, d), at).toBe(effectiveRoutineIds(S, d, d)[0] ?? null)
        for (const id of ['a', 'b', 'c', 'd', 'gone']) expect(srv.pinState(S, id, d), `${at}, ${id}`).toBe(pinState(S, id, d))
      }
    }
  })
})
