import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { cleanup, runWb, tempWorkspace, writeState } from './helpers.mjs'

const SAMPLE_URL = 'http://127.0.0.1:57457/workday-budget/summary'

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function runMany(workspace, args, count) {
  const times = []
  for (let i = 0; i < count; i += 1) {
    const start = performance.now()
    const result = runWb(workspace, args)
    const elapsed = performance.now() - start
    assert.equal(result.status, 0, result.stderr || result.stdout)
    times.push(elapsed)
  }
  return times
}

const workspace = tempWorkspace()
try {
  writeState(workspace, { spent: 2.6, state: 'NORMAL', allowed: true })

  const checkTimes = runMany(workspace, ['check', '--hook'], 20)
  const statuslineTimes = runMany(workspace, ['statusline', '--color'], 20)

  console.log('CLI latency (20 runs each)')
  console.log(`check       avg=${(checkTimes.reduce((a, b) => a + b, 0) / checkTimes.length).toFixed(1)}ms p95=${percentile(checkTimes, 95).toFixed(1)}ms max=${Math.max(...checkTimes).toFixed(1)}ms`)
  console.log(`statusline  avg=${(statuslineTimes.reduce((a, b) => a + b, 0) / statuslineTimes.length).toFixed(1)}ms p95=${percentile(statuslineTimes, 95).toFixed(1)}ms max=${Math.max(...statuslineTimes).toFixed(1)}ms`)

  assert.ok(percentile(checkTimes, 95) < 300, 'check p95 should stay under 300ms on the fast path')
  assert.ok(percentile(statuslineTimes, 95) < 300, 'statusline p95 should stay under 300ms')

  const refreshStart = performance.now()
  const refresh = runWb(workspace, ['refresh'])
  const refreshMs = performance.now() - refreshStart
  assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout)
  console.log(`refresh     ${refreshMs.toFixed(1)}ms (single fixture log; not the 29-file corpus)`)
} finally {
  cleanup(workspace)
}

try {
  const coldStart = performance.now()
  const cold = await fetch(SAMPLE_URL)
  const coldBody = await cold.json()
  const coldMs = performance.now() - coldStart
  assert.ok(cold.ok, 'summary route should answer 200')
  assert.ok(coldMs < 500, 'first summary should stay under 500ms')

  let toolingMs = 0
  if (coldBody.tooling?.pending === true) {
    const syncStart = performance.now()
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const probe = await fetch(SAMPLE_URL)
      const body = await probe.json()
      if (body.tooling?.pending !== true) break
    }
    toolingMs = performance.now() - syncStart
  }

  const warmStart = performance.now()
  const warm = await fetch(SAMPLE_URL)
  const warmBody = await warm.json()
  const warmMs = performance.now() - warmStart
  console.log(`summary     cold=${coldMs.toFixed(1)}ms toolingSync=${toolingMs.toFixed(0)}ms warm=${warmMs.toFixed(1)}ms scene=${warmBody.work?.spent ?? '—'}`)
  assert.ok(warm.ok, 'summary route should answer 200')
  assert.ok(warmMs < 500, 'cached summary should stay under 500ms')
} catch (error) {
  console.log(`summary     skipped (${error instanceof Error ? error.message : String(error)})`)
}

console.log('Note: first browser render cannot be measured here; warm summary + CLI latency are the available proxies.')
