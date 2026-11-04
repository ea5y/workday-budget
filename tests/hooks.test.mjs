import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, readJson, runWb, tempWorkspace, writeState } from './helpers.mjs'

const SETTINGS = {
  env: { KEEP_ME: 'yes' },
  theme: 'dark',
  statusLine: { type: 'command', command: 'ccstatusline-zh' },
}

const CCSTATUSLINE = {
  version: 4,
  lines: [
    [
      { id: '1', type: 'model', color: 'cyan' },
      { id: '2', type: 'separator' },
      { id: '3', type: 'git-branch', color: 'magenta' },
    ],
  ],
  flexMode: 'full',
}

test('hooks install/uninstall preserves existing settings and is idempotent', () => {
  const workspace = tempWorkspace({ settings: SETTINGS, ccstatusline: CCSTATUSLINE })
  try {
    let result = runWb(workspace, ['hooks', 'install'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    result = runWb(workspace, ['hooks', 'install'])
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const settings = readJson(workspace.settingsPath)
    assert.deepEqual(settings.env, SETTINGS.env)
    assert.deepEqual(settings.statusLine, SETTINGS.statusLine)
    assert.equal(settings.theme, 'dark')
    assert.equal(settings.hooks.UserPromptSubmit.length, 1)
    assert.equal(settings.hooks.PreToolUse.length, 1)
    const hookCommand = settings.hooks.UserPromptSubmit[0].hooks[0].command
    assert.match(hookCommand, /wb-launcher/)
    assert.doesNotMatch(hookCommand, /node\.exe/i)
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /check --hook/)
    const launcher = path.join(workspace.dir, 'bin', process.platform === 'win32' ? 'wb-launcher.cmd' : 'wb-launcher.sh')
    assert.ok(fs.existsSync(launcher), 'stable launcher should exist')

    const status = JSON.parse(runWb(workspace, ['hooks', 'status']).stdout)
    assert.equal(status.prompt, true)
    assert.equal(status.tools, true)

    result = runWb(workspace, ['hooks', 'uninstall'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const after = readJson(workspace.settingsPath)
    assert.equal(after.hooks, undefined)
    assert.deepEqual(after.env, SETTINGS.env)
    assert.deepEqual(after.statusLine, SETTINGS.statusLine)
  } finally {
    cleanup(workspace)
  }
})

test('statusline install/uninstall adds and removes only the work widget', () => {
  const workspace = tempWorkspace({ settings: SETTINGS, ccstatusline: CCSTATUSLINE })
  try {
    let result = runWb(workspace, ['statusline', 'install'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    result = runWb(workspace, ['statusline', 'install'])
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const config = readJson(workspace.ccPath)
    const widgets = config.lines.flat()
    assert.equal(widgets.filter((widget) => widget.type === 'custom-command').length, 1)
    const work = widgets.find((widget) => widget.type === 'custom-command')
    assert.match(work.commandPath, /statusline --color/)
    assert.match(work.commandPath, /wb-launcher/)
    assert.doesNotMatch(work.commandPath, /node\.exe/i)
    assert.equal(work.preserveColors, true)
    assert.ok(widgets.some((widget) => widget.type === 'model'))
    assert.ok(widgets.some((widget) => widget.type === 'git-branch'))

    const merged = JSON.parse(runWb(workspace, ['statusline', 'status']).stdout)
    assert.equal(merged.merged, true)

    result = runWb(workspace, ['statusline', 'uninstall'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const after = readJson(workspace.ccPath)
    assert.equal(after.lines.flat().some((widget) => widget.type === 'custom-command'), false)
    assert.ok(after.lines.flat().some((widget) => widget.type === 'model'))
  } finally {
    cleanup(workspace)
  }
})

test('statusline colors follow 70/90 thresholds', () => {
  const workspace = tempWorkspace()
  try {
    writeState(workspace, { spent: 2.6, state: 'NORMAL', allowed: true })
    let result = runWb(workspace, ['statusline', '--color'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /\u001b\[1;32m/)
    assert.match(result.stdout, /work 2\.60\/10/)

    writeState(workspace, { spent: 7.8, state: 'WARN', allowed: true })
    result = runWb(workspace, ['statusline', '--color'])
    assert.match(result.stdout, /\u001b\[1;33m/)

    writeState(workspace, { spent: 10.02, state: 'LOCKED', allowed: false })
    result = runWb(workspace, ['statusline', '--color'])
    assert.match(result.stdout, /\u001b\[1;31m/)
  } finally {
    cleanup(workspace)
  }
})

test('doctor reports a missing launcher', () => {
  const workspace = tempWorkspace({ settings: SETTINGS })
  try {
    let result = runWb(workspace, ['hooks', 'install'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const launcher = path.join(workspace.dir, 'bin', process.platform === 'win32' ? 'wb-launcher.cmd' : 'wb-launcher.sh')
    fs.rmSync(launcher, { force: true })

    result = runWb(workspace, ['doctor'])
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stdout, /launcher\s+MISSING/)
  } finally {
    cleanup(workspace)
  }
})
