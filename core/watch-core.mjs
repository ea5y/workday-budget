/**
 * Watcher lifecycle: single instance, PID/identity checks, heartbeat, log
 * rotation and per-user autostart. The watcher is intentionally separate from
 * the DSH plugin so Claude Code hooks and the statusline keep working when DSH
 * is closed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export function paths(dataDir) {
  return {
    pid: path.join(dataDir, 'watch.pid'),
    info: path.join(dataDir, 'watch.json'),
    lock: path.join(dataDir, 'watch.lock'),
    stop: path.join(dataDir, 'watch.stop'),
    log: path.join(dataDir, 'logs', 'watch.log'),
    startup: path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    vbs: path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'workday-budget-watch.vbs'),
  }
}

export function watchStatus(dataDir, scriptPath) {
  const p = paths(dataDir)
  const info = readJson(p.info)
  const pidFile = readNumber(p.pid)
  const pid = Number(info?.pid || pidFile || 0)
  const alive = pid > 0 && processAlive(pid)
  const command = alive ? commandLine(pid) : ''
  const commandMatches = command.length > 0
    ? command.includes('wb.mjs') && command.includes('watch')
    : Boolean(info?.script && info.script === scriptPath)
  const running = alive && commandMatches
  let stateAgeSeconds = null
  try {
    stateAgeSeconds = Math.round((Date.now() - fs.statSync(path.join(dataDir, 'state.json')).mtimeMs) / 1000)
  } catch {}
  return {
    running,
    pid: pid || null,
    alive,
    identity: commandMatches,
    startedAt: info?.startedAt || null,
    lastTick: info?.lastTick || null,
    node: info?.node || null,
    script: info?.script || null,
    stateAgeSeconds,
    log: p.log,
    pidFile: fs.existsSync(p.pid),
    infoFile: info !== null,
  }
}

export function acquireWatcher(dataDir, scriptPath) {
  const p = paths(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  try { fs.rmSync(p.stop, { force: true }) } catch {}
  const current = watchStatus(dataDir, scriptPath)
  if (current.running) return { ok: false, already: true, status: current }
  cleanupStale(p)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(p.lock, 'wx')
      const info = {
        pid: process.pid,
        startedAt: Date.now(),
        lastTick: Date.now(),
        node: process.execPath,
        script: scriptPath,
        log: p.log,
      }
      fs.writeFileSync(handle, JSON.stringify(info))
      fs.writeFileSync(p.pid, String(process.pid), 'utf8')
      fs.writeFileSync(p.info, JSON.stringify(info, null, 2), 'utf8')
      return {
        ok: true,
        already: false,
        status: watchStatus(dataDir, scriptPath),
        release: () => releaseWatcher(dataDir, process.pid),
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      cleanupStale(p)
    }
  }
  return { ok: false, already: true, status: watchStatus(dataDir, scriptPath) }
}

export function heartbeat(dataDir, state) {
  const p = paths(dataDir)
  const info = readJson(p.info)
  if (!info || Number(info.pid) !== process.pid) return
  const next = {
    ...info,
    lastTick: Date.now(),
    stateUpdatedAt: state?.updatedAt || null,
    statusline: state?.statusline || null,
  }
  writeJsonAtomic(p.info, next)
}

export function appendWatchLog(dataDir, message) {
  const p = paths(dataDir)
  fs.mkdirSync(path.dirname(p.log), { recursive: true })
  rotateLog(p.log, 1_000_000, 3)
  fs.appendFileSync(p.log, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
}

export function stopWatcher(dataDir, scriptPath) {
  const p = paths(dataDir)
  const status = watchStatus(dataDir, scriptPath)
  try { fs.writeFileSync(p.stop, String(Date.now()), 'utf8') } catch {}
  if (!status.alive) {
    cleanupStale(p)
    return { ok: true, stopped: false, status }
  }
  if (!status.identity) {
    return { ok: false, stopped: false, status, message: `PID ${status.pid} 不是 wb watcher，未终止` }
  }
  try {
    process.kill(status.pid)
  } catch (error) {
    if (error?.code !== 'ESRCH') return { ok: false, stopped: false, status, message: error.message }
  }
  for (let attempt = 0; attempt < 20 && processAlive(status.pid); attempt += 1) sleep(50)
  if (processAlive(status.pid)) {
    try { process.kill(status.pid, 'SIGKILL') } catch {}
    for (let attempt = 0; attempt < 10 && processAlive(status.pid); attempt += 1) sleep(50)
  }
  cleanupStale(p)
  return { ok: true, stopped: true, status }
}

export function autostartStatus() {
  const p = paths(DATA_DIR_FALLBACK())
  let text = null
  try {
    text = fs.readFileSync(p.vbs, 'utf8')
  } catch {}
  return { installed: text !== null, path: p.vbs, command: text }
}

export function installAutostart(nodePath, scriptPath, launcherPath = '') {
  const p = paths(DATA_DIR_FALLBACK())
  fs.mkdirSync(p.startup, { recursive: true })
  const commandLines = launcherPath
    ? [
        `launcher = "${escapeVbs(launcherPath)}"`,
        'command = Chr(34) & launcher & Chr(34) & " watch"',
      ]
    : [
        `node = "${escapeVbs(nodePath)}"`,
        `script = "${escapeVbs(scriptPath)}"`,
        'command = Chr(34) & node & Chr(34) & " " & Chr(34) & script & Chr(34) & " watch"',
      ]
  const vbs = [
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set shell = CreateObject("WScript.Shell")',
    ...commandLines,
    `stopFile = "${escapeVbs(p.stop)}"`,
    'Do',
    '  code = shell.Run(command, 0, True)',
    '  If fso.FileExists(stopFile) Then',
    '    fso.DeleteFile stopFile, True',
    '    Exit Do',
    '  End If',
    '  If code = 2 Then Exit Do',
    '  WScript.Sleep 5000',
    'Loop',
    '',
  ].join('\r\n')
  fs.writeFileSync(p.vbs, vbs, 'utf8')
  return { installed: true, path: p.vbs, command: vbs }
}

export function uninstallAutostart() {
  const p = paths(DATA_DIR_FALLBACK())
  let removed = false
  try {
    if (fs.existsSync(p.vbs)) {
      fs.rmSync(p.vbs, { force: true })
      removed = true
    }
    return { installed: false, removed, path: p.vbs }
  } catch {
    return { installed: true, removed: false, path: p.vbs }
  }
}

function DATA_DIR_FALLBACK() {
  return process.env.WB_DATA_DIR || path.join(process.env.APPDATA || '', 'workbuddy')
}

function cleanupStale(p) {
  const info = readJson(p.info)
  const pid = Number(info?.pid || readNumber(p.pid) || 0)
  const alive = pid > 0 && processAlive(pid)
  if (!alive) {
    try { fs.rmSync(p.pid, { force: true }) } catch {}
    try { fs.rmSync(p.info, { force: true }) } catch {}
    try { fs.rmSync(p.lock, { force: true }) } catch {}
  }
}

function releaseWatcher(dataDir, pid) {
  const p = paths(dataDir)
  const info = readJson(p.info)
  if (info && Number(info.pid) !== Number(pid)) return
  try { fs.rmSync(p.pid, { force: true }) } catch {}
  try { fs.rmSync(p.info, { force: true }) } catch {}
  try { fs.rmSync(p.lock, { force: true }) } catch {}
}

function rotateLog(file, maxBytes, keep) {
  try {
    if (fs.statSync(file).size < maxBytes) return
  } catch {
    return
  }
  for (let index = keep - 1; index >= 1; index -= 1) {
    const from = `${file}.${index}`
    const to = `${file}.${index + 1}`
    try { fs.rmSync(to, { force: true }) } catch {}
    try { fs.renameSync(from, to) } catch {}
  }
  try { fs.renameSync(file, `${file}.1`) } catch {}
}

function processAlive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function commandLine(pid) {
  if (process.platform !== 'win32') {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
    } catch {
      return ''
    }
  }
  try {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){$p.CommandLine}`],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    )
    return (result.stdout || '').trim()
  } catch {
    return ''
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readNumber(file) {
  try {
    return Number(fs.readFileSync(file, 'utf8'))
  } catch {
    return 0
  }
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(temp, file)
}

function escapeVbs(value) {
  return String(value).replace(/"/g, '""')
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
