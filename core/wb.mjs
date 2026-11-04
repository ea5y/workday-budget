#!/usr/bin/env node
/**
 * wb — Workday Budget local core.
 *
 * Reads the real Claude Code session corpus, prices it with the DeepSeek
 * peak/off-peak table, applies the calibration factor, and maintains
 * `%APPDATA%\workbuddy\state.json` for hooks, statusline, and the DSH dashboard.
 *
 * Commands:
 *   wb refresh
 *   wb status [--json]
 *   wb check [--hook]        exit 2 when the next model request must be blocked
 *   wb statusline
 *   wb wrapup [--off]
 *   wb tier2 --on "reason" | --off
 *   wb hooks install|uninstall|status
 *   wb watch
 *   wb doctor
 *
 * v0.1 is intentionally a full-scan implementation: correctness and the hard
 * stop first, incremental offsets and the append-only ledger next.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_STANDARD_WORKDAY_MINUTES,
  clock,
  mutateTimeState,
  parseAt,
  timeView,
  withStateLock,
} from './time-core.mjs'
import { effectiveLimit, mutateBudgetState } from './budget-actions.mjs'
import { scanUsage } from './usage-core.mjs'
import { rebuildFromLedger, rebuildFromSource, scanIncremental } from './usage-ledger.mjs'
import {
  acquireWatcher,
  appendWatchLog,
  autostartStatus,
  heartbeat,
  installAutostart,
  stopWatcher,
  uninstallAutostart,
  watchStatus,
} from './watch-core.mjs'

const TZ_OFFSET_MS = 8 * 3_600_000
const DATA_DIR = process.env.WB_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'workbuddy')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const STATE_PATH = path.join(DATA_DIR, 'state.json')
const TIME_LOG_PATH = path.join(DATA_DIR, 'time-log.jsonl')
const BUDGET_LOG_PATH = path.join(DATA_DIR, 'budget-log.jsonl')
const LEDGER_PATH = path.join(DATA_DIR, 'usage-log.jsonl')
const SCAN_CACHE_PATH = path.join(DATA_DIR, 'usage-cache.json')
const SETTINGS_PATH = process.env.WB_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json')
const CCSTATUSLINE_PATH = process.env.WB_CCSTATUSLINE || path.join(os.homedir(), '.config', 'ccstatusline', 'settings.json')
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const STATE_MAX_AGE_MS = 5 * 60_000
const LAUNCHER_PATH = path.join(DATA_DIR, 'bin', process.platform === 'win32' ? 'wb-launcher.cmd' : 'wb-launcher.sh')

const DEFAULT_CONFIG = {
  cap: 10,
  calibration: 1.14,
  timeValueMinutesPerUnit: 48,
  standardWorkdayMinutes: 480,
  wrapupCap: 0.5,
  wrapupMinutes: 30,
  tier2Cap: 20,
  claudeDir: path.join(os.homedir(), '.claude', 'projects'),
  peakWindows: [[9, 12], [14, 18]],
  holidays: [],
  pricing: {
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadConfig() {
  ensureDataDir()
  let raw = {}
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    raw = {}
  }
  const config = {
    ...DEFAULT_CONFIG,
    ...raw,
    pricing: {
      offPeak: { ...DEFAULT_CONFIG.pricing.offPeak, ...(raw.pricing?.offPeak || {}) },
      peak: { ...DEFAULT_CONFIG.pricing.peak, ...(raw.pricing?.peak || {}) },
    },
    peakWindows: Array.isArray(raw.peakWindows) ? raw.peakWindows : DEFAULT_CONFIG.peakWindows,
    holidays: Array.isArray(raw.holidays) ? raw.holidays : [],
  }
  if (!fs.existsSync(CONFIG_PATH)) writeJson(CONFIG_PATH, config)
  return config
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(target, value) {
  ensureDataDir()
  const temp = `${target}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(temp, target)
}

function todayKey() {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

function walkJsonl(root) {
  const files = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full)
    }
  }
  return files
}

function parseTimestamp(value) {
  const text = String(value).trim()
  if (text.length === 0) return null
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + TZ_OFFSET_MS)
  }
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
  let year, month, day, hour, minute, second
  if (match) {
    year = +match[1]; month = +match[2]; day = +match[3]
    hour = +match[4]; minute = +match[5]; second = +match[6]
  } else {
    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (!match) return null
    month = +match[1]; day = +match[2]; year = +match[3]
    hour = +match[4]; minute = +match[5]; second = +match[6]
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) + TZ_OFFSET_MS)
}

function isPeak(bj, config) {
  const weekday = bj.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const day = bj.toISOString().slice(0, 10)
  if (config.holidays.includes(day)) return false
  const hour = bj.getUTCHours()
  return config.peakWindows.some(([from, to]) => hour >= from && hour < to)
}

function projectName(record, fallback) {
  const cwd = typeof record?.cwd === 'string' ? record.cwd : ''
  if (cwd.length > 0) {
    const base = path.basename(cwd.replace(/[\\/]+$/, ''))
    if (base.length > 0) return base
  }
  return fallback || 'unknown'
}

function normalizeModel(value) {
  const model = typeof value === 'string' && value.length > 0 ? value : 'unknown'
  return model === 'deepseek-v4-flash' ? 'deepseek-flash' : model
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function scan(config) {
  const root = config.claudeDir
  const today = todayKey()
  const files = walkJsonl(root)
  const seen = new Set()
  const dayMap = new Map()
  const todayEvents = []
  let requestsTotal = 0
  let duplicates = 0
  let firstTs = Infinity
  let lastTs = -Infinity

  for (const file of files) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const projectDir = path.relative(root, file).split(path.sep)[0]
    let lineNo = 0
    for (const line of text.split('\n')) {
      lineNo += 1
      if (line.length < 20 || !line.includes('"usage"')) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      const usage = record?.message?.usage
      if (usage === undefined || usage === null || record.timestamp === undefined) continue
      const id = record.message?.id ?? record.uuid
      const key = id === undefined ? `${file}:${lineNo}` : String(id)
      if (seen.has(key)) {
        duplicates += 1
        continue
      }
      seen.add(key)
      const bj = parseTimestamp(record.timestamp)
      if (bj === null) continue
      const hit = number(usage.cache_read_input_tokens)
      const miss = number(usage.input_tokens) + number(usage.cache_creation_input_tokens)
      const out = number(usage.output_tokens)
      const peak = isPeak(bj, config)
      const price = peak ? config.pricing.peak : config.pricing.offPeak
      const cost = (hit * price.cacheHit + miss * price.cacheMiss + out * price.output) / 1_000_000
      const tokens = hit + miss + out
      const day = bj.toISOString().slice(0, 10)
      const project = projectName(record, projectDir)
      const model = normalizeModel(record.message?.model)
      const entry = { day, ts: bj.getTime(), hour: bj.getUTCHours(), minute: bj.getUTCMinutes(), cost, tokens, project, model }
      const dayEntry = dayMap.get(day) || { day, raw: 0, requests: 0 }
      dayEntry.raw += cost
      dayEntry.requests += 1
      dayMap.set(day, dayEntry)
      requestsTotal += 1
      if (day === today) {
        todayEvents.push(entry)
        if (entry.ts < firstTs) firstTs = entry.ts
        if (entry.ts > lastTs) lastTs = entry.ts
      }
    }
  }

  const raw = todayEvents.reduce((sum, item) => sum + item.cost, 0)
  const recent = todayEvents
    .slice()
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 5)
    .map((item) => ({
      time: `${pad(item.hour)}:${pad(item.minute)}`,
      project: item.project,
      model: item.model,
      tokens: item.tokens,
      cost: round(item.cost * config.calibration, 6),
    }))
  const days = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(Date.now() + TZ_OFFSET_MS - offset * 86_400_000).toISOString().slice(0, 10)
    const entry = dayMap.get(day)
    days.push({
      day,
      label: day.slice(5),
      cost: round((entry?.raw ?? 0) * config.calibration, 4),
      requests: entry?.requests ?? 0,
    })
  }
  return {
    raw,
    requests: todayEvents.length,
    requestsTotal,
    firstRequestAt: firstTs === Infinity ? null : formatTime(firstTs),
    lastRequestAt: lastTs === -Infinity ? null : formatTime(lastTs),
    days,
    recent,
    files: files.length,
    duplicates,
  }
}

function formatTime(ts) {
  const bj = new Date(ts)
  return `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function monthKey() {
  return todayKey().slice(0, 7)
}

function emptyTime(standard) {
  return {
    state: 'idle',
    date: null,
    startedAt: null,
    endedAt: null,
    wallClockMinutes: 0,
    todayGainMinutes: 0,
    standardWorkdayMinutes: standard,
    crossesMidnight: false,
    reopenedAt: null,
  }
}

function carryTime(previousTime, today, standard) {
  if (!previousTime || !(Number(previousTime.startedAt) > 0)) return emptyTime(standard)
  if (Number(previousTime.endedAt) > 0 && previousTime.date !== today) return emptyTime(standard)
  return {
    ...previousTime,
    standardWorkdayMinutes: standard,
  }
}

function buildState(config, scanResult, previous) {
  const today = todayKey()
  const standardWorkdayMinutes = Number(config.standardWorkdayMinutes) > 0
    ? Number(config.standardWorkdayMinutes)
    : DEFAULT_STANDARD_WORKDAY_MINUTES
  const time = carryTime(previous?.time, today, standardWorkdayMinutes)
  const raw = scanResult.raw
  const spent = raw * config.calibration
  const basePct = config.cap > 0 ? (spent / config.cap) * 100 : 0

  const previousWrap = previous?.wrapup
  const wrapup = {
    active: previousWrap?.active === true && Number(previousWrap.until) > Date.now(),
    until: previousWrap?.active === true ? Number(previousWrap.until) || 0 : 0,
    cap: Number(previousWrap?.cap) > 0 ? Number(previousWrap.cap) : config.wrapupCap,
  }

  const previousTier2 = previous?.tier2
  const tier2 = {
    enabled: previousTier2?.enabled === true,
    cap: Number(previousTier2?.cap) > 0 ? Number(previousTier2.cap) : config.tier2Cap,
    reason: typeof previousTier2?.reason === 'string' ? previousTier2.reason : '',
    month: previousTier2?.month === monthKey() ? monthKey() : monthKey(),
    count: previousTier2?.month === monthKey() ? Number(previousTier2.count) || 0 : 0,
  }

  const limit = effectiveLimit({ cap: config.cap, wrapup, tier2 })
  const remaining = Math.max(0, limit - spent)
  const effectivePct = limit > 0 ? (spent / limit) * 100 : 0
  const allowed = spent < limit
  let state
  if (tier2.enabled) {
    state = spent >= tier2.cap ? 'TIER2_LOCKED' : spent >= tier2.cap * 0.9 ? 'TIER2_WARN' : 'TIER2'
  } else if (spent >= config.cap) {
    state = 'LOCKED'
  } else if (basePct >= 90) {
    state = 'WINDDOWN'
  } else if (basePct >= 70) {
    state = 'WARN'
  } else {
    state = 'NORMAL'
  }

  return {
    version: 1,
    date: today,
    updatedAt: Date.now(),
    cap: config.cap,
    calibration: config.calibration,
    timeValueMinutesPerUnit: config.timeValueMinutesPerUnit,
    standardWorkdayMinutes,
    limit,
    allowed,
    work: {
      spent: round(spent, 4),
      raw: round(raw, 4),
      pct: round(basePct, 2),
      state,
      effectivePct: round(effectivePct, 2),
      remaining: round(remaining, 4),
      requests: scanResult.requests,
      requestsTotal: scanResult.requestsTotal,
      firstRequestAt: scanResult.firstRequestAt,
      lastRequestAt: scanResult.lastRequestAt,
      days: scanResult.days,
      recent: scanResult.recent,
    },
    wrapup,
    tier2,
    time,
    ledger: {
      ready: Boolean(scanResult.ledger?.events) || fs.existsSync(LEDGER_PATH),
      events: Number(scanResult.ledger?.events) || 0,
      appended: Number(scanResult.ledger?.appended) || 0,
      mode: scanResult.ledger?.mode || 'full',
      bad: Number(scanResult.ledger?.bad) || 0,
    },
    scan: {
      files: scanResult.files,
      duplicates: scanResult.duplicates,
      ledgerEvents: Number(scanResult.ledger?.events) || 0,
      appended: Number(scanResult.ledger?.appended) || 0,
      mode: scanResult.ledger?.mode || 'full',
    },
    statusline: `work ${spent.toFixed(2)}/${limit.toFixed(2)}`,
  }
}

function persistState(config, scanResult) {
  const previous = readState()
  const state = buildState(config, scanResult, previous)
  return withStateLock(STATE_PATH, () => {
    const latest = readState()
    state.time = carryTime(latest?.time, state.date, state.standardWorkdayMinutes)
    writeJson(STATE_PATH, state)
    return state
  })
}

function refresh() {
  const config = loadConfig()
  const scanResult = scanIncremental(config, { ledgerPath: LEDGER_PATH, cachePath: SCAN_CACHE_PATH })
  return persistState(config, scanResult)
}

function stateOrRefresh(maxAgeMs = STATE_MAX_AGE_MS) {
  const current = readState()
  if (current !== null && Date.now() - Number(current.updatedAt) < maxAgeMs) return current
  return refresh()
}

function hookCommand(command) {
  return `"${ensureLauncher()}" ${command}`
}

function ensureLauncher() {
  ensureDataDir()
  fs.mkdirSync(path.dirname(LAUNCHER_PATH), { recursive: true })
  const content = process.platform === 'win32'
    ? [
        '@echo off',
        'setlocal',
        `set "WB_SCRIPT=${SCRIPT_PATH}"`,
        'set "NODE="',
        `if exist "${process.execPath}" set "NODE=${process.execPath}"`,
        'if not defined NODE for /f "delims=" %%I in (\'where node 2^>nul\') do if not defined NODE set "NODE=%%I"',
        'if not defined NODE for /d %%D in ("%LOCALAPPDATA%\\mise\\installs\\node\\*") do if exist "%%D\\node.exe" set "NODE=%%D\\node.exe"',
        'if not defined NODE if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
        'if not defined NODE (',
        '  echo STALE - Node.js not found; wb launcher cannot run 1>&2',
        '  exit /b 0',
        ')',
        '"%NODE%" "%WB_SCRIPT%" %*',
        '',
      ].join('\r\n')
    : `#!/bin/sh\nexec node "${SCRIPT_PATH}" "$@"\n`
  fs.writeFileSync(LAUNCHER_PATH, content, 'utf8')
  if (process.platform !== 'win32') fs.chmodSync(LAUNCHER_PATH, 0o755)
  return LAUNCHER_PATH
}

function isOurCommand(entry) {
  const command = entry?.command
  return typeof command === 'string' &&
    (command.includes('wb.mjs') || command.includes('wb-launcher')) &&
    (command.includes('check') || command.includes('statusline'))
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(settings) {
  const backup = path.join(DATA_DIR, `settings-backup-${Date.now()}.json`)
  ensureDataDir()
  try {
    fs.copyFileSync(SETTINGS_PATH, backup)
  } catch {
    /* no existing settings */
  }
  const temp = `${SETTINGS_PATH}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8')
  fs.renameSync(temp, SETTINGS_PATH)
}

function removeOurHooks(settings) {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return
  for (const name of ['UserPromptSubmit', 'PreToolUse']) {
    if (!Array.isArray(hooks[name])) continue
    hooks[name] = hooks[name]
      .map((group) => {
        if (!Array.isArray(group?.hooks)) return group
        return { ...group, hooks: group.hooks.filter((entry) => !isOurCommand(entry)) }
      })
      .filter((group) => Array.isArray(group.hooks) && group.hooks.length > 0)
    if (hooks[name].length === 0) delete hooks[name]
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks
}

function installHooks() {
  const settings = readSettings()
  removeOurHooks(settings)
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
  const promptCommand = hookCommand('check --hook --event prompt')
  const toolCommand = hookCommand('check --hook --event tool')
  hooks.UserPromptSubmit = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : []
  hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: promptCommand, timeout: 30 }] })
  hooks.PreToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : []
  hooks.PreToolUse.push({
    matcher: 'Bash|Edit|Write|NotebookEdit|MultiEdit|Task|WebFetch|WebSearch|mcp__.*',
    hooks: [{ type: 'command', command: toolCommand, timeout: 30 }],
  })
  settings.hooks = hooks
  writeSettings(settings)
  return settings
}

function uninstallHooks() {
  const settings = readSettings()
  removeOurHooks(settings)
  writeSettings(settings)
  return settings
}

function hookStatus() {
  const settings = readSettings()
  const prompt = Array.isArray(settings.hooks?.UserPromptSubmit)
    ? settings.hooks.UserPromptSubmit.some((group) => (group.hooks || []).some(isOurCommand))
    : false
  const tools = Array.isArray(settings.hooks?.PreToolUse)
    ? settings.hooks.PreToolUse.some((group) => (group.hooks || []).some(isOurCommand))
    : false
  return {
    prompt,
    tools,
    statusline: settings.statusLine?.command?.includes('wb.mjs') === true || settings.statusLine?.command?.includes('wb-launcher') === true || ccstatuslineHasWb(),
  }
}

function commandPathOf(command) {
  if (typeof command !== 'string') return ''
  const text = command.trim()
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    return end > 1 ? text.slice(1, end) : ''
  }
  return text.split(/\s+/)[0] || ''
}

function installedCommandPaths() {
  const paths = new Set()
  const settings = readSettings()
  for (const name of ['UserPromptSubmit', 'PreToolUse']) {
    for (const group of settings.hooks?.[name] || []) {
      for (const entry of group.hooks || []) {
        if (isOurCommand(entry)) {
          const commandPath = commandPathOf(entry.command)
          if (commandPath) paths.add(commandPath)
        }
      }
    }
  }
  if (typeof settings.statusLine?.command === 'string' &&
    (settings.statusLine.command.includes('wb.mjs') || settings.statusLine.command.includes('wb-launcher'))) {
    const commandPath = commandPathOf(settings.statusLine.command)
    if (commandPath) paths.add(commandPath)
  }
  const cc = readCcstatusline()
  for (const line of cc?.lines || []) {
    for (const widget of line || []) {
      if (isWbStatuslineWidget(widget)) {
        const commandPath = commandPathOf(widget.commandPath)
        if (commandPath) paths.add(commandPath)
      }
    }
  }
  return [...paths]
}

function launcherHealth() {
  if (!fs.existsSync(LAUNCHER_PATH)) return { ok: false, detail: 'missing' }
  let text = ''
  try {
    text = fs.readFileSync(LAUNCHER_PATH, 'utf8')
  } catch {
    return { ok: false, detail: 'unreadable' }
  }
  const scriptOk = process.platform !== 'win32' || text.includes(SCRIPT_PATH)
  const nodeOk = fs.existsSync(process.execPath)
  const probe = process.platform === 'win32'
    ? spawnSync('where', ['node'], { encoding: 'utf8', timeout: 2_000 })
    : spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', timeout: 2_000 })
  const pathNodeOk = probe.status === 0 && String(probe.stdout || '').trim().length > 0
  return {
    ok: scriptOk && (nodeOk || pathNodeOk),
    detail: `script=${scriptOk ? 'ok' : 'missing'} node=${nodeOk ? 'ok' : 'missing'} pathNode=${pathNodeOk ? 'ok' : 'missing'}`,
  }
}

function readCcstatusline() {
  try {
    return JSON.parse(fs.readFileSync(CCSTATUSLINE_PATH, 'utf8'))
  } catch {
    return null
  }
}

function isWbStatuslineWidget(widget) {
  return (
    widget?.type === 'custom-command' &&
    typeof widget.commandPath === 'string' &&
    (widget.commandPath.includes('wb.mjs') || widget.commandPath.includes('wb-launcher') || widget.commandPath.includes('wb.cmd')) &&
    widget.commandPath.includes('statusline')
  )
}

function ccstatuslineHasWb() {
  const config = readCcstatusline()
  return Array.isArray(config?.lines) && config.lines.some((line) => Array.isArray(line) && line.some(isWbStatuslineWidget))
}

function stripWbStatuslineWidgets(lines) {
  return lines.map((line) => {
    if (!Array.isArray(line)) return line
    const output = []
    for (const widget of line) {
      if (isWbStatuslineWidget(widget)) {
        if (output.length > 0 && output[output.length - 1].type === 'separator') output.pop()
        continue
      }
      output.push(widget)
    }
    return output
  })
}

function writeCcstatusline(config) {
  ensureDataDir()
  const backup = path.join(DATA_DIR, `ccstatusline-backup-${Date.now()}.json`)
  try {
    fs.copyFileSync(CCSTATUSLINE_PATH, backup)
  } catch {
    /* no existing config */
  }
  const temp = `${CCSTATUSLINE_PATH}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8')
  fs.renameSync(temp, CCSTATUSLINE_PATH)
}

function installStatusline() {
  const config = readCcstatusline()
  if (config === null || !Array.isArray(config.lines)) {
    throw new Error(`找不到 ccstatusline 配置：${CCSTATUSLINE_PATH}`)
  }
  config.lines = stripWbStatuslineWidgets(config.lines)
  if (config.lines.length === 0) config.lines.push([])
  const commandPath = `"${ensureLauncher()}" statusline --color`
  config.lines[0].push(
    { id: requireId(), type: 'separator' },
    {
      id: requireId(),
      type: 'custom-command',
      commandPath,
      color: 'green',
      maxWidth: 30,
      timeout: 5000,
      preserveColors: true,
    },
  )
  writeCcstatusline(config)
}

function statuslineColor(state) {
  const limit = Number(state.limit) > 0 ? Number(state.limit) : Number(state.cap) || 1
  const pct = (Number(state.work?.spent) / limit) * 100
  const code = !state.allowed || pct >= 100 ? 31 : pct >= 90 ? 31 : pct >= 70 ? 33 : 32
  return `\x1b[1;${code}m${state.statusline}\x1b[0m`
}

function uninstallStatusline() {
  const config = readCcstatusline()
  if (config === null || !Array.isArray(config.lines)) return false
  config.lines = stripWbStatuslineWidgets(config.lines)
  writeCcstatusline(config)
  return true
}

function requireId() {
  return cryptoRandomId()
}

function cryptoRandomId() {
  // Avoid a crypto import for the common path; ids only need to be unique.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function fmtDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest}m`
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}

function errorLine(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\s+/g, ' ').trim() || 'unknown error'
}

function printState(state) {
  const time = timeView(state, Date.now())
  console.log(`日期      ${state.date}`)
  console.log(`工作花费  ¥${state.work.spent.toFixed(2)} / ${Number(state.limit).toFixed(2)}  (${Number(state.work.effectivePct ?? state.work.pct).toFixed(1)}%)`)
  console.log(`状态      ${state.work.state}${state.allowed ? '' : ' · 下一次请求将被拒绝'}`)
  console.log(`剩余      ¥${state.work.remaining.toFixed(2)}`)
  console.log(`请求      ${state.work.requests} 次 · ${state.scan.files} 文件 · 去重 ${state.scan.duplicates}`)
  if (time.state === 'idle') {
    console.log('时间      今日未开工')
  } else if (time.state === 'working') {
    console.log(`开工      ${clock(time.startedAt)} · 墙钟 ${fmtDuration(time.wallClockMinutes)}${time.crossesMidnight ? ' · 跨日' : ''}`)
    console.log(`今日收益  ≈ ${fmtDuration(time.todayGainMinutes)}（进行中）`)
  } else {
    console.log(`收工      ${clock(time.startedAt)}–${clock(time.endedAt)} · 墙钟 ${fmtDuration(time.wallClockMinutes)}${time.crossesMidnight ? ' · 跨日' : ''}`)
    console.log(`今日收益  ${fmtDuration(time.todayGainMinutes)}`)
  }
  if (state.wrapup?.active) console.log(`收尾      已开启 · ¥${state.wrapup.cap.toFixed(2)} · 至 ${new Date(state.wrapup.until).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
  if (state.tier2?.enabled) console.log(`二级      已开启 · ¥${state.tier2.cap.toFixed(2)} · ${state.tier2.reason}`)
  console.log(`更新      ${new Date(state.updatedAt).toLocaleString('zh-CN')}`)
}

function checkJson(state) {
  return {
    ok: state.allowed,
    state: state.work.state,
    spent: state.work.spent,
    cap: state.cap,
    limit: state.limit,
    remaining: state.work.remaining,
    statusline: state.statusline,
    wrapup: state.wrapup,
    tier2: state.tier2,
  }
}

function optionValue(args, name) {
  const index = args.findIndex((item) => item === name || item.startsWith(`${name}=`))
  if (index < 0) return null
  return args[index].includes('=') ? args[index].slice(args[index].indexOf('=') + 1) : args[index + 1] || null
}

function readHookInput() {
  if (process.stdin.isTTY) return null
  try {
    const text = fs.readFileSync(0, 'utf8').trim()
    return text.length > 0 ? JSON.parse(text) : null
  } catch {
    return null
  }
}

const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'NotebookRead',
  'TodoWrite',
  'AskUserQuestion',
  'ExitPlanMode',
])

const SAFE_BASH_PATTERNS = [
  /^git\s+(status|diff|log|show|rev-parse|branch|remote|ls-files)\b/,
  /^(ls|pwd|cat|head|tail|grep|rg)\b/,
  /^npm\s+(test|run\s+test)\b/,
  /^pnpm\s+(test|run\s+test)\b/,
  /^node\s+--test\b/,
  /^(pytest|python\s+-m\s+pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test)\b/,
]

function isSafeBashCommand(command) {
  const text = typeof command === 'string' ? command.trim() : ''
  if (text.length === 0) return false
  if (/[;&|><]/.test(text)) return false
  return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(text))
}

function isToolAllowed(input) {
  const name = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (name.length === 0) return true
  if (READ_ONLY_TOOLS.has(name)) return true
  if (name === 'Bash') return isSafeBashCommand(input?.tool_input?.command)
  return false
}

function main() {
  const argv = process.argv.slice(2)
  const command = argv[0] || 'status'
  const rest = argv.slice(1)

  if (command === 'refresh') {
    const state = refresh()
    if (rest.includes('--json')) console.log(JSON.stringify(state, null, 2))
    else printState(state)
    return
  }

  if (command === 'rebuild') {
    const config = loadConfig()
    const fromSource = rest.includes('--source') || !fs.existsSync(LEDGER_PATH)
    let scanResult
    try {
      scanResult = fromSource
        ? rebuildFromSource(config, { ledgerPath: LEDGER_PATH, cachePath: SCAN_CACHE_PATH })
        : rebuildFromLedger(config, { ledgerPath: LEDGER_PATH })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
      return
    }
    const state = persistState(config, scanResult)
    if (rest.includes('--json')) console.log(JSON.stringify(state, null, 2))
    else {
      console.log(`已重建 · ${fromSource ? '原始日志' : 'ledger'} · ${state.ledger.events} 事件`)
      printState(state)
    }
    return
  }

  if (command === 'start' || command === 'done' || command === 'reopen') {
    stateOrRefresh()
    let at = null
    if (command === 'reopen') {
      const index = rest.findIndex((item) => item === '--at' || item.startsWith('--at='))
      if (index >= 0) {
        const value = rest[index].includes('=') ? rest[index].slice(rest[index].indexOf('=') + 1) : rest[index + 1]
        if (!value) {
          console.error('reopen --at 需要 HH:MM')
          process.exitCode = 1
          return
        }
        const parsed = parseAt(value, Date.now())
        if (parsed.error) {
          console.error(parsed.error)
          process.exitCode = 1
          return
        }
        at = parsed.ms
      }
    }
    const config = loadConfig()
    let result
    try {
      result = mutateTimeState({
        statePath: STATE_PATH,
        logPath: TIME_LOG_PATH,
        action: command,
        at,
        now: Date.now(),
        standardWorkdayMinutes: config.standardWorkdayMinutes,
        source: 'cli',
      })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
      return
    }
    if (!result.ok) {
      console.error(result.message)
      process.exitCode = 1
      return
    }
    const time = result.time
    if (rest.includes('--json')) {
      console.log(JSON.stringify({ ok: true, idempotent: result.idempotent === true, time }, null, 2))
    } else if (command === 'start') {
      console.log(result.idempotent ? `已开工 ${clock(time.startedAt)}（重复操作，未改记录）` : `已开工 ${clock(time.startedAt)}`)
    } else if (command === 'done') {
      console.log(
        result.idempotent
          ? `今天已经收工 ${clock(time.startedAt)}–${clock(time.endedAt)} · 墙钟 ${fmtDuration(time.wallClockMinutes)}`
          : `已收工 ${clock(time.startedAt)}–${clock(time.endedAt)} · 墙钟 ${fmtDuration(time.wallClockMinutes)} · 今日收益 ${fmtDuration(time.todayGainMinutes)}`,
      )
    } else {
      console.log(`已重新开工 ${clock(time.startedAt)}${at === null ? '（保留原开工）' : '（指定时间）'}`)
    }
    return
  }

  if (command === 'status') {
    const state = stateOrRefresh()
    if (rest.includes('--json')) console.log(JSON.stringify(state, null, 2))
    else printState(state)
    return
  }

  if (command === 'check') {
    const event = optionValue(rest, '--event') || (rest.includes('--hook') ? 'prompt' : null)
    let state
    try {
      state = stateOrRefresh()
    } catch (error) {
      if (rest.includes('--hook')) {
        process.stderr.write(`STALE · state 刷新失败：${errorLine(error)}；本次 hook 放行\n`)
        return
      }
      process.stderr.write(`wb: ${errorLine(error)}\n`)
      process.exitCode = 1
      return
    }
    if (!state.allowed) {
      if (event === 'tool' && isToolAllowed(readHookInput())) return
      const reason = state.tier2?.enabled
        ? `二级上限已用尽 ${state.work.spent.toFixed(2)}/${state.limit.toFixed(2)}`
        : state.wrapup?.active
          ? `收尾额度已用尽 ${state.work.spent.toFixed(2)}/${state.limit.toFixed(2)}`
          : `工作额度已用完 ${state.work.spent.toFixed(2)}/${state.cap.toFixed(2)}`
      const hint = event === 'tool'
        ? '只读命令放行；wb wrapup 开启收尾'
        : 'wb wrapup 开启收尾，wb tier2 --on 申请二级'
      process.stderr.write(`work ${state.work.spent.toFixed(2)}/${state.limit.toFixed(2)} · ${reason}；${hint}\n`)
      process.exitCode = 2
      return
    }
    if (rest.includes('--json')) process.stdout.write(JSON.stringify(checkJson(state)) + '\n')
    return
  }

  if (command === 'statusline') {
    const action = rest[0] || 'print'
    if (action === 'install') {
      try {
        installStatusline()
        console.log('ccstatusline 已加入 work 组件')
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      }
      return
    }
    if (action === 'uninstall') {
      const changed = uninstallStatusline()
      console.log(changed ? 'ccstatusline 已移除 work 组件' : '未找到 ccstatusline 配置')
      return
    }
    if (action === 'status') {
      console.log(JSON.stringify({ merged: ccstatuslineHasWb(), path: CCSTATUSLINE_PATH }, null, 2))
      return
    }
    const state = stateOrRefresh()
    if (rest.includes('--color') || rest.includes('color')) {
      process.stdout.write(statuslineColor(state) + '\n')
    } else {
      process.stdout.write(state.statusline + '\n')
    }
    return
  }

  if (command === 'wrapup') {
    stateOrRefresh()
    const active = !rest.includes('--off')
    let result
    try {
      result = mutateBudgetState({
        statePath: STATE_PATH,
        logPath: BUDGET_LOG_PATH,
        action: active ? 'wrapup-on' : 'wrapup-off',
        now: Date.now(),
      })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
      return
    }
    if (!result.ok) {
      console.error(result.message)
      process.exitCode = 1
      return
    }
    console.log(result.wrapup.active ? `收尾已开启 · ¥${result.wrapup.cap.toFixed(2)} / 30 分钟` : '收尾已关闭')
    return
  }

  if (command === 'tier2') {
    stateOrRefresh()
    const off = rest.includes('--off')
    let reason = ''
    if (!off) {
      const reasonIndex = rest.indexOf('--on')
      reason = reasonIndex >= 0 ? rest.slice(reasonIndex + 1).join(' ').trim() : ''
      if (reason.length === 0) {
        console.error('用法：wb tier2 --on "一句理由"')
        process.exitCode = 1
        return
      }
    }
    let result
    try {
      result = mutateBudgetState({
        statePath: STATE_PATH,
        logPath: BUDGET_LOG_PATH,
        action: off ? 'tier2-off' : 'tier2-on',
        reason,
        now: Date.now(),
      })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
      return
    }
    if (!result.ok) {
      console.error(result.message)
      process.exitCode = 1
      return
    }
    console.log(off ? '二级上限已关闭' : `二级上限已开启 · ¥20 · ${reason}`)
    return
  }

  if (command === 'hooks') {
    const action = rest[0] || 'status'
    if (action === 'install') {
      installHooks()
      console.log('hooks 已安装：UserPromptSubmit + PreToolUse')
      return
    }
    if (action === 'uninstall') {
      uninstallHooks()
      console.log('hooks 已卸载')
      return
    }
    if (action === 'status') {
      const status = hookStatus()
      console.log(JSON.stringify(status, null, 2))
      return
    }
    console.error('用法：wb hooks install|uninstall|status')
    process.exitCode = 1
    return
  }

  if (command === 'watch') {
    if (rest.includes('--status')) {
      console.log(JSON.stringify(watchStatus(DATA_DIR, SCRIPT_PATH), null, 2))
      return
    }
    if (rest.includes('--stop')) {
      let result
      try {
        result = stopWatcher(DATA_DIR, SCRIPT_PATH)
      } catch (error) {
        console.error('停止失败：' + (error instanceof Error ? error.message : String(error)))
        process.exitCode = 1
        return
      }
      if (!result.ok) {
        console.error(result.message)
        process.exitCode = 1
        return
      }
      console.log(result.stopped ? 'wb watch 已停止' : 'wb watch 未运行')
      return
    }

    const acquisition = acquireWatcher(DATA_DIR, SCRIPT_PATH)
    if (!acquisition.ok) {
      console.log(`wb watch 已在运行 · pid ${acquisition.status.pid}`)
      process.exitCode = 2
      return
    }

    const interval = 15_000
    const log = (message) => {
      appendWatchLog(DATA_DIR, message)
      if (process.stdout.isTTY) console.log(message)
    }
    log(`wb watch · pid ${process.pid} · 每 ${interval / 1000}s 刷新 ${STATE_PATH}`)
    const tick = () => {
      try {
        const state = refresh()
        heartbeat(DATA_DIR, state)
        log(`${state.statusline} ${state.work.state}`)
      } catch (error) {
        log(`ERROR ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const configMtime = () => {
      try {
        return fs.statSync(CONFIG_PATH).mtimeMs
      } catch {
        return 0
      }
    }
    let lastConfigMtime = configMtime()
    tick()
    const periodic = setInterval(tick, interval)
    const configWatch = setInterval(() => {
      const nextMtime = configMtime()
      if (nextMtime === lastConfigMtime) return
      lastConfigMtime = nextMtime
      tick()
    }, 1000)
    let stopped = false
    const cleanup = (reason) => {
      if (stopped) return
      stopped = true
      clearInterval(periodic)
      clearInterval(configWatch)
      acquisition.release()
      log(`wb watch 停止 · ${reason}`)
      process.exit(0)
    }
    process.on('SIGINT', () => cleanup('SIGINT'))
    process.on('SIGTERM', () => cleanup('SIGTERM'))
    process.on('uncaughtException', (error) => {
      log(`FATAL ${error instanceof Error ? error.stack || error.message : String(error)}`)
      cleanup('uncaughtException')
    })
    process.on('unhandledRejection', (error) => {
      log(`FATAL rejection ${error instanceof Error ? error.stack || error.message : String(error)}`)
      cleanup('unhandledRejection')
    })
    return
  }

  if (command === 'autostart') {
    const action = rest[0] || 'status'
    if (action === 'install') {
      const launcher = ensureLauncher()
      const result = installAutostart(process.execPath, SCRIPT_PATH, launcher)
      console.log(`开机自启已安装：${result.path}`)
      console.log('当前用户登录时启动；卸载：wb autostart uninstall')
      return
    }
    if (action === 'uninstall') {
      stopWatcher(DATA_DIR, SCRIPT_PATH)
      const result = uninstallAutostart()
      console.log(result.removed ? `开机自启已移除：${result.path}` : `未找到：${result.path}`)
      return
    }
    if (action === 'status') {
      const status = autostartStatus()
      console.log(JSON.stringify(status, null, 2))
      return
    }
    console.error('用法：wb autostart install|uninstall|status')
    process.exitCode = 1
    return
  }

  if (command === 'selftest') {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-selftest-'))
    const fakeState = (spent, allowed, state) => ({
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
        requests: 17,
        requestsTotal: 17,
        firstRequestAt: '09:41',
        lastRequestAt: '10:36',
        days: [],
        recent: [],
      },
      wrapup: { active: false, until: 0, cap: 0.5 },
      tier2: { enabled: false, cap: 20, reason: '', month: monthKey(), count: 0 },
      scan: { files: 29, duplicates: 13428 },
      statusline: `work ${spent.toFixed(2)}/10`,
    })
    const env = { ...process.env, WB_DATA_DIR: tempDir }
    const run = (args) => spawnSync(process.execPath, [SCRIPT_PATH, ...args], { env, encoding: 'utf8' })
    const checks = []
    try {
      fs.writeFileSync(path.join(tempDir, 'state.json'), JSON.stringify(fakeState(10.02, false, 'LOCKED')))
      const blocked = run(['check', '--hook'])
      checks.push({
        name: 'LOCKED check exit 2',
        pass: blocked.status === 2 && (blocked.stderr || '').includes('额度已用完'),
        detail: `exit=${blocked.status} stderr=${(blocked.stderr || '').trim()}`,
      })
      const red = run(['statusline', '--color'])
      checks.push({
        name: 'LOCKED statusline red',
        pass: (red.stdout || '').includes('\u001b[1;31m'),
        detail: 'expected \\x1b[1;31m',
      })

      fs.writeFileSync(path.join(tempDir, 'state.json'), JSON.stringify(fakeState(7.8, true, 'WARN')))
      const yellow = run(['statusline', '--color'])
      checks.push({
        name: 'WARN statusline yellow',
        pass: (yellow.stdout || '').includes('\u001b[1;33m'),
        detail: 'expected \\x1b[1;33m',
      })

      fs.writeFileSync(path.join(tempDir, 'state.json'), JSON.stringify(fakeState(2.6, true, 'NORMAL')))
      const allowed = run(['check', '--hook'])
      checks.push({ name: 'NORMAL check exit 0', pass: allowed.status === 0, detail: `exit=${allowed.status}` })

      const line = run(['statusline'])
      checks.push({
        name: 'statusline output',
        pass: line.status === 0 && (line.stdout || '').trim() === 'work 2.60/10',
        detail: (line.stdout || '').trim(),
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    let failed = 0
    for (const check of checks) {
      console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}  ${check.detail}`)
      if (!check.pass) failed += 1
    }
    console.log(failed === 0 ? 'selftest PASS' : `selftest FAIL (${failed})`)
    if (failed > 0) process.exitCode = 1
    return
  }

  if (command === 'doctor') {
    const config = loadConfig()
    const status = hookStatus()
    console.log(`data      ${DATA_DIR}`)
    console.log(`config    ${CONFIG_PATH} ${fs.existsSync(CONFIG_PATH) ? 'ok' : 'missing'}`)
    console.log(`state     ${STATE_PATH} ${fs.existsSync(STATE_PATH) ? 'ok' : 'missing'}`)
    console.log(`ledger    ${LEDGER_PATH} ${fs.existsSync(LEDGER_PATH) ? 'ok' : 'missing'}`)
    console.log(`cache     ${SCAN_CACHE_PATH} ${fs.existsSync(SCAN_CACHE_PATH) ? 'ok' : 'missing'}`)
    console.log(`claude    ${config.claudeDir} ${fs.existsSync(config.claudeDir) ? 'ok' : 'missing'}`)
    console.log(`node      ${process.execPath}`)
    console.log(`hooks     prompt=${status.prompt} tools=${status.tools} statusline=${status.statusline}`)
    let doctorOk = true
    const launcher = launcherHealth()
    console.log(`launcher  ${launcher.ok ? 'ok' : 'MISSING'} ${LAUNCHER_PATH} (${launcher.detail})`)
    if (!launcher.ok) doctorOk = false
    for (const commandPath of installedCommandPaths()) {
      const ok = fs.existsSync(commandPath)
      console.log(`command   ${ok ? 'ok' : 'MISSING'} ${commandPath}`)
      if (!ok) doctorOk = false
    }
    const watch = watchStatus(DATA_DIR, SCRIPT_PATH)
    if (watch.running) {
      console.log(`watch     running pid=${watch.pid} lastTick=${watch.lastTick ? new Date(watch.lastTick).toLocaleTimeString('zh-CN') : '?'} stateAge=${watch.stateAgeSeconds ?? '?'}s`)
      if (watch.script && !fs.existsSync(watch.script)) {
        console.log(`watch     MISSING ${watch.script}`)
        doctorOk = false
      }
      if (watch.node && !fs.existsSync(watch.node) && !launcher.ok) {
        console.log(`watch     MISSING node ${watch.node}`)
        doctorOk = false
      }
    } else {
      console.log(`watch     not running${watch.alive ? ' (pid alive but identity mismatch)' : ''}`)
    }
    const startup = autostartStatus()
    console.log(`startup   ${startup.installed ? 'installed' : 'not installed'}`)
    if (startup.installed && typeof startup.command === 'string') {
      const launcherLine = startup.command.split(/\r?\n/).find((line) => line.trim().startsWith('launcher = '))
      if (launcherLine) {
        const startupPath = launcherLine.slice(launcherLine.indexOf('"') + 1, launcherLine.lastIndexOf('"'))
        if (!fs.existsSync(startupPath)) {
          console.log(`startup   MISSING ${startupPath}`)
          doctorOk = false
        }
      }
    }
    if (!doctorOk) process.exitCode = 1
    return
  }

  console.error('用法：wb refresh|rebuild|status|start|done|reopen|check|statusline|wrapup|tier2|hooks|watch|autostart|selftest|doctor')
  process.exitCode = 1
}

try {
  main()
} catch (error) {
  process.stderr.write(`wb: ${errorLine(error)}\n`)
  process.exitCode = 1
}
