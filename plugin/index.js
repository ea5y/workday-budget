/**
 * Workday Budget dashboard host.
 *
 * Reads the real Claude Code session JSONL (work ledger) and the live DSH
 * session corpus (tooling ledger), prices both, and serves a single same-origin
 * JSON snapshot for the full-screen dashboard.
 *
 * The work ledger is the only one that counts against the daily cap and the only
 * one calibrated. DSH tooling is display-only until the standalone `wb` core
 * and Claude Code hooks are wired in.
 *
 * @module @local/workday-budget
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_STANDARD_WORKDAY_MINUTES,
  mutateTimeState,
  parseAt,
  timeView,
} from '../core/time-core.mjs'
import { mutateBudgetState } from '../core/budget-actions.mjs'
import { scanUsage } from '../core/usage-core.mjs'

const SUMMARY_PATH = '/workday-budget/summary'
const SETTINGS_PATH = '/workday-budget/settings'
const TIME_PATH = '/workday-budget/time'
const BUDGET_PATH = '/workday-budget/budget'
const TZ_OFFSET_MS = 8 * 3_600_000
const CORE_DIR = process.env.WB_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'workbuddy')
const CORE_STATE_PATH = path.join(CORE_DIR, 'state.json')
const CORE_CONFIG_PATH = path.join(CORE_DIR, 'config.json')
const TIME_LOG_PATH = path.join(CORE_DIR, 'time-log.jsonl')
const BUDGET_LOG_PATH = path.join(CORE_DIR, 'budget-log.jsonl')
const CONFIG_CHANGES_PATH = path.join(CORE_DIR, 'config-changes.jsonl')
const CLAUDE_SETTINGS_PATH = process.env.WB_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json')
const CCSTATUSLINE_PATH = process.env.WB_CCSTATUSLINE || path.join(os.homedir(), '.config', 'ccstatusline', 'settings.json')

const DEFAULT_PRICING = {
  offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
}

/** Host services this plugin needs. */
export const inject = ['webServer', 'sessionQuery']

/**
 * Mount the read-only dashboard route.
 * @param ctx - owning Cordis context.
 * @param config - bundle row configuration.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const cache = { data: null, at: 0, pending: null }
  const toolingCache = { data: null, at: 0, pending: null }

  const sendJson = (res, status, body) => {
    if (res.writableEnded) return
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(JSON.stringify(body))
  }

  const ensureSummary = async () => {
    const ttl = settings.refreshSeconds * 1000
    if (cache.data !== null && Date.now() - cache.at < ttl) return cache.data
    if (cache.pending !== null) return cache.pending
    cache.pending = (async () => {
      try {
        const data = await buildSummary(ctx, settings, toolingCache)
        if (data.tooling.pending !== true) {
          cache.data = data
          cache.at = Date.now()
        }
        return data
      } finally {
        cache.pending = null
      }
    })()
    return cache.pending
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SUMMARY_PATH,
        handler: async (req, res) => {
          try {
            if (!isLoopback(req)) {
              sendJson(res, 403, { error: 'local access only' })
              return
            }
            sendJson(res, 200, await ensureSummary())
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : String(error),
              generatedAt: Date.now(),
            })
          }
        },
      }),
    'workday-budget: summary route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SETTINGS_PATH,
        handler: async (req, res) => {
          try {
            if (!isLoopback(req)) {
              sendJson(res, 403, { error: 'local access only' })
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'POST required' })
              return
            }
            const input = await readJsonBody(req)
            const parsed = validateSettings(input)
            if (Object.keys(parsed.errors).length > 0) {
              sendJson(res, 400, { error: 'invalid settings', fields: parsed.errors })
              return
            }
            const before = readCoreConfig(settings)
            const beforeUpdatedAt = readCoreState()?.updatedAt ?? 0
            const next = mergeSettings(before, parsed.value)
            writeCoreConfig(next, before, parsed.value)
            cache.data = null
            cache.at = 0
            const applied = await waitForConfig(parsed.value, beforeUpdatedAt)
            sendJson(res, 200, { ok: true, applied, config: readCoreConfig(settings) })
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    'workday-budget: settings route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: TIME_PATH,
        handler: async (req, res) => {
          try {
            if (!isLoopback(req)) {
              sendJson(res, 403, { error: 'local access only' })
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'POST required' })
              return
            }
            const input = await readJsonBody(req)
            const action = input.action
            if (action !== 'start' && action !== 'done' && action !== 'reopen') {
              sendJson(res, 400, { error: 'action must be start, done or reopen' })
              return
            }
            let at = null
            if (action === 'reopen' && input.at !== undefined && input.at !== null && input.at !== '') {
              const parsed = parseAt(input.at, Date.now())
              if (parsed.error) {
                sendJson(res, 400, { error: parsed.error })
                return
              }
              at = parsed.ms
            }
            const config = readCoreConfig(settings)
            const result = mutateTimeState({
              statePath: CORE_STATE_PATH,
              logPath: TIME_LOG_PATH,
              action,
              at,
              now: Date.now(),
              standardWorkdayMinutes: Number(config.standardWorkdayMinutes) || DEFAULT_STANDARD_WORKDAY_MINUTES,
              source: 'dsh-panel',
            })
            if (!result.ok) {
              sendJson(res, 400, { error: result.message, code: result.error })
              return
            }
            cache.data = null
            cache.at = 0
            sendJson(res, 200, { ok: true, action, idempotent: result.idempotent === true, time: result.time })
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    'workday-budget: time route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: BUDGET_PATH,
        handler: async (req, res) => {
          try {
            if (!isLoopback(req)) {
              sendJson(res, 403, { error: 'local access only' })
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'POST required' })
              return
            }
            const input = await readJsonBody(req)
            const action = input.action
            if (!['wrapup-on', 'wrapup-off', 'tier2-on', 'tier2-off'].includes(action)) {
              sendJson(res, 400, { error: 'action must be wrapup-on, wrapup-off, tier2-on or tier2-off' })
              return
            }
            const result = mutateBudgetState({
              statePath: CORE_STATE_PATH,
              logPath: BUDGET_LOG_PATH,
              action,
              reason: typeof input.reason === 'string' ? input.reason : '',
              now: Date.now(),
            })
            if (!result.ok) {
              sendJson(res, 400, { error: result.message, code: result.error })
              return
            }
            cache.data = null
            cache.at = 0
            sendJson(res, 200, {
              ok: true,
              idempotent: result.idempotent === true,
              wrapup: result.wrapup,
              tier2: result.tier2,
              limit: result.limit,
              allowed: result.allowed,
            })
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    'workday-budget: budget action route',
  )
}

function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const pricing = input.pricing !== null && typeof input.pricing === 'object' ? input.pricing : {}
  const readPrice = (group, field, fallback) => {
    const value = pricing[group]?.[field]
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }
  return {
    cap: positive(input.cap, 10),
    calibration: positive(input.calibration, 1.14),
    timezone: typeof input.timezone === 'string' ? input.timezone : 'Asia/Shanghai',
    claudeDir: typeof input.claudeDir === 'string' && input.claudeDir.length > 0
      ? input.claudeDir
      : path.join(os.homedir(), '.claude', 'projects'),
    maxSessions: integer(input.maxSessions, 300),
    refreshSeconds: integer(input.refreshSeconds, 30),
    timeValueMinutesPerUnit: positive(input.timeValueMinutesPerUnit, 48),
    holidays: Array.isArray(input.holidays) ? input.holidays.filter((item) => typeof item === 'string') : [],
    peakWindows: peakWindows(input.peakWindows),
    pricing: {
      offPeak: {
        cacheHit: readPrice('offPeak', 'cacheHit', DEFAULT_PRICING.offPeak.cacheHit),
        cacheMiss: readPrice('offPeak', 'cacheMiss', DEFAULT_PRICING.offPeak.cacheMiss),
        output: readPrice('offPeak', 'output', DEFAULT_PRICING.offPeak.output),
      },
      peak: {
        cacheHit: readPrice('peak', 'cacheHit', DEFAULT_PRICING.peak.cacheHit),
        cacheMiss: readPrice('peak', 'cacheMiss', DEFAULT_PRICING.peak.cacheMiss),
        output: readPrice('peak', 'output', DEFAULT_PRICING.peak.output),
      },
    },
  }
}

function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function integer(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function peakWindows(value) {
  const fallback = [[9, 12], [14, 18]]
  if (!Array.isArray(value)) return fallback
  const windows = value
    .filter((item) => Array.isArray(item) && item.length === 2 && item[0] >= 0 && item[1] <= 24 && item[0] < item[1])
    .map((item) => [Math.floor(item[0]), Math.floor(item[1])])
  return windows.length > 0 ? windows : fallback
}

async function buildSummary(ctx, settings, toolingCache) {
  const startedAt = Date.now()
  const core = readCoreState()
  const work = core !== null ? coreWork(core) : await scanClaude(settings)
  const tooling = getTooling(ctx, settings, toolingCache)
  const fileConfig = readCoreConfig(settings)
  const cap = core?.cap ?? fileConfig.cap
  const limit = Number(core?.limit) > 0 ? Number(core.limit) : cap
  const calibration = core?.calibration ?? fileConfig.calibration
  const timeValue = core?.timeValueMinutesPerUnit ?? fileConfig.timeValueMinutesPerUnit
  const today = todayKey()
  const spent = round(work.spent, 4)
  const pct = cap > 0 ? (spent / cap) * 100 : 0
  const effectivePct = limit > 0 ? (spent / limit) * 100 : 0
  const state = work.state ?? (pct >= 100 ? 'LOCKED' : pct >= 90 ? 'WINDDOWN' : pct >= 70 ? 'WARN' : 'NORMAL')
  const remaining = Math.max(0, limit - spent)
  const timeCreditMinutes = Math.round(remaining * timeValue)
  const forecast = forecastLabel(spent, remaining, limit)
  const hooks = readHookStatus(core)

  return {
    kind: 'workday-budget',
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    date: today,
    timezone: settings.timezone,
    cap,
    calibration,
    timeValueMinutesPerUnit: timeValue,
    config: {
      cap: fileConfig.cap,
      calibration: fileConfig.calibration,
      timeValueMinutesPerUnit: fileConfig.timeValueMinutesPerUnit,
      standardWorkdayMinutes: fileConfig.standardWorkdayMinutes,
      pricing: fileConfig.pricing,
      peakWindows: fileConfig.peakWindows,
      holidays: fileConfig.holidays,
      claudeDir: fileConfig.claudeDir,
      wrapupCap: fileConfig.wrapupCap,
      wrapupMinutes: fileConfig.wrapupMinutes,
      tier2Cap: fileConfig.tier2Cap,
    },
    work: {
      spent,
      raw: round(work.raw, 4),
      pct: round(pct, 2),
      effectivePct: round(effectivePct, 2),
      state,
      remaining: round(remaining, 4),
      requests: work.requests,
      requestsTotal: work.requestsTotal,
      firstRequestAt: work.firstRequestAt,
      lastRequestAt: work.lastRequestAt,
      days: work.days,
      recent: work.recent,
      error: work.error ?? null,
      files: work.files,
      duplicates: work.duplicates,
    },
    tooling: {
      spent: round(tooling.spent, 4),
      sessions: tooling.sessions,
      tokens: tooling.tokens,
      messages: tooling.messages,
      models: tooling.models,
      pending: tooling.pending === true,
    },
    combined: round(spent + tooling.spent, 4),
    forecast,
    timeCreditMinutes,
    time: timeView(core, Date.now()),
    wrapup: core?.wrapup ?? null,
    tier2: core?.tier2 ?? null,
    limit,
    allowed: core?.allowed ?? true,
    paths: { claudeDir: fileConfig.claudeDir, statePath: CORE_STATE_PATH, configPath: CORE_CONFIG_PATH },
    hooks,
    ledger: {
      ready: core?.ledger?.ready ?? core !== null,
      updatedAt: core?.updatedAt ?? null,
      events: core?.ledger?.events ?? 0,
      mode: core?.ledger?.mode ?? 'unknown',
    },
    readOnly: false,
    settingsWritable: true,
    enforcement: hooks.installed === true,
  }
}

function getTooling(ctx, settings, cache) {
  const now = Date.now()
  if (cache.data !== null && now - cache.at < settings.refreshSeconds * 1000) {
    return { ...cache.data, pending: false }
  }
  if (cache.pending === null) {
    cache.pending = scanDsh(ctx, settings)
      .then((data) => {
        cache.data = data
        cache.at = Date.now()
        return data
      })
      .catch(() => {
        cache.data = { spent: 0, sessions: 0, tokens: 0, messages: 0, models: [], error: true }
        cache.at = Date.now()
        return cache.data
      })
      .finally(() => {
        cache.pending = null
      })
  }
  if (cache.data !== null) return { ...cache.data, pending: true }
  return { spent: 0, sessions: 0, tokens: 0, messages: 0, models: [], pending: true }
}

function coreWork(core) {
  return {
    ...core.work,
    files: core.scan?.files ?? 0,
    duplicates: core.scan?.duplicates ?? 0,
    error: null,
  }
}

function readCoreState() {
  try {
    const state = JSON.parse(fs.readFileSync(CORE_STATE_PATH, 'utf8'))
    if (state === null || typeof state !== 'object' || state.date !== todayKey() || state.work === undefined) return null
    return state
  } catch {
    return null
  }
}

function readHookStatus(core) {
  let settings = {}
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'))
  } catch {
    settings = {}
  }
  const hasOurHook = (groups) =>
    Array.isArray(groups) &&
    groups.some((group) =>
      Array.isArray(group?.hooks) &&
      group.hooks.some(
        (entry) =>
          typeof entry?.command === 'string' &&
          entry.command.includes('wb.mjs') &&
          entry.command.includes('workday-budget'),
      ),
    )
  const prompt = hasOurHook(settings.hooks?.UserPromptSubmit)
  const tools = hasOurHook(settings.hooks?.PreToolUse)
  const age = core !== null ? Date.now() - Number(core.updatedAt) : Number.POSITIVE_INFINITY
  return {
    installed: prompt && tools,
    prompt,
    tools,
    watch: core !== null && Number.isFinite(age) && age < 45_000,
    statusline:
      (typeof settings.statusLine?.command === 'string' && settings.statusLine.command.includes('wb.mjs')) ||
      ccstatuslineHasWb(),
  }
}

function ccstatuslineHasWb() {
  try {
    const config = JSON.parse(fs.readFileSync(CCSTATUSLINE_PATH, 'utf8'))
    if (!Array.isArray(config.lines)) return false
    return config.lines.some(
      (line) =>
        Array.isArray(line) &&
        line.some(
          (widget) =>
            widget?.type === 'custom-command' &&
            typeof widget.commandPath === 'string' &&
            (widget.commandPath.includes('wb.mjs') || widget.commandPath.includes('wb.cmd')) &&
            widget.commandPath.includes('statusline'),
        ),
    )
  } catch {
    return false
  }
}

function readCoreConfig(settings) {
  const defaults = {
    cap: settings.cap,
    calibration: settings.calibration,
    timeValueMinutesPerUnit: settings.timeValueMinutesPerUnit,
    standardWorkdayMinutes: DEFAULT_STANDARD_WORKDAY_MINUTES,
    claudeDir: settings.claudeDir,
    pricing: settings.pricing,
    peakWindows: settings.peakWindows,
    holidays: settings.holidays,
    wrapupCap: 0.5,
    wrapupMinutes: 30,
    tier2Cap: 20,
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CORE_CONFIG_PATH, 'utf8'))
    return {
      ...defaults,
      ...raw,
      pricing: {
        offPeak: { ...defaults.pricing.offPeak, ...(raw.pricing?.offPeak || {}) },
        peak: { ...defaults.pricing.peak, ...(raw.pricing?.peak || {}) },
      },
      peakWindows: Array.isArray(raw.peakWindows) ? raw.peakWindows : defaults.peakWindows,
      holidays: Array.isArray(raw.holidays) ? raw.holidays : defaults.holidays,
    }
  } catch {
    return defaults
  }
}

function validateSettings(input) {
  const errors = {}
  const value = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: { root: 'settings must be an object' }, value }
  }

  const readNumber = (field, min, max, integerOnly) => {
    if (input[field] === undefined) return
    const number = Number(input[field])
    if (!Number.isFinite(number) || number < min || number > max || (integerOnly && !Number.isInteger(number))) {
      errors[field] = `must be ${integerOnly ? 'integer ' : ''}between ${min} and ${max}`
      return
    }
    value[field] = number
  }
  readNumber('cap', 0.01, 10_000, false)
  readNumber('calibration', 0.01, 10, false)
  readNumber('timeValueMinutesPerUnit', 1, 1_440, false)

  if (input.pricing !== undefined) {
    if (input.pricing === null || typeof input.pricing !== 'object' || Array.isArray(input.pricing)) {
      errors.pricing = 'must be an object'
    } else {
      const pricing = { offPeak: {}, peak: {} }
      for (const group of ['offPeak', 'peak']) {
        const source = input.pricing[group]
        if (source === undefined) continue
        if (source === null || typeof source !== 'object' || Array.isArray(source)) {
          errors[`pricing.${group}`] = 'must be an object'
          continue
        }
        for (const field of ['cacheHit', 'cacheMiss', 'output']) {
          if (source[field] === undefined) continue
          const number = Number(source[field])
          if (!Number.isFinite(number) || number < 0 || number > 10_000) {
            errors[`pricing.${group}.${field}`] = 'must be between 0 and 10000'
            continue
          }
          pricing[group][field] = number
        }
      }
      if (Object.keys(pricing.offPeak).length + Object.keys(pricing.peak).length > 0) value.pricing = pricing
      else errors.pricing = 'no price fields provided'
    }
  }

  if (input.peakWindows !== undefined) {
    if (!Array.isArray(input.peakWindows) || input.peakWindows.length === 0) {
      errors.peakWindows = 'must be a non-empty array'
    } else {
      const windows = []
      input.peakWindows.forEach((window, index) => {
        if (!Array.isArray(window) || window.length !== 2) {
          errors[`peakWindows.${index}`] = 'must be [start, end]'
          return
        }
        const start = Number(window[0])
        const end = Number(window[1])
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) {
          errors[`peakWindows.${index}`] = 'must be integers with 0 <= start < end <= 24'
          return
        }
        windows.push([start, end])
      })
      if (windows.length > 0) value.peakWindows = windows
    }
  }

  if (input.holidays !== undefined) {
    if (!Array.isArray(input.holidays)) {
      errors.holidays = 'must be an array of YYYY-MM-DD'
    } else {
      const holidays = []
      input.holidays.forEach((item, index) => {
        if (typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item) || Number.isNaN(Date.parse(`${item}T00:00:00Z`))) {
          errors[`holidays.${index}`] = 'must be YYYY-MM-DD'
          return
        }
        if (!holidays.includes(item)) holidays.push(item)
      })
      if (holidays.length > 0 || input.holidays.length === 0) value.holidays = holidays
    }
  }

  if (Object.keys(value).length === 0 && Object.keys(errors).length === 0) errors.root = 'no supported settings'
  return { errors, value }
}

function mergeSettings(before, value) {
  const next = { ...before }
  for (const field of ['cap', 'calibration', 'timeValueMinutesPerUnit', 'peakWindows', 'holidays']) {
    if (value[field] !== undefined) next[field] = value[field]
  }
  if (value.pricing !== undefined) {
    next.pricing = {
      offPeak: { ...before.pricing.offPeak, ...(value.pricing.offPeak || {}) },
      peak: { ...before.pricing.peak, ...(value.pricing.peak || {}) },
    }
  }
  return next
}

function writeCoreConfig(next, before, value) {
  fs.mkdirSync(CORE_DIR, { recursive: true })
  try {
    fs.copyFileSync(CORE_CONFIG_PATH, path.join(CORE_DIR, `config.json.bak-${Date.now()}`))
  } catch {
    /* first write */
  }
  const temp = `${CORE_CONFIG_PATH}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(temp, CORE_CONFIG_PATH)

  const changes = {}
  for (const field of ['cap', 'calibration', 'timeValueMinutesPerUnit', 'pricing', 'peakWindows', 'holidays']) {
    if (value[field] === undefined) continue
    const beforeValue = before[field]
    const afterValue = next[field]
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[field] = { from: beforeValue, to: afterValue }
    }
  }
  if (Object.keys(changes).length > 0) {
    fs.appendFileSync(
      CONFIG_CHANGES_PATH,
      JSON.stringify({ at: Date.now(), source: 'dsh-panel', changes }) + '\n',
      'utf8',
    )
  }
}

async function waitForConfig(value, beforeUpdatedAt) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await delay(100)
    const state = readCoreState()
    if (state === null || !(Number(state.updatedAt) > beforeUpdatedAt)) continue
    if (value.cap !== undefined && Number(state.cap) !== Number(value.cap)) continue
    if (value.calibration !== undefined && Number(state.calibration) !== Number(value.calibration)) continue
    if (value.timeValueMinutesPerUnit !== undefined && Number(state.timeValueMinutesPerUnit) !== Number(value.timeValueMinutesPerUnit)) continue
    return true
  }
  return false
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function scanClaude(settings) {
  const result = scanUsage({
    claudeDir: settings.claudeDir,
    calibration: settings.calibration,
    pricing: settings.pricing,
    peakWindows: settings.peakWindows,
    holidays: settings.holidays,
  })
  const error = result.files === 0 ? `未找到 Claude Code 会话日志：${settings.claudeDir}` : null
  return {
    spent: result.raw * settings.calibration,
    raw: result.raw,
    requests: result.requests,
    requestsTotal: result.requestsTotal,
    firstRequestAt: result.firstRequestAt,
    lastRequestAt: result.lastRequestAt,
    days: result.days,
    recent: result.recent,
    files: result.files,
    duplicates: result.duplicates,
    error,
  }
}

async function scanDsh(ctx, settings) {
  const records = await ctx.sessionQuery.listSessions()
  const limited = records.slice(0, settings.maxSessions)
  const today = todayKey()
  let spent = 0
  let tokens = 0
  let messages = 0
  const sessions = new Set()
  const models = new Map()

  const results = await mapLimit(limited, 3, async (record) => {
    try {
      const snapshot = await ctx.sessionQuery.readSession(record.header.id)
      return snapshot
    } catch {
      return null
    }
  })

  for (const snapshot of results) {
    if (snapshot === null) continue
    const sessionId = snapshot.session?.id
    const seen = new Set()
    for (const event of snapshot.events ?? []) {
      if (event.type !== 'assistant/message') continue
      const usage = event.data?.usage
      const id = event.data?.message?.id
      if (usage === undefined || usage === null || typeof id !== 'string' || seen.has(id)) continue
      seen.add(id)
      const bj = new Date((Number(event.time) || 0) + TZ_OFFSET_MS)
      if (bj.toISOString().slice(0, 10) !== today) continue
      const hit = number(usage.cacheReadTokens)
      const miss = number(usage.inputTokens)
      const out = number(usage.outputTokens)
      const peak = isPeak(bj, settings)
      const price = peak ? settings.pricing.peak : settings.pricing.offPeak
      spent += (hit * price.cacheHit + miss * price.cacheMiss + out * price.output) / 1_000_000
      tokens += hit + miss + out
      messages += 1
      if (sessionId) sessions.add(sessionId)
      const model = normalizeModel(event.data?.message?.source?.model)
      const current = models.get(model) ?? { model, messages: 0 }
      current.messages += 1
      models.set(model, current)
    }
  }

  return {
    spent,
    sessions: sessions.size,
    tokens,
    messages,
    models: [...models.values()].sort((left, right) => right.messages - left.messages),
  }
}

function buildDays(dayMap, calibration) {
  const result = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(Date.now() + TZ_OFFSET_MS - offset * 86_400_000).toISOString().slice(0, 10)
    const entry = dayMap.get(day)
    result.push({ day, label: day.slice(5), cost: round((entry?.cost ?? 0) * calibration, 4), requests: entry?.requests ?? 0 })
  }
  return result
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

function parseClaudeTimestamp(value) {
  const text = String(value).trim()
  if (text.length === 0) return null
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + TZ_OFFSET_MS)
  }
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
  let year, month, day, hour, minute, second
  if (match !== null) {
    year = +match[1]; month = +match[2]; day = +match[3]
    hour = +match[4]; minute = +match[5]; second = +match[6]
  } else {
    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (match === null) return null
    month = +match[1]; day = +match[2]; year = +match[3]
    hour = +match[4]; minute = +match[5]; second = +match[6]
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) + TZ_OFFSET_MS)
}

function isPeak(bj, settings) {
  const weekday = bj.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const day = bj.toISOString().slice(0, 10)
  if (settings.holidays.includes(day)) return false
  const hour = bj.getUTCHours()
  return settings.peakWindows.some(([from, to]) => hour >= from && hour < to)
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
  if (model === 'deepseek-v4-flash') return 'deepseek-flash'
  return model
}

function todayKey() {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

function formatTime(ts) {
  const bj = new Date(ts)
  return `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function forecastLabel(spent, remaining, cap) {
  if (spent <= 0 || cap <= 0) return null
  const now = Date.now()
  const bj = new Date(now + TZ_OFFSET_MS)
  const elapsedMs = (bj.getUTCHours() * 3600 + bj.getUTCMinutes() * 60 + bj.getUTCSeconds()) * 1000
  if (elapsedMs < 60_000) return null
  const rate = spent / elapsedMs
  if (rate <= 0) return null
  const at = now + remaining / rate
  const atBj = new Date(at + TZ_OFFSET_MS)
  if (atBj.toISOString().slice(0, 10) !== bj.toISOString().slice(0, 10)) return '今天用不完'
  return `${pad(atBj.getUTCHours())}:${pad(atBj.getUTCMinutes())}`
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function mapLimit(items, limit, operation) {
  const result = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      result[index] = await operation(items[index], index)
    }
  })
  await Promise.all(workers)
  return result
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress
  return address === undefined || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}
