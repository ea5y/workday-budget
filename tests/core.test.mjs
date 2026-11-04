import test from 'node:test'
import assert from 'node:assert/strict'
import { atBeijing, claudeEvent, cleanup, runWb, tempWorkspace } from './helpers.mjs'

function refresh(workspace) {
  const result = runWb(workspace, ['refresh', '--json'])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

test('peak pricing: 10:00 Beijing uses peak miss price and calibration', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'peak', timestamp: atBeijing(10) })] })
  try {
    const state = refresh(workspace)
    assert.equal(state.work.raw, 2)
    assert.equal(state.work.spent, 2.28)
    assert.equal(state.work.pct, 22.8)
    assert.equal(state.work.state, 'NORMAL')
    assert.equal(state.work.firstRequestAt, '10:00')
    assert.equal(state.work.requests, 1)
  } finally {
    cleanup(workspace)
  }
})

test('off-peak pricing: 20:00 Beijing uses off-peak miss price', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'offpeak', timestamp: atBeijing(20) })] })
  try {
    const state = refresh(workspace)
    assert.equal(state.work.raw, 1)
    assert.equal(state.work.spent, 1.14)
    assert.equal(state.work.state, 'NORMAL')
  } finally {
    cleanup(workspace)
  }
})

test('UTC timestamp is converted to Asia/Shanghai before day and peak checks', () => {
  // 00:30 Beijing == 16:30 UTC on the previous calendar day.
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'midnight', timestamp: atBeijing(0, 30) })] })
  try {
    const state = refresh(workspace)
    assert.equal(state.work.firstRequestAt, '00:30')
    assert.equal(state.work.raw, 1) // 00:30 is off-peak
  } finally {
    cleanup(workspace)
  }
})

test('duplicate message ids are counted once', () => {
  const line = claudeEvent({ id: 'duplicate', timestamp: atBeijing(10) })
  const workspace = tempWorkspace({ lines: [line, line] })
  try {
    const state = refresh(workspace)
    assert.equal(state.work.requests, 1)
    assert.equal(state.work.spent, 2.28)
    assert.equal(state.scan.duplicates, 1)
  } finally {
    cleanup(workspace)
  }
})

test('cache reads and output use their own price bands', () => {
  const workspace = tempWorkspace({
    lines: [claudeEvent({ id: 'cache', timestamp: atBeijing(10), input: 0, cache: 1_000_000, output: 1_000_000 })],
  })
  try {
    const state = refresh(workspace)
    // 1M cache hit at ¥0.04 + 1M output at ¥8 = ¥8.04; ×1.14
    assert.equal(state.work.raw, 8.04)
    assert.equal(state.work.spent, 9.1656)
  } finally {
    cleanup(workspace)
  }
})

test('70% threshold enters WARN', () => {
  const workspace = tempWorkspace({
    lines: [claudeEvent({ id: 'warn', timestamp: atBeijing(10), input: 1_754_386 })],
    config: { cap: 5 },
  })
  try {
    const state = refresh(workspace)
    assert.ok(state.work.pct >= 70 && state.work.pct < 90, `pct=${state.work.pct}`)
    assert.equal(state.work.state, 'WARN')
  } finally {
    cleanup(workspace)
  }
})

test('wb selftest passes its lock/unlock/color checks', () => {
  const workspace = tempWorkspace()
  try {
    const result = runWb(workspace, ['selftest'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /selftest PASS/)
    assert.equal((result.stdout.match(/^PASS/gm) || []).length, 5)
  } finally {
    cleanup(workspace)
  }
})
