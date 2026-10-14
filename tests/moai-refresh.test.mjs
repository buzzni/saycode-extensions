import assert from 'node:assert/strict'
import { test } from 'node:test'

import { panelModule } from './moai-panel-modules.mjs'

const { DEFAULT_INTERVAL_MS, createRefresher, refreshTime } = await panelModule('data/refresh.ts')

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)) }

/** A clock the test moves by hand; `advance` fires every timer that falls due. */
function fakeClock() {
  let now = 1_000_000
  let timers = []
  let id = 0
  return {
    now: () => now,
    setTimeout(callback, ms) { timers.push({ id: ++id, at: now + ms, callback }); return id },
    clearTimeout(handle) { timers = timers.filter((timer) => timer.id !== handle) },
    pending: () => timers.length,
    async advance(ms) {
      now += ms
      for (const timer of timers.filter((timer) => timer.at <= now)) {
        timers = timers.filter((other) => other !== timer)
        timer.callback()
      }
      await flush()
    },
  }
}

test('while visible it reads again every 60 seconds', async () => {
  const clock = fakeClock()
  let loads = 0
  const refresher = createRefresher({ load: async () => { loads += 1 }, clock })
  await refresher.refresh()
  assert.equal(loads, 1)
  assert.equal(refresher.lastLoaded, clock.now())
  await clock.advance(DEFAULT_INTERVAL_MS - 1)
  assert.equal(loads, 1)
  await clock.advance(1)
  assert.equal(loads, 2)
  await clock.advance(DEFAULT_INTERVAL_MS)
  assert.equal(loads, 3)
  refresher.stop()
  await clock.advance(DEFAULT_INTERVAL_MS * 3)
  assert.equal(loads, 3)
})

test('a hidden panel does not poll, and one shown after the interval reads at once', async () => {
  const clock = fakeClock()
  let visible = true
  let loads = 0
  const refresher = createRefresher({ load: async () => { loads += 1 }, clock, isVisible: () => visible })
  await refresher.refresh()
  visible = false
  refresher.visibilityChanged()
  assert.equal(clock.pending(), 0)
  await clock.advance(DEFAULT_INTERVAL_MS * 2)
  assert.equal(loads, 1)
  visible = true
  refresher.visibilityChanged()
  await flush()
  assert.equal(loads, 2)
})

test('shown again before the interval passed, it waits for the rest of it', async () => {
  const clock = fakeClock()
  let visible = true
  let loads = 0
  const refresher = createRefresher({ load: async () => { loads += 1 }, clock, isVisible: () => visible })
  await refresher.refresh()
  visible = false
  refresher.visibilityChanged()
  await clock.advance(20_000)
  visible = true
  refresher.visibilityChanged()
  await clock.advance(39_999)
  assert.equal(loads, 1)
  await clock.advance(1)
  assert.equal(loads, 2)
})

test('a manual refresh while one runs waits for it instead of reading twice, and restarts the interval', async () => {
  const clock = fakeClock()
  let loads = 0
  let release
  const refresher = createRefresher({ load: () => { loads += 1; return new Promise((resolve) => (release = resolve)) }, clock })
  const first = refresher.refresh()
  const second = refresher.refresh()
  assert.equal(first, second)
  assert.equal(loads, 1)
  release()
  await first
  await clock.advance(30_000)
  const manual = refresher.refresh()
  release()
  await manual
  assert.equal(loads, 2)
  await clock.advance(DEFAULT_INTERVAL_MS - 1)
  assert.equal(loads, 2)
  await clock.advance(1)
  assert.equal(loads, 3)
})

test('a failed read still counts as a read for the schedule', async () => {
  const clock = fakeClock()
  let loads = 0
  const refresher = createRefresher({ load: async () => { loads += 1; throw new Error('declined') }, clock })
  await assert.rejects(refresher.refresh())
  await clock.advance(DEFAULT_INTERVAL_MS)
  assert.equal(loads, 2)
  refresher.stop()
})

test('the interval can be changed, and 0 turns automatic reads off', async () => {
  const clock = fakeClock()
  let loads = 0
  const refresher = createRefresher({ load: async () => { loads += 1 }, clock })
  await refresher.refresh()
  refresher.setInterval(10_000)
  await clock.advance(10_000)
  assert.equal(loads, 2)
  refresher.setInterval(0)
  await clock.advance(DEFAULT_INTERVAL_MS * 5)
  assert.equal(loads, 2)
})

test('the refresh time reads HH:MM:SS', () => {
  const at = new Date(2026, 9, 14, 9, 5, 7).getTime()
  assert.equal(refreshTime(at, 'en-GB'), '09:05:07')
})
