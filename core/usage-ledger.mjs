/**
 * Append-only usage ledger + per-file incremental offsets.
 *
 * `usage-log.jsonl` stores one normalized event per Claude message id.
 * `usage-cache.json` remembers how far each source file was consumed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { scanUsage, walkJsonl, eventFromRecord, projectEvents } from './usage-core.mjs'
import { withStateLock } from './time-core.mjs'

export function readLedger(ledgerPath) {
  const events = new Map()
  let bad = 0
  let lines = 0
  try {
    const text = fs.readFileSync(ledgerPath, 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      lines += 1
      try {
        const event = JSON.parse(line)
        if (typeof event?.id !== 'string' || !Number.isFinite(Number(event.ts))) {
          bad += 1
          continue
        }
        if (!events.has(event.id)) events.set(event.id, event)
      } catch {
        bad += 1
      }
    }
  } catch {
    /* missing ledger */
  }
  return { events, bad, lines }
}

export function scanIncremental(config, { ledgerPath, cachePath, now = Date.now() }) {
  return withStateLock(ledgerPath, () => {
    const ledger = readLedger(ledgerPath)
    const seen = new Set(ledger.events.keys())
    const files = walkJsonl(config.claudeDir)
    const cache = readCache(cachePath)
    const priorFiles = cache.files || {}
    const nextFiles = {}
    const appended = []
    let duplicates = ledger.bad
    let mode = ledger.lines > 0 ? 'incremental' : 'full'
    let full = null

    if (ledger.lines === 0 || Object.keys(priorFiles).length === 0) {
      // First run, or a cache reset: read once, then dedupe against the ledger.
      full = scanUsage(config, now)
      mode = ledger.lines === 0 ? 'full' : 'reconcile'
      duplicates += Number(full.duplicates) || 0
      for (const event of full.events) {
        if (seen.has(event.id)) {
          duplicates += 1
          continue
        }
        seen.add(event.id)
        appended.push(event)
      }
      for (const file of files) {
        try {
          const stat = fs.statSync(file)
          nextFiles[file] = { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino || 0, offset: stat.size, lines: 0 }
        } catch {}
      }
    } else {
      for (const file of files) {
        let stat
        try {
          stat = fs.statSync(file)
        } catch {
          continue
        }
        const previous = priorFiles[file]
        let offset = previous ? Number(previous.offset) || 0 : 0
        let lineBase = previous ? Number(previous.lines) || 0 : 0
        const changedInode = previous && previous.ino && stat.ino && Number(previous.ino) !== Number(stat.ino)
        const rewrittenSameSize = previous && stat.size === offset && Number(stat.mtimeMs) !== Number(previous.mtimeMs)
        if (previous && (stat.size < offset || changedInode || rewrittenSameSize)) {
          offset = 0
          lineBase = 0
        }
        if (!previous) {
          offset = 0
          lineBase = 0
        }
        if (offset < stat.size) {
          const chunk = readChunk(file, offset, stat.size)
          if (chunk.text.length > 0) {
            const projectDir = path.relative(config.claudeDir, file).split(path.sep)[0]
            let lineNo = lineBase
            for (const line of chunk.text.split('\n')) {
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
              appended.push(event)
            }
            offset += chunk.consumedBytes
            lineBase += chunk.lines
          }
        }
        nextFiles[file] = { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino || 0, offset, lines: lineBase }
      }
      // Files that disappeared keep no cache entry; their events remain in the ledger.
    }

    if (appended.length > 0) {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
      fs.appendFileSync(ledgerPath, appended.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8')
      for (const event of appended) ledger.events.set(event.id, event)
    }
    writeCache(cachePath, { version: 1, files: nextFiles })
    const events = [...ledger.events.values()]
    const projection = projectEvents(events, config, now)
    return {
      ...projection,
      events,
      files: files.length,
      duplicates,
      ledger: {
        events: events.length,
        appended: appended.length,
        bad: ledger.bad,
        mode,
        fullScanEvents: full?.events.length ?? 0,
      },
    }
  })
}

export function rebuildFromLedger(config, { ledgerPath, now = Date.now() }) {
  const ledger = readLedger(ledgerPath)
  const events = [...ledger.events.values()]
  return {
    ...projectEvents(events, config, now),
    events,
    files: 0,
    duplicates: ledger.bad,
    ledger: { events: events.length, appended: 0, bad: ledger.bad, mode: 'ledger' },
  }
}

export function rebuildFromSource(config, { ledgerPath, cachePath, now = Date.now() }) {
  return withStateLock(ledgerPath, () => {
    const full = scanUsage(config, now)
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    const temp = `${ledgerPath}.tmp-${process.pid}`
    fs.writeFileSync(temp, full.events.map((event) => JSON.stringify(event)).join('\n') + (full.events.length ? '\n' : ''), 'utf8')
    fs.renameSync(temp, ledgerPath)
    const files = {}
    for (const file of walkJsonl(config.claudeDir)) {
      try {
        const stat = fs.statSync(file)
        files[file] = { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino || 0, offset: stat.size, lines: 0 }
      } catch {}
    }
    writeCache(cachePath, { version: 1, files })
    return {
      ...full,
      ledger: { events: full.events.length, appended: full.events.length, bad: 0, mode: 'source' },
    }
  })
}

function readChunk(file, offset, size) {
  const length = size - offset
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(file, 'r')
  try {
    const read = fs.readSync(fd, buffer, 0, length, offset)
    const text = buffer.subarray(0, read).toString('utf8')
    const newline = text.lastIndexOf('\n')
    if (newline < 0) return { text: '', consumedBytes: 0, lines: 0 }
    const complete = text.slice(0, newline + 1)
    const lines = complete.split('\n').length - 1
    return { text: complete, consumedBytes: Buffer.byteLength(complete, 'utf8'), lines }
  } finally {
    fs.closeSync(fd)
  }
}

function readCache(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  } catch {
    return { version: 1, files: {} }
  }
}

function writeCache(cachePath, value) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  const temp = `${cachePath}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(temp, cachePath)
}
