/**
 * Budget actions shared by the CLI and the DSH panel.
 * Keeps wrapup/tier2 state transitions identical in both entry points.
 */
import fs from 'node:fs'
import path from 'node:path'

const TZ_OFFSET_MS = 8 * 3_600_000

export const WRAPUP_CAP = 0.5
export const WRAPUP_MINUTES = 30
export const TIER2_CAP = 20
export const TIER2_MONTHLY_LIMIT = 4

export function mutateBudgetState({ statePath, logPath, action, reason = '', now = Date.now() }) {
  return withStateLock(statePath, () => {
    const state = readState(statePath)
    if (state === null) return { ok: false, error: 'missing_state', message: '找不到 state.json，请先运行 wb refresh' }
    const before = { wrapup: state.wrapup, tier2: state.tier2, limit: state.limit, allowed: state.allowed }
    const result =
      action === 'wrapup-on'
        ? applyWrapup(state, true, now)
        : action === 'wrapup-off'
          ? applyWrapup(state, false, now)
          : action === 'tier2-on'
            ? applyTier2(state, true, reason, now)
            : action === 'tier2-off'
              ? applyTier2(state, false, '', now)
              : { ok: false, error: 'unknown_action', message: `未知操作：${action}` }
    if (!result.ok) return result
    if (!result.idempotent) {
      writeStateAtomic(statePath, result.state)
      appendLog(logPath, {
        at: now,
        action,
        reason: reason || undefined,
        before,
        after: { wrapup: result.state.wrapup, tier2: result.state.tier2, limit: result.state.limit, allowed: result.state.allowed },
      })
    }
    return result
  })
}

export function applyWrapup(state, active, now = Date.now()) {
  const current = state.wrapup || {}
  if (active === true && current.active === true) {
    return { ok: true, idempotent: true, state, wrapup: current, limit: state.limit, allowed: state.allowed }
  }
  if (active === false && current.active !== true) {
    return { ok: true, idempotent: true, state, wrapup: current, limit: state.limit, allowed: state.allowed }
  }
  const cap = Number(current.cap) > 0 ? Number(current.cap) : WRAPUP_CAP
  const wrapup = active
    ? { active: true, until: Number(now) + WRAPUP_MINUTES * 60_000, cap }
    : { active: false, until: 0, cap }
  const tier2 = state.tier2 || {}
  const limit = (tier2.enabled === true ? Number(tier2.cap) || TIER2_CAP : Number(state.cap) || 0) + (active ? cap : 0)
  const allowed = Number(state.work?.spent) < limit
  const next = { ...state, wrapup, limit, allowed, statusline: statuslineText(state, limit) }
  return { ok: true, idempotent: false, state: next, wrapup, limit, allowed }
}

export function applyTier2(state, enabled, reason, now = Date.now()) {
  const current = state.tier2 || {}
  if (enabled === true && current.enabled === true) {
    return { ok: true, idempotent: true, state, tier2: current, limit: state.limit, allowed: state.allowed }
  }
  if (enabled === false && current.enabled !== true) {
    return { ok: true, idempotent: true, state, tier2: current, limit: state.limit, allowed: state.allowed }
  }

  const wrapup = state.wrapup || {}
  const cap = Number(state.cap) || 0
  if (enabled === true) {
    const text = String(reason || '').trim()
    if (text.length === 0) return { ok: false, error: 'reason_required', message: '二级上限需要一句理由' }
    const month = monthKey(now)
    const count = current.month === month ? Number(current.count) || 0 : 0
    if (count >= TIER2_MONTHLY_LIMIT) {
      return { ok: false, error: 'monthly_limit', message: `本月二级上限已使用 ${TIER2_MONTHLY_LIMIT} 次` }
    }
    const tier2 = { enabled: true, cap: TIER2_CAP, reason: text, month, count: count + 1 }
    const limit = TIER2_CAP
    const spent = Number(state.work?.spent) || 0
    const workState = spent >= TIER2_CAP ? 'TIER2_LOCKED' : spent >= TIER2_CAP * 0.9 ? 'TIER2_WARN' : 'TIER2'
    const next = { ...state, tier2, limit, allowed: spent < limit, work: { ...state.work, state: workState }, statusline: statuslineText(state, limit) }
    return { ok: true, idempotent: false, state: next, tier2, limit, allowed: next.allowed }
  }

  const limit = cap + (wrapup.active === true ? Number(wrapup.cap) || WRAPUP_CAP : 0)
  const spent = Number(state.work?.spent) || 0
  const workState = spent >= cap ? 'LOCKED' : state.work?.pct >= 90 ? 'WINDDOWN' : state.work?.pct >= 70 ? 'WARN' : 'NORMAL'
  const next = {
    ...state,
    tier2: { ...current, enabled: false },
    limit,
    allowed: spent < limit,
    work: { ...state.work, state: workState },
    statusline: statuslineText(state, limit),
  }
  return { ok: true, idempotent: false, state: next, tier2: next.tier2, limit, allowed: next.allowed }
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
    /* budget log is best effort */
  }
}

function monthKey(now) {
  return new Date(Number(now) + TZ_OFFSET_MS).toISOString().slice(0, 7)
}

function statuslineText(state, limit) {
  return `work ${Number(state.work?.spent || 0).toFixed(2)}/${Number(limit).toFixed(2)}`
}

function withStateLock(statePath, fn) {
  const release = acquireLock(`${statePath}.lock`, 2_500)
  try {
    return fn()
  } finally {
    release()
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
