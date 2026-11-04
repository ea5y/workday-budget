import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const WB = path.resolve(HERE, '..', 'core', 'wb.mjs')
export const CORE = path.resolve(HERE, '..', 'core', 'wb-core.mjs')

export function todayKey() {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
}

export function atBeijing(hour, minute = 0, date = todayKey()) {
  const [year, month, day] = date.split('-').map(Number)
  const ms = Date.UTC(year, month - 1, day, hour, minute, 0) - 8 * 3_600_000
  const d = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
}

export function claudeEvent({ id = 'msg-1', timestamp = atBeijing(10), input = 1_000_000, output = 0, cache = 0, cwd = 'D:\\fake\\project' } = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    cwd,
    message: {
      id,
      model: 'deepseek-flash',
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cache,
        cache_creation_input_tokens: 0,
      },
    },
  })
}

export function tempWorkspace({ lines = [], config = {}, settings = {}, ccstatusline = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workday-budget-test-'))
  const projects = path.join(dir, 'projects')
  fs.mkdirSync(path.join(projects, 'D--fake-project'), { recursive: true })
  fs.writeFileSync(path.join(projects, 'D--fake-project', 'session.jsonl'), lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8')

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      {
        cap: 10,
        calibration: 1.14,
        timeValueMinutesPerUnit: 48,
        claudeDir: projects,
        ...config,
      },
      null,
      2,
    ),
    'utf8',
  )

  const settingsPath = path.join(dir, 'claude-settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')

  const ccPath = path.join(dir, 'ccstatusline.json')
  fs.writeFileSync(ccPath, JSON.stringify(ccstatusline, null, 2), 'utf8')

  const env = {
    ...process.env,
    WB_DATA_DIR: dir,
    WB_CLAUDE_SETTINGS: settingsPath,
    WB_CCSTATUSLINE: ccPath,
  }
  return { dir, projects, settingsPath, ccPath, env }
}

export function runWb(workspace, args, extraEnv = {}, input = null) {
  return spawnSync(process.execPath, [WB, ...args], {
    env: { ...workspace.env, ...extraEnv },
    encoding: 'utf8',
    input,
    timeout: 60_000,
  })
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function writeState(workspace, { spent = 2.6, state = 'NORMAL', allowed = true } = {}) {
  const file = path.join(workspace.dir, 'state.json')
  const value = {
    version: 1,
    date: todayKey(),
    updatedAt: Date.now(),
    cap: 10,
    calibration: 1.14,
    timeValueMinutesPerUnit: 48,
    limit: 10,
    allowed,
    work: {
      spent,
      raw: spent / 1.14,
      pct: (spent / 10) * 100,
      state,
      remaining: Math.max(0, 10 - spent),
      requests: 1,
      requestsTotal: 1,
      firstRequestAt: '10:00',
      lastRequestAt: '10:00',
      days: [],
      recent: [],
    },
    wrapup: { active: false, until: 0, cap: 0.5 },
    tier2: { enabled: false, cap: 20, reason: '', month: todayKey().slice(0, 7), count: 0 },
    scan: { files: 1, duplicates: 0 },
    statusline: `work ${spent.toFixed(2)}/10`,
  }
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  return file
}

export function cleanup(workspace) {
  fs.rmSync(workspace.dir, { recursive: true, force: true })
}
