import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { appendWatchLog, watchStatus } from '../core/watch-core.mjs'
import { cleanup, runWb, tempWorkspace, WB } from './helpers.mjs'

test('watch starts once, rejects a duplicate, and stops cleanly', async () => {
  const workspace = tempWorkspace()
  let child = null
  try {
    child = spawn(process.execPath, [WB, 'watch'], { env: workspace.env, stdio: 'ignore', windowsHide: true })
    const started = Date.now()
    while (Date.now() - started < 8_000 && !fs.existsSync(path.join(workspace.dir, 'watch.json'))) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(fs.existsSync(path.join(workspace.dir, 'watch.json')), 'watch.json should be written')
    const status = watchStatus(workspace.dir, WB)
    assert.equal(status.running, true)

    const duplicate = runWb(workspace, ['watch'])
    assert.equal(duplicate.status, 2)
    assert.match(duplicate.stdout, /已在运行/)

    child.kill()
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const stopped = watchStatus(workspace.dir, WB)
    assert.equal(stopped.running, false)
  } finally {
    if (child !== null && !child.killed) {
      try { child.kill() } catch {}
    }
    cleanup(workspace)
  }
})

test('watch log rotates at the size threshold', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'wb-watch-log-'))
  try {
    const log = path.join(dir, 'logs', 'watch.log')
    fs.mkdirSync(path.dirname(log), { recursive: true })
    fs.writeFileSync(log, 'x'.repeat(1_100_000), 'utf8')
    appendWatchLog(dir, 'after rotation')
    assert.ok(fs.existsSync(`${log}.1`), 'old log should rotate to .1')
    assert.ok(fs.statSync(log).size < 1_100_000, 'new log should be small')
    assert.match(fs.readFileSync(log, 'utf8'), /after rotation/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
