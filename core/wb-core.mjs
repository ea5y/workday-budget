#!/usr/bin/env node
// 工作日预算器 · 记账内核
// 只读 ~/.claude/projects 下的会话日志，算某一天的真实花费。
// 用法：
//   node wb-core.mjs --date 2026-10-28
//   node wb-core.mjs --date 2026-10-28 --json
//   node wb-core.mjs --check        // 退出码 0=正常 2=超额（给 hook 用）

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

// ── 计价（元 / 百万 token，来自平台账单反推）─────────────────────────
const PRICE = {
  hit: { peak: 0.04, off: 0.02 },
  miss: { peak: 2.0, off: 1.0 },
  out: { peak: 8.0, off: 4.0 },
}
const PEAK_HOURS = [[9, 12], [14, 18]]   // 北京时间，周一至周五

const CFG = {
  projectsDir: process.env.CLAUDE_PROJECTS_DIR
    || path.join(os.homedir(), '.claude', 'projects'),
  cap: Number(process.env.WB_CAP || 10),
  calibration: Number(process.env.WB_CALIBRATION || 1.14),
}

// ── 时间：日志里的 timestamp 是 UTC 但不带时区 ────────────────────────
function toBeijing(ts) {
  const s = String(ts)
  let y, mo, d, h, mi, sec
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3]; h = +m[4]; mi = +m[5]; sec = +m[6]
  } else {
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (!m) return null
    mo = +m[1]; d = +m[2]; y = +m[3]; h = +m[4]; mi = +m[5]; sec = +m[6]
  }
  // 按 UTC 解释，再 +8 小时
  return new Date(Date.UTC(y, mo - 1, d, h, mi, sec) + 8 * 3600 * 1000)
}

function isPeak(bj) {
  const dow = bj.getUTCDay()               // 用 UTC 字段读取「北京墙上时间」
  if (dow === 0 || dow === 6) return false
  const h = bj.getUTCHours()
  return PEAK_HOURS.some(([a, b]) => h >= a && h < b)
}

const dayKey = (bj) => bj.toISOString().slice(0, 10)

// ── 采集 ─────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

export function collect({ projectsDir = CFG.projectsDir } = {}) {
  const seen = new Set()
  const events = []
  let files = 0, lines = 0, dup = 0, bad = 0

  for (const file of walk(projectsDir)) {
    files++
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    const project = path.relative(projectsDir, file).split(path.sep)[0]
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue
      lines++
      let o
      try { o = JSON.parse(line) } catch { bad++; continue }
      const u = o?.message?.usage
      if (!u || !o.timestamp) continue
      const id = o.message.id
      if (id) { if (seen.has(id)) { dup++; continue } seen.add(id) }
      const bj = toBeijing(o.timestamp)
      if (!bj) continue
      const peak = isPeak(bj)
      const hit = u.cache_read_input_tokens || 0
      const miss = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      const out = u.output_tokens || 0
      const p = peak ? 'peak' : 'off'
      const cost = (hit * PRICE.hit[p] + miss * PRICE.miss[p] + out * PRICE.out[p]) / 1e6
      events.push({
        day: dayKey(bj), hour: bj.getUTCHours(), peak, project,
        model: o.message.model || 'unknown',
        hit, miss, out, cost, id,
      })
    }
  }
  return { events, stats: { files, lines, dup, bad } }
}

export function summarize(events, day) {
  const rows = events.filter((e) => e.day === day)
  const s = { day, requests: rows.length, hit: 0, miss: 0, out: 0, raw: 0, peak: 0 }
  for (const r of rows) {
    s.hit += r.hit; s.miss += r.miss; s.out += r.out; s.raw += r.cost
    if (r.peak) s.peak++
  }
  s.calibrated = s.raw * CFG.calibration
  return s
}

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const day = arg('--date', today)
  const { events, stats } = collect()
  const s = summarize(events, day)
  const pct = CFG.cap > 0 ? (s.calibrated / CFG.cap) * 100 : 0

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...s, cap: CFG.cap, calibration: CFG.calibration,
      remaining: Math.max(0, CFG.cap - s.calibrated), pct, stats }, null, 2))
  } else {
    console.log(`日期      ${day}`)
    console.log(`请求      ${s.requests}（峰时 ${s.peak}）`)
    console.log(`缓存命中  ${(s.hit / 1e6).toFixed(1)}M   未命中 ${(s.miss / 1e6).toFixed(2)}M   输出 ${(s.out / 1e6).toFixed(2)}M`)
    console.log(`原始估算  ¥${s.raw.toFixed(2)}`)
    console.log(`校准后    ¥${s.calibrated.toFixed(2)}  / ${CFG.cap.toFixed(2)}  (${pct.toFixed(1)}%)`)
    console.log(`剩余      ¥${Math.max(0, CFG.cap - s.calibrated).toFixed(2)}`)
    console.log(`扫描      ${stats.files} 文件 ${stats.lines} 行，去重 ${stats.dup} 条，坏行 ${stats.bad}`)
  }

  if (argv.includes('--check')) process.exit(s.calibrated >= CFG.cap ? 2 : 0)
}
