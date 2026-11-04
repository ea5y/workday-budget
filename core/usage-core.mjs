/**
 * Single Claude Code usage calculator.
 *
 * Both the CLI and the DSH host fallback use this module. It parses Claude
 * JSONL records, normalizes one event per message id, and projects events into
 * today/recent/7-day aggregates with the current pricing config.
 *
 * Ledger events intentionally store tokens and timestamps, not price, so a
 * price or calibration change reprices history instead of freezing old rates.
 */
import fs from 'node:fs'
import path from 'node:path'

const TZ_OFFSET_MS = 8 * 3_600_000

export function todayKey(now = Date.now()) {
  return new Date(Number(now) + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

export function walkJsonl(root) {
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

export function parseTimestamp(value) {
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

export function isPeak(bj, config) {
  const weekday = bj.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const day = bj.toISOString().slice(0, 10)
  if ((config.holidays || []).includes(day)) return false
  const hour = bj.getUTCHours()
  return (config.peakWindows || [[9, 12], [14, 18]]).some(([from, to]) => hour >= from && hour < to)
}

export function projectName(record, fallback) {
  const cwd = typeof record?.cwd === 'string' ? record.cwd : ''
  if (cwd.length > 0) {
    const base = path.basename(cwd.replace(/[\\/]+$/, ''))
    if (base.length > 0) return base
  }
  return fallback || 'unknown'
}

export function normalizeModel(value) {
  const model = typeof value === 'string' && value.length > 0 ? value : 'unknown'
  return model === 'deepseek-v4-flash' ? 'deepseek-flash' : model
}

export function eventFromRecord(record, { file, line, projectDir, config }) {
  const usage = record?.message?.usage
  if (usage === undefined || usage === null || record.timestamp === undefined) return null
  const bj = parseTimestamp(record.timestamp)
  if (bj === null) return null
  const id = record.message?.id ?? record.uuid
  const key = id === undefined ? `${file}:${line}` : String(id)
  const hit = number(usage.cache_read_input_tokens)
  const miss = number(usage.input_tokens) + number(usage.cache_creation_input_tokens)
  const out = number(usage.output_tokens)
  const day = bj.toISOString().slice(0, 10)
  return {
    id: key,
    day,
    ts: bj.getTime(),
    hour: bj.getUTCHours(),
    minute: bj.getUTCMinutes(),
    hit,
    miss,
    out,
    tokens: hit + miss + out,
    model: normalizeModel(record.message?.model),
    project: projectName(record, projectDir),
    peak: isPeak(bj, config) ? 1 : 0,
    source: 'claude',
  }
}

export function priceEvent(event, config) {
  const peak = isPeak(new Date(Number(event.ts)), config)
  const price = peak ? config.pricing.peak : config.pricing.offPeak
  return (event.hit * price.cacheHit + event.miss * price.cacheMiss + event.out * price.output) / 1_000_000
}

export function scanUsage(config, now = Date.now()) {
  const root = config.claudeDir
  const files = walkJsonl(root)
  const seen = new Set()
  const events = []
  let duplicates = 0
  for (const file of files) {
    const projectDir = path.relative(root, file).split(path.sep)[0]
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
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
      const event = eventFromRecord(record, { file, line: lineNo, projectDir, config })
      if (event === null) continue
      if (seen.has(event.id)) {
        duplicates += 1
        continue
      }
      seen.add(event.id)
      events.push(event)
    }
  }
  return {
    ...projectEvents(events, config, now),
    events,
    files: files.length,
    duplicates,
  }
}

export function projectEvents(events, config, now = Date.now()) {
  const today = todayKey(now)
  const dayMap = new Map()
  const todayEvents = []
  for (const event of events) {
    const cost = priceEvent(event, config)
    const dayEntry = dayMap.get(event.day) || { day: event.day, raw: 0, requests: 0 }
    dayEntry.raw += cost
    dayEntry.requests += 1
    dayMap.set(event.day, dayEntry)
    if (event.day === today) todayEvents.push({ ...event, cost })
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
    const day = new Date(Number(now) + TZ_OFFSET_MS - offset * 86_400_000).toISOString().slice(0, 10)
    const entry = dayMap.get(day)
    days.push({
      day,
      label: day.slice(5),
      cost: round((entry?.raw ?? 0) * config.calibration, 4),
      requests: entry?.requests ?? 0,
    })
  }
  const timestamps = todayEvents.map((item) => item.ts)
  return {
    raw,
    requests: todayEvents.length,
    requestsTotal: events.length,
    firstRequestAt: timestamps.length ? formatTime(Math.min(...timestamps)) : null,
    lastRequestAt: timestamps.length ? formatTime(Math.max(...timestamps)) : null,
    days,
    recent,
  }
}

export function formatTime(ts) {
  const bj = new Date(ts)
  return `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
}

export function pad(value) {
  return String(value).padStart(2, '0')
}

export function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
