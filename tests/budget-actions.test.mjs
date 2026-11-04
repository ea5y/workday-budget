import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { atBeijing, claudeEvent, cleanup, readJson, runWb, tempWorkspace, writeState } from './helpers.mjs'

function stateOf(workspace) {
  return readJson(`${workspace.dir}/state.json`)
}

function spentWorkspace(spent = 10.2) {
  return tempWorkspace({
    lines: [claudeEvent({ timestamp: atBeijing(20), input: spent * 1_000_000 })],
    config: { cap: 10, calibration: 1 },
  })
}

test('wrapup raises the limit by ¥0.50 and toggles off', () => {
  const workspace = tempWorkspace()
  try {
    writeState(workspace, { spent: 10.2, state: 'LOCKED', allowed: false })
    let result = runWb(workspace, ['wrapup'])
    assert.equal(result.status, 0, result.stderr)
    let state = stateOf(workspace)
    assert.equal(state.wrapup.active, true)
    assert.equal(state.limit, 10.5)
    assert.equal(state.allowed, true)

    result = runWb(workspace, ['wrapup'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(stateOf(workspace).wrapup.active, true)

    result = runWb(workspace, ['wrapup', '--off'])
    assert.equal(result.status, 0, result.stderr)
    state = stateOf(workspace)
    assert.equal(state.wrapup.active, false)
    assert.equal(state.allowed, false)
  } finally {
    cleanup(workspace)
  }
})

test('tier2 opens at ¥20, counts once and closes', () => {
  const workspace = tempWorkspace()
  try {
    writeState(workspace, { spent: 10.2, state: 'LOCKED', allowed: false })
    let result = runWb(workspace, ['tier2', '--on', '客户临时加需求'])
    assert.equal(result.status, 0, result.stderr)
    let state = stateOf(workspace)
    assert.equal(state.tier2.enabled, true)
    assert.equal(state.tier2.cap, 20)
    assert.equal(state.tier2.count, 1)
    assert.equal(state.work.state, 'TIER2')
    assert.equal(state.allowed, true)

    result = runWb(workspace, ['tier2', '--on', '重复点击'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(stateOf(workspace).tier2.count, 1)

    result = runWb(workspace, ['tier2', '--off'])
    assert.equal(result.status, 0, result.stderr)
    state = stateOf(workspace)
    assert.equal(state.tier2.enabled, false)
    assert.equal(state.limit, 10)
    assert.equal(state.allowed, false)
  } finally {
    cleanup(workspace)
  }
})

test('tier2 requires a reason and respects the monthly quota', () => {
  const workspace = tempWorkspace()
  try {
    writeState(workspace, { spent: 10.2, state: 'LOCKED', allowed: false })
    let result = runWb(workspace, ['tier2', '--on'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /理由/)

    const state = stateOf(workspace)
    state.tier2 = { enabled: false, cap: 20, reason: '', month: state.date.slice(0, 7), count: 4 }
    fs.writeFileSync(`${workspace.dir}/state.json`, JSON.stringify(state, null, 2), 'utf8')
    result = runWb(workspace, ['tier2', '--on', '第五次'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /4 次/)
  } finally {
    cleanup(workspace)
  }
})

test('tier2 + wrapup keeps +0.50 across refresh (tier2 first)', () => {
  const workspace = spentWorkspace(10.2)
  try {
    let result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    result = runWb(workspace, ['tier2', '--on', '客户临时加需求'])
    assert.equal(result.status, 0, result.stderr)
    result = runWb(workspace, ['wrapup'])
    assert.equal(result.status, 0, result.stderr)

    let state = stateOf(workspace)
    assert.equal(state.limit, 20.5)
    assert.equal(state.allowed, true)
    assert.equal(state.wrapup.active, true)
    assert.equal(state.work.remaining, 10.3)

    result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    state = stateOf(workspace)
    assert.equal(state.limit, 20.5)
    assert.equal(state.allowed, true)
    assert.equal(state.wrapup.active, true)
    assert.equal(state.work.remaining, 10.3)
  } finally {
    cleanup(workspace)
  }
})

test('wrapup + tier2 keeps +0.50 across refresh (wrapup first)', () => {
  const workspace = spentWorkspace(10.2)
  try {
    let result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    result = runWb(workspace, ['wrapup'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(stateOf(workspace).limit, 10.5)

    result = runWb(workspace, ['tier2', '--on', '客户临时加需求'])
    assert.equal(result.status, 0, result.stderr)
    let state = stateOf(workspace)
    assert.equal(state.limit, 20.5)
    assert.equal(state.allowed, true)
    assert.equal(state.work.remaining, 10.3)

    result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    state = stateOf(workspace)
    assert.equal(state.limit, 20.5)
    assert.equal(state.allowed, true)
    assert.equal(state.work.remaining, 10.3)
  } finally {
    cleanup(workspace)
  }
})

test('remaining, status and check use the effective limit', () => {
  const workspace = spentWorkspace(10.2)
  try {
    let result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    result = runWb(workspace, ['wrapup'])
    assert.equal(result.status, 0, result.stderr)

    const state = stateOf(workspace)
    assert.equal(state.limit, 10.5)
    assert.equal(state.allowed, true)
    assert.equal(state.work.remaining, 0.3)
    assert.equal(state.work.effectivePct, 97.14)

    const status = runWb(workspace, ['status'])
    assert.equal(status.status, 0, status.stderr)
    assert.match(status.stdout, /工作花费  ¥10\.20 \/ 10\.50/)
    assert.match(status.stdout, /剩余      ¥0\.30/)

    const check = runWb(workspace, ['check', '--hook'])
    assert.equal(check.status, 0, check.stderr)
  } finally {
    cleanup(workspace)
  }
})
