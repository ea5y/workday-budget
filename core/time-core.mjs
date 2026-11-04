/**
 * Shared single-segment work-time model.
 *
 * T02 deliberately keeps one interval per day:
 *   startedAt -> endedAt
 * Reopen clears endedAt; an explicit --at replaces startedAt.
 * No work_sessions, no break subtraction.
 */
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_STANDARD_WORKDAY_MINUTES = 480
const TZ_OFFSET_MS = 8 * 3_600_000

export function dayKey(ms) {
  return new Date(Number(ms) + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

export function clock(ms) {
  const date = new Date(Number(ms) + TZ_OFFSET_MS)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

export function parseAt(value, now = Date.now()) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (match === null) return { error: 'time must be HH:MM' }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { error: 'time must be HH:MM' }
  }
  const local = new Date(Number(now) + TZ_OFFSET_MS)
  const ms = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute, 0) - TZ_OFFSET_MS
  if (ms > Number(now)) return { error: 'time cannot be in the future' }
  return { ms }
}

export function timeView(state, now = Date.now()) {
  const time = state?.time
  const standard = positive(time?.standardWorkdayMinutes, DEFAULT_STANDARD_WORKDAY_MINUTES)
  const credit = Math.max(0, Number(state?.cap) - Number(state?.work?.spent)) * Number(state?.timeValueMinutesPerUnit || 48)
  const base = {
    state: 'idle',
    startedAt: null,
    endedAt: null,
    wallClockMinutes: 0,
    todayGainMinutes: 0,
    standardWorkdayMinutes: standard,
    timeCreditMinutes: Math.round(credit),
    crossesMidnight: false,
    date: null,
  }
  if (!time || !(Number(time.startedAt) > 0)) return base

  const startedAt = Number(time.startedAt)
  const endedAt = Number.isFinite(Number(time.endedAt)) && Number(time.endedAt) > 0 ? Number(time.endedAt) : null
  const date = typeof time.date === 'string' ? time.date : dayKey(startedAt)
  if (endedAt === null) {
    const wallClockMinutes = Math.max(0, (Number(now) - startedAt) / 60_000)
    return {
      ...base,
      state: 'working',
      startedAt,
      endedAt: null,
      wallClockMinutes: roundMinutes(wallClockMinutes),
      todayGainMinutes: roundMinutes(Math.max(0, standard - wallClockMinutes)),
      crossesMidnight: dayKey(startedAt) !== dayKey(now),
      date,
    }
  }

  const wallClockMinutes = Number.isFinite(Number(time.wallClockMinutes))
    ? Number(time.wallClockMinutes)
    : Math.max(0, (endedAt - startedAt) / 60_000)
  return {
    ...base,
    state: 'finished',
    startedAt,
    endedAt,
    wallClockMinutes: roundMinutes(wallClockMinutes),
    todayGainMinutes: roundMinutes(Math.max(0, standard - wallClockMinutes)),
    crossesMidnight: time.crossesMidnight === true || dayKey(startedAt) !== dayKey(endedAt),
    date,
  }
}

export function applyStart(state, now = Date.now(), standard = DEFAULT_STANDARD_WORKDAY_MINUTES) {
  const time = state?.time
  if (time && Number(time.startedAt) > 0 && !(Number(time.endedAt) > 0)) {
    return { ok: true, idempotent: true, state, time: timeView(state, now) }
  }
  if (time && Number(time.endedAt) > 0) {
    return { ok: false, error: 'already_finished', message: '今天已经收工，请使用 reopen' }
  }
  const next = {
    ...state,
    time: {
      state: 'working',
      date: dayKey(now),
      startedAt: Number(now),
      endedAt: null,
      wallClockMinutes: 0,
      todayGainMinutes: roundMinutes(positive(standard, DEFAULT_STANDARD_WORKDAY_MINUTES)),
      standardWorkdayMinutes: positive(standard, DEFAULT_STANDARD_WORKDAY_MINUTES),
      crossesMidnight: false,
      reopenedAt: null,
    },
  }
  return { ok: true, idempotent: false, state: next, time: timeView(next, now) }
}

export function applyDone(state, now = Date.now(), standard = DEFAULT_STANDARD_WORKDAY_MINUTES) {
  const time = state?.time
  if (!time || !(Number(time.startedAt) > 0)) {
    return { ok: false, error: 'not_started', message: '今天还没有开工' }
  }
  if (Number(time.endedAt) > 0) {
    return { ok: true, idempotent: true, state, time: timeView(state, now) }
  }
  const startedAt = Number(time.startedAt)
  if (Number(now) <= startedAt) {
    return { ok: false, error: 'invalid_end', message: '收工时间必须晚于开工时间' }
  }
  const standardMinutes = positive(time.standardWorkdayMinutes, positive(standard, DEFAULT_STANDARD_WORKDAY_MINUTES))
  const wallClockMinutes = (Number(now) - startedAt) / 60_000
  const next = {
    ...state,
    time: {
      ...time,
      state: 'finished',
      endedAt: Number(now),
      wallClockMinutes: roundMinutes(wallClockMinutes),
      todayGainMinutes: roundMinutes(Math.max(0, standardMinutes - wallClockMinutes)),
      standardWorkdayMinutes: standardMinutes,
      crossesMidnight: dayKey(startedAt) !== dayKey(now),
    },
  }
  return { ok: true, idempotent: false, state: next, time: timeView(next, now) }
}

export function applyReopen(state, at, now = Date.now(), standard = DEFAULT_STANDARD_WORKDAY_MINUTES) {
  const time = state?.time
  if (!time || !(Number(time.startedAt) > 0)) {
    return { ok: false, error: 'not_started', message: '今天还没有开工' }
  }
  if (!(Number(time.endedAt) > 0)) {
    return { ok: true, idempotent: true, state, time: timeView(state, now) }
  }
  const selected = at !== null && at !== undefined && Number.isFinite(Number(at)) ? Number(at) : Number(time.startedAt)
  if (selected > Number(now)) {
    return { ok: false, error: 'future_start', message: '开工时间不能晚于当前时间' }
  }
  const standardMinutes = positive(time.standardWorkdayMinutes, positive(standard, DEFAULT_STANDARD_WORKDAY_MINUTES))
  const next = {
    ...state,
    time: {
      ...time,
      state: 'working',
      date: dayKey(selected),
      startedAt: selected,
      endedAt: null,
      wallClockMinutes: 0,
      todayGainMinutes: roundMinutes(standardMinutes),
      standardWorkdayMinutes: standardMinutes,
      crossesMidnight: false,
      reopenedAt: Number(now),
    },
  }
  return { ok: true, idempotent: false, state: next, time: timeView(next, now) }
}

export function splitSlices(startedAt, endedAt) {
  const slices = []
  let cursor = Number(startedAt)
  const end = Number(endedAt)
  while (cursor < end) {
    const date = dayKey(cursor)
    const [year, month, day] = date.split('-').map(Number)
    const nextMidnight = Date.UTC(year, month - 1, day + 1, 0, 0, 0) - TZ_OFFSET_MS
    const stop = Math.min(end, nextMidnight)
    slices.push({ date, minutes: roundMinutes((stop - cursor) / 60_000) })
    cursor = stop
  }
  return slices
}

export function mutateTimeState({ statePath, logPath, action, at = null, now = Date.now(), standardWorkdayMinutes = DEFAULT_STANDARD_WORKDAY_MINUTES, source = 'cli' }) {
  return withStateLock(statePath, () => {
    const state = readState(statePath)
    if (state === null) return { ok: false, error: 'missing_state', message: '找不到 state.json，请先运行 wb refresh' }
    const before = state.time ?? null
    const result =
      action === 'start'
        ? applyStart(state, now, standardWorkdayMinutes)
        : action === 'done'
          ? applyDone(state, now, standardWorkdayMinutes)
          : action === 'reopen'
            ? applyReopen(state, at, now, standardWorkdayMinutes)
            : { ok: false, error: 'unknown_action', message: `未知操作：${action}` }
    if (!result.ok) return result
    if (!result.idempotent) {
      writeStateAtomic(statePath, result.state)
      appendLog(logPath, {
        at: Number(now),
        action,
        source,
        atInput: at,
        before,
        after: result.time,
        slices: result.time.crossesMidnight ? splitSlices(result.time.startedAt, result.time.endedAt) : undefined,
      })
    }
    return { ...result, state: result.state, time: result.time }
  })
}

export function withStateLock(statePath, fn) {
  const release = acquireLock(`${statePath}.lock`, 2_500)
  try {
    return fn()
  } finally {
    release()
  }
}

function readState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function writeStateAtomic(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const temp = `${statePath}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(temp, statePath)
}

function appendLog(logPath, value) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify(value) + '\n', 'utf8')
  } catch {
    /* time log is best effort */
  }
}

function acquireLock(lockPath, timeoutMs) {
  const started = Date.now()
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  for (;;) {
    try {
      const handle = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(handle, String(process.pid), 'utf8')
      return () => {
        try {
          fs.closeSync(handle)
        } catch {}
        try {
          fs.rmSync(lockPath, { force: true })
        } catch {}
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const stat = fs.statSync(lockPath)
        if (Date.now() - stat.mtimeMs > 10_000) {
          fs.rmSync(lockPath, { force: true })
          continue
        }
      } catch {}
      if (Date.now() - started > timeoutMs) throw new Error('state busy')
      sleep(25)
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function roundMinutes(value) {
  return Math.round(Number(value) * 100) / 100
}
