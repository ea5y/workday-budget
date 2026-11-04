import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, readJson, runWb, tempWorkspace, writeState } from './helpers.mjs'

function withAge(workspace, ageMs) {
  const file = path.join(workspace.dir, 'state.json')
  const state = readJson(file)
  state.updatedAt = Date.now() - ageMs
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  return file
}

test('fresh-but-older-than-20s state is reused for five minutes', () => {
  const workspace = tempWorkspace()
  try {
    writeState(workspace, { spent: 10.2, state: 'LOCKED', allowed: false })
    withAge(workspace, 4 * 60_000)
    fs.writeFileSync(path.join(workspace.dir, 'usage-log.jsonl.lock'), String(process.pid), 'utf8')

    const result = runWb(workspace, ['check', '--hook'])
    assert.equal(result.status, 2, result.stderr)
    assert.doesNotMatch(result.stderr, /STALE/)
  } finally {
    cleanup(workspace)
  }
})

test('hook fails open with a single STALE line; normal CLI reports one line', () => {
  const workspace = tempWorkspace()
  try {
    writeState(workspace, { spent: 10.2, state: 'LOCKED', allowed: false })
    withAge(workspace, 6 * 60_000)
    fs.writeFileSync(path.join(workspace.dir, 'usage-log.jsonl.lock'), String(process.pid), 'utf8')

    const hook = runWb(workspace, ['check', '--hook'])
    assert.equal(hook.status, 0, hook.stderr)
    assert.match(hook.stderr, /STALE/)
    assert.match(hook.stderr, /放行/)
    assert.doesNotMatch(hook.stderr, /\n\s+at /)

    const status = runWb(workspace, ['status'])
    assert.equal(status.status, 1, status.stderr)
    assert.match(status.stderr, /wb: state busy/)
    assert.doesNotMatch(status.stderr, /\n\s+at /)
  } finally {
    cleanup(workspace)
  }
})
