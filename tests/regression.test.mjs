import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { priceEvent, scanUsage } from '../core/usage-core.mjs'

const BILLS = {
  '2026-10-27': 9.2931,
  '2026-10-28': 9.6441,
  '2026-10-29': 14.5311,
  '2026-10-30': 15.4354,
  '2026-10-31': 19.2297,
}

const CONFIG = {
  calibration: 1.14,
  pricing: {
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
  peakWindows: [[9, 12], [14, 18]],
  holidays: [],
}

test('five-day platform bill regression stays within ±8%', (t) => {
  const root = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects')
  if (!fs.existsSync(root)) {
    t.skip(`Claude Code log directory not found: ${root}`)
    return
  }

  const scan = scanUsage({ ...CONFIG, claudeDir: root })
  if (scan.events.length === 0) {
    t.skip('no Claude Code usage events found')
    return
  }

  let totalActual = 0
  let totalBill = 0
  for (const [day, bill] of Object.entries(BILLS)) {
    const events = scan.events.filter((event) => event.day === day)
    const raw = events.reduce((sum, event) => sum + priceEvent(event, CONFIG), 0)
    const calibrated = raw * CONFIG.calibration
    const deviation = (calibrated - bill) / bill
    assert.ok(
      Math.abs(deviation) <= 0.08,
      `${day}: calibrated ¥${calibrated.toFixed(2)} vs bill ¥${bill.toFixed(2)} (${(deviation * 100).toFixed(1)}%)`,
    )
    totalActual += calibrated
    totalBill += bill
    console.log(`${day} req=${events.length} raw=¥${raw.toFixed(2)} cal=¥${calibrated.toFixed(2)} bill=¥${bill.toFixed(2)} dev=${(deviation * 100).toFixed(1)}%`)
  }

  const totalDeviation = (totalActual - totalBill) / totalBill
  assert.ok(
    Math.abs(totalDeviation) <= 0.08,
    `total: calibrated ¥${totalActual.toFixed(2)} vs bill ¥${totalBill.toFixed(2)} (${(totalDeviation * 100).toFixed(1)}%)`,
  )
  console.log(`TOTAL cal=¥${totalActual.toFixed(2)} bill=¥${totalBill.toFixed(2)} dev=${(totalDeviation * 100).toFixed(1)}% files=${scan.files} dups=${scan.duplicates} events=${scan.events.length}`)
})
