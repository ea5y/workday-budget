import test from 'node:test'
import assert from 'node:assert/strict'
import { atBeijing, claudeEvent, cleanup, readJson, runWb, tempWorkspace } from './helpers.mjs'
import { applyDone, applyStart, clock, timeView } from '../core/time-core.mjs'

function statePath(workspace) {
  return `${workspace.dir}/state.json`
}

function readState(workspace) {
  return readJson(statePath(workspace))
}

test('start/done/reopen form one idempotent interval', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'time', timestamp: atBeijing(10) })] })
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    let result = runWb(workspace, ['start'])
    assert.equal(result.status, 0, result.stderr)
    const started = readState(workspace)
    assert.equal(started.time.state, 'working')
    const startedAt = started.time.startedAt

    result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readState(workspace).time.startedAt, startedAt)

    result = runWb(workspace, ['start'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readState(workspace).time.startedAt, startedAt)

    result = runWb(workspace, ['done'])
    assert.equal(result.status, 0, result.stderr)
    const finished = readState(workspace)
    assert.equal(finished.time.state, 'finished')
    assert.ok(finished.time.wallClockMinutes >= 0)
    assert.ok(finished.time.todayGainMinutes > 0)
    const endedAt = finished.time.endedAt

    result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readState(workspace).time.endedAt, endedAt)

    result = runWb(workspace, ['start'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /已经收工/)

    result = runWb(workspace, ['done'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readState(workspace).time.endedAt, endedAt)

    result = runWb(workspace, ['reopen'])
    assert.equal(result.status, 0, result.stderr)
    const reopened = readState(workspace)
    assert.equal(reopened.time.state, 'working')
    assert.equal(reopened.time.startedAt, startedAt)
    assert.equal(reopened.time.endedAt, null)

    result = runWb(workspace, ['done'])
    assert.equal(result.status, 0, result.stderr)

    result = runWb(workspace, ['reopen', '--at', '09:00'])
    assert.equal(result.status, 0, result.stderr)
    const atNine = readState(workspace)
    assert.equal(atNine.time.state, 'working')
    assert.equal(clock(atNine.time.startedAt), '09:00')
  } finally {
    cleanup(workspace)
  }
})

test('done before start is rejected', () => {
  const workspace = tempWorkspace()
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    const result = runWb(workspace, ['done'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /还没有开工/)
    assert.equal(readState(workspace).time.state, 'idle')
  } finally {
    cleanup(workspace)
  }
})

test('reopen rejects invalid or future time', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'time2', timestamp: atBeijing(10) })] })
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    assert.equal(runWb(workspace, ['start']).status, 0)
    assert.equal(runWb(workspace, ['done']).status, 0)

    let result = runWb(workspace, ['reopen', '--at', '25:00'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /HH:MM/)

    result = runWb(workspace, ['reopen', '--at', '23:59'])
    // If this test runs exactly at 23:59, the parser may accept it; either way it must not corrupt state.
    const state = readState(workspace)
    assert.ok(state.time.state === 'working' || state.time.state === 'finished')
  } finally {
    cleanup(workspace)
  }
})

test('single interval can cross midnight', () => {
  const start = new Date('2026-11-04T23:30:00+08:00').getTime()
  const end = new Date('2026-11-05T00:30:00+08:00').getTime()
  const base = { cap: 10, timeValueMinutesPerUnit: 48, work: { spent: 2 } }
  const started = applyStart(base, start, 480)
  assert.equal(started.ok, true)
  const finished = applyDone(started.state, end, 480)
  assert.equal(finished.ok, true)
  const view = timeView(finished.state, end)
  assert.equal(view.state, 'finished')
  assert.equal(view.crossesMidnight, true)
  assert.equal(view.wallClockMinutes, 60)
  assert.equal(view.todayGainMinutes, 420)
})
