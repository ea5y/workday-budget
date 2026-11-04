import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { atBeijing, claudeEvent, cleanup, readJson, runWb, tempWorkspace } from './helpers.mjs'

function stateOf(workspace) {
  return readJson(`${workspace.dir}/state.json`)
}

function logPath(workspace) {
  return path.join(workspace.projects, 'D--fake-project', 'session.jsonl')
}

test('incremental refresh appends only new events', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'ledger-1', timestamp: atBeijing(10) })] })
  try {
    let result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    let state = stateOf(workspace)
    assert.equal(state.work.requests, 1)
    assert.equal(state.ledger.events, 1)
    assert.equal(state.scan.appended, 1)
    assert.ok(fs.existsSync(path.join(workspace.dir, 'usage-log.jsonl')))
    assert.ok(fs.existsSync(path.join(workspace.dir, 'usage-cache.json')))

    fs.appendFileSync(logPath(workspace), claudeEvent({ id: 'ledger-2', timestamp: atBeijing(11) }) + '\n', 'utf8')
    result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    state = stateOf(workspace)
    assert.equal(state.work.requests, 2)
    assert.equal(state.ledger.events, 2)
    assert.equal(state.scan.appended, 1)
    assert.equal(state.ledger.mode, 'incremental')

    result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    state = stateOf(workspace)
    assert.equal(state.work.requests, 2)
    assert.equal(state.scan.appended, 0)
  } finally {
    cleanup(workspace)
  }
})

test('truncated or replaced source files do not lose or double count ledger events', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'ledger-truncate-1', timestamp: atBeijing(10) })] })
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    assert.equal(stateOf(workspace).ledger.events, 1)
    fs.writeFileSync(logPath(workspace), claudeEvent({ id: 'ledger-truncate-2', timestamp: atBeijing(11) }) + '\n', 'utf8')
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    const state = stateOf(workspace)
    assert.equal(state.ledger.events, 2)
    assert.equal(state.work.requests, 2)
    assert.equal(state.scan.appended, 1)
  } finally {
    cleanup(workspace)
  }
})

test('rebuild restores state from the ledger', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'ledger-3', timestamp: atBeijing(10) })] })
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    const before = stateOf(workspace)
    fs.rmSync(path.join(workspace.dir, 'state.json'), { force: true })
    const result = runWb(workspace, ['rebuild'])
    assert.equal(result.status, 0, result.stderr)
    const after = stateOf(workspace)
    assert.equal(after.work.requests, before.work.requests)
    assert.equal(after.work.spent, before.work.spent)
    assert.equal(after.ledger.events, 1)
    assert.match(result.stdout, /ledger/)
  } finally {
    cleanup(workspace)
  }
})

test('rebuild --source recreates the ledger after it is deleted', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'ledger-4', timestamp: atBeijing(10) })] })
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    fs.rmSync(path.join(workspace.dir, 'usage-log.jsonl'), { force: true })
    fs.rmSync(path.join(workspace.dir, 'usage-cache.json'), { force: true })
    const result = runWb(workspace, ['rebuild', '--source'])
    assert.equal(result.status, 0, result.stderr)
    const state = stateOf(workspace)
    assert.equal(state.work.requests, 1)
    assert.equal(state.ledger.events, 1)
    assert.ok(fs.existsSync(path.join(workspace.dir, 'usage-log.jsonl')))
  } finally {
    cleanup(workspace)
  }
})

test('changing prices reprices ledger history without re-appending events', () => {
  const workspace = tempWorkspace({ lines: [claudeEvent({ id: 'ledger-5', timestamp: atBeijing(10) })] })
  try {
    assert.equal(runWb(workspace, ['refresh']).status, 0)
    const before = stateOf(workspace)
    const configPath = path.join(workspace.dir, 'config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config.pricing = {
      offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    }
    config.pricing.peak.cacheMiss = 4
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')

    const result = runWb(workspace, ['refresh'])
    assert.equal(result.status, 0, result.stderr)
    const after = stateOf(workspace)
    assert.equal(after.ledger.events, before.ledger.events)
    assert.equal(after.scan.appended, 0)
    assert.ok(after.work.spent > before.work.spent)
  } finally {
    cleanup(workspace)
  }
})
