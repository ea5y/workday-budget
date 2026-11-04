/**
 * Workday Budget client — full-screen dashboard implementation of design v0.5.
 *
 * Registers a left-sidebar entry and the main panel. Reads one same-origin
 * snapshot from the Host (`/workday-budget/summary`); the Host owns all
 * calculation. This first version is read-only and clearly says so in the UI.
 */
window.__ModuleLoader__.load({
  id: '@local/workday-budget',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo } = React
    const NS = 'workdayBudget'
    const PANEL_ID = 'workday-budget'
    const SUMMARY_URL = '/workday-budget/summary'
    const SETTINGS_URL = '/workday-budget/settings'
    const TIME_URL = '/workday-budget/time'
    const BUDGET_URL = '/workday-budget/budget'

    const zh = {
      panel: '预算',
      title: '工作日预算',
      subtitle: '把今天的工作当成一笔 ¥10 的硬预算',
      start: '开工',
      finish: '收工',
      started: '已开工',
      finished: '已收工',
      reopen: '重新开工',
      wallClock: '墙钟',
      todayGain: '今日收益',
      wrapup: '开始收尾',
      wrapupOff: '关闭收尾',
      wrapupActive: '收尾中',
      tier2: '二级上限',
      tier2Off: '关闭 · 本月 0 / 4 次',
      tier2On: '二级已开启',
      tier2Active: '二级上限',
      tier2OffAction: '关闭二级',
      notStarted: '今日未开工',
      settings: '设置',
      'state.NORMAL': 'NORMAL',
      'state.WARN': 'WARN',
      'state.WINDDOWN': 'WINDDOWN',
      'state.LOCKED': 'LOCKED',
      'state.TIER2': 'TIER2',
      'state.TIER2_WARN': 'TIER2 WARN',
      'state.TIER2_LOCKED': 'TIER2 LOCKED',
      'state.WRAPUP': 'WRAPUP',
      'hero.normal': '今日工作账本 · 计入 ¥{cap} 预算',
      'hero.warn': 'WARN · 还剩 ¥{left}，建议先砍范围',
      'hero.winddown': 'WINDDOWN · 进入收尾，不再开新任务',
      'hero.locked': 'LOCKED · 今天的额度用完了，下一次请求将被拒绝',
      'hero.wrapup': 'WRAPUP · 还可用 ¥{left} / 上限 ¥{limit}',
      'hero.tier2': 'TIER2 · 二级上限 ¥20 已开启',
      'hero.tier2Warn': 'TIER2 WARN · 接近 ¥20 上限',
      'hero.tier2Locked': 'TIER2 LOCKED · 二级上限也用完了',
      remaining: '剩余',
      over: '超出',
      usedUp: '已用完',
      forecastAt: '按当前速度 {time} 用完',
      forecastToday: '今天用不完',
      forecastNone: '按当前速度 —',
      free: '自由时间',
      raw: '原始 {raw} × {cal} 校准',
      requests: '{n} 次请求',
      budgetNote: '70% 提醒 · 90% 收尾 · 100% 锁定',
      hooksOff: '预算拦截未启用',
      workLedger: '工作账本 · Claude Code',
      toolLedger: '工具账本 · DSH',
      counted: '计入预算',
      notCounted: '不计入预算',
      onlyView: '仅展示',
      toolingSyncing: '首次读取 DSH 会话…',
      workSub: '{n} 次请求 · 原始 {raw} × {cal}',
      toolSub: '{sessions} 个会话 · {tokens} token',
      toolNote: '不影响 ¥{cap} 预算，只用于知道工具成本',
      combined: '合计 {total} · 其中仅工作账本 {work} 参与预算',
      trend: '近 7 天 · 工作账本',
      trendUnit: '单位 ¥ · 虚线为 ¥{cap} 上限',
      dailyAvg: '日均 {value}',
      weekTotal: '本周合计 {total} · {days} 天超过上限',
      todayRequests: '今日请求',
      viewAll: '展开全部 {n} 条 →',
      time: '时间',
      project: '项目 / 模型',
      cost: '成本',
      noRequests: '今天还没有 Claude Code 请求',
      settingsTitle: '设置',
      settingsNote: '面板可写 · 保存后写入 config.json 并热更新 wb',
      settingsNoteEnforced: '面板可写 · 预算拦截由 wb hooks 执行',
      budgetTime: '预算与时间',
      dailyBudget: '日预算',
      standardDay: '标准工作日',
      standardDayValue: '8 小时',
      timeValue: '时间当量',
      timeValueValue: '48 分钟 / 元',
      measure: '计量与校准',
      claudePath: 'Claude Code 路径',
      calibration: '校准系数',
      calibrationNote: '仅作用于 Claude Code',
      toolingOnly: 'DSH 工具账本',
      toolingOnlyNote: '不计入 ¥10 预算',
      price: '价目表（元 / 百万 token）',
      priceOff: '谷时',
      pricePeak: '峰时',
      cacheHit: '缓存命中',
      cacheMiss: '未命中输入',
      output: '输出',
      peakNote: '峰时：工作日 09:00–12:00 / 14:00–18:00',
      hooks: 'Claude Code hooks',
      notInstalled: '未安装',
      installed: '已安装',
      hooksOn: 'hooks 已安装',
      hooksOnNote: 'UserPromptSubmit + PreToolUse · wb watch 运行中',
      statuslineMerged: 'ccstatusline 已加入 work 组件',
      statuslineKept: '状态栏保留现有 ccstatusline',
      watchOffNote: 'hooks 已安装 · wb watch 未运行，下次请求会触发刷新',
      hooksNote: '预算拦截 / 状态栏尚未接入；当前只读',
      hooksEnforcedNote: '预算拦截由 wb hooks 执行；状态栏保留现有 ccstatusline',
      tier2: '二级上限',
      tier2Off: '关闭 · 本月 0 / 4 次',
      data: '数据',
      ledgerMissing: '账本未生成',
      ledgerReady: 'state.json 已连接 wb',
      ledgerReadyNote: '由 wb 核心写入；可 wb rebuild 重建',
      ledgerNote: '当前只读预览；wb 核心接入后生成 state.json',
      close: '关闭',
      saveSettings: '保存设置',
      cancel: '取消',
      confirmTitle: '确认修改',
      confirmNote: '将写入 config.json，并让 wb 重新计算今日预算。',
      confirmWrite: '确认写入',
      backToEdit: '返回修改',
      saving: '正在保存…',
      saved: '已保存并应用',
      savedPending: '已保存；等待 wb watcher 刷新（≤15s）',
      saveError: '保存失败',
      noChanges: '没有检测到修改',
      invalidSettings: '输入无效',
      peakLabel: '峰时窗口',
      peakHint: '格式：09:00-12:00,14:00-18:00（整点）',
      holidaysLabel: '节假日',
      holidaysHint: 'YYYY-MM-DD，逗号分隔；留空表示无',
      startToast: '手动开工将在下一版接入；当前以今日首请求为开工时间',
      finishToast: '收工记录尚未写入 wb state',
      startedToast: '已开工 {time}',
      finishedToast: '已收工 · 墙钟 {wall} · 今日收益 {gain}',
      reopenedToast: '已重新开工 {time}',
      timeError: '时间操作失败',
      finishTitle: '确认收工',
      finishNote: '确认后写入 wb state；单段区间，墙钟按开工到收工计算。',
      confirmFinish: '确认收工',
      reopenTitle: '重新开工',
      reopenNote: '单段模式：保留原开工，或改成所选时间；不会新增第二段。',
      reopenAt: '开工时间',
      reopenHint: '默认原开工；改时间会覆盖当天唯一一段的开工。',
      confirmReopen: '确认重新开工',
      wrapToast: '收尾：终端执行 wb wrapup（30 分钟 / ¥0.50）；按钮化下一版',
      tierToast: '二级上限：终端执行 wb tier2 --on "理由"；按钮化下一版',
      wrapupOnToast: '收尾已开启 · +¥0.50 / 30 分钟',
      wrapupOffToast: '收尾已关闭',
      tier2OnToast: '二级上限已开启 · ¥20',
      tier2OffToast: '二级上限已关闭',
      budgetError: '预算操作失败',
      tier2Title: '申请二级上限',
      tier2Note: '本月额度 {count} / 4 次 · 开启后上限 ¥20。',
      tier2Reason: '一句理由',
      tier2ReasonPlaceholder: '例如：客户临时加需求，今天必须交付',
      tier2EmptyReason: '请填写理由',
      tier2MonthlyFull: '本月 4 次额度已用完',
      confirmTier2: '确认开启',
      tier2OffNote: '开启后可到 ¥20；每月最多 4 次',
      summaryTitle: '今日收工',
      summaryNote: '收工摘要',
      spent: '工作花费',
      remainingLabel: '剩余额度',
      requestCount: '请求数',
      timeCredit: '可换自由时间',
      summaryFree: '约 {value}',
      footer: '预算拦截未启用 · 数据来自 Claude Code 日志 + DSH 会话 · 设置/时间可写',
      footerEnforced: '预算拦截已启用 · 数据来自 wb state + DSH 会话 · 设置/时间可写',
      files: '{n} 个日志文件',
      updated: '更新于 {time}',
      loading: '正在算今天的账…',
      loadingHint: '首次打开会扫描 Claude Code 会话日志，稍等几秒。',
      error: '暂时算不出来',
      retry: '重试',
      errorHint: '检查 Claude Code 日志路径或稍后重试。',
      claudeError: 'Claude Code 日志读取失败：{message}',
    }

    const en = {
      panel: 'Budget',
      title: 'Workday Budget',
      subtitle: 'A ¥10 hard budget for today’s work',
      start: 'Start',
      finish: 'Finish',
      started: 'Started',
      finished: 'Finished',
      reopen: 'Reopen',
      wallClock: 'Wall clock',
      todayGain: 'Today gain',
      wrapup: 'Start wrap-up',
      wrapupOff: 'Stop wrap-up',
      wrapupActive: 'Wrap-up',
      tier2: 'Tier-2 cap',
      tier2Off: 'Off · 0 / 4 this month',
      tier2On: 'Tier-2 on',
      tier2Active: 'Tier-2',
      tier2OffAction: 'Turn off tier-2',
      notStarted: 'Not started today',
      settings: 'Settings',
      'state.NORMAL': 'NORMAL',
      'state.WARN': 'WARN',
      'state.WINDDOWN': 'WINDDOWN',
      'state.LOCKED': 'LOCKED',
      'state.TIER2': 'TIER2',
      'state.TIER2_WARN': 'TIER2 WARN',
      'state.TIER2_LOCKED': 'TIER2 LOCKED',
      'state.WRAPUP': 'WRAPUP',
      'hero.normal': 'Work ledger · counted against ¥{cap}',
      'hero.warn': 'WARN · ¥{left} left, cut scope first',
      'hero.winddown': 'WINDDOWN · wrap up, no new tasks',
      'hero.locked': 'LOCKED · budget spent, the next request will be denied',
      'hero.wrapup': 'WRAPUP · ¥{left} left / limit ¥{limit}',
      'hero.tier2': 'TIER2 · ¥20 tier-2 cap is on',
      'hero.tier2Warn': 'TIER2 WARN · close to the ¥20 cap',
      'hero.tier2Locked': 'TIER2 LOCKED · tier-2 cap is spent too',
      remaining: 'Left',
      over: 'Over',
      usedUp: 'Used up',
      forecastAt: 'At this pace, spent by {time}',
      forecastToday: 'Won’t run out today',
      forecastNone: 'At this pace, —',
      free: 'Free time',
      raw: 'Raw {raw} × {cal}',
      requests: '{n} requests',
      budgetNote: '70% warn · 90% wrap-up · 100% lock',
      hooksOff: 'Budget enforcement is off',
      workLedger: 'Work ledger · Claude Code',
      toolLedger: 'Tooling ledger · DSH',
      counted: 'Counted',
      notCounted: 'Not counted',
      onlyView: 'Display only',
      toolingSyncing: 'Reading DSH sessions…',
      workSub: '{n} requests · raw {raw} × {cal}',
      toolSub: '{sessions} sessions · {tokens} tokens',
      toolNote: 'Does not affect the ¥{cap} budget',
      combined: 'Combined {total} · only the work ledger {work} counts',
      trend: 'Last 7 days · work ledger',
      trendUnit: 'CNY · dashed line is the ¥{cap} cap',
      dailyAvg: 'Daily avg {value}',
      weekTotal: '7-day total {total} · {days} days over cap',
      todayRequests: 'Today’s requests',
      viewAll: 'Show all {n} →',
      time: 'Time',
      project: 'Project / model',
      cost: 'Cost',
      noRequests: 'No Claude Code requests today',
      settingsTitle: 'Settings',
      settingsNote: 'Editable · saves to config.json and hot-reloads wb',
      settingsNoteEnforced: 'Editable · enforcement runs through wb hooks',
      budgetTime: 'Budget & time',
      dailyBudget: 'Daily budget',
      standardDay: 'Standard workday',
      standardDayValue: '8 h',
      timeValue: 'Time value',
      timeValueValue: '48 min / CNY',
      measure: 'Measurement & calibration',
      claudePath: 'Claude Code path',
      calibration: 'Calibration',
      calibrationNote: 'Claude Code only',
      toolingOnly: 'DSH tooling ledger',
      toolingOnlyNote: 'Not counted against ¥10',
      price: 'Prices (CNY / 1M tokens)',
      priceOff: 'Off-peak',
      pricePeak: 'Peak',
      cacheHit: 'Cached input',
      cacheMiss: 'Uncached input',
      output: 'Output',
      peakNote: 'Peak: weekdays 09:00–12:00 / 14:00–18:00',
      hooks: 'Claude Code hooks',
      notInstalled: 'Not installed',
      installed: 'Installed',
      hooksOn: 'hooks installed',
      hooksOnNote: 'UserPromptSubmit + PreToolUse · wb watch running',
      statuslineMerged: 'work widget added to ccstatusline',
      statuslineKept: 'existing ccstatusline preserved',
      watchOffNote: 'hooks installed · wb watch is not running; the next request triggers a refresh',
      hooksNote: 'Enforcement and statusline are not wired yet; read-only',
      hooksEnforcedNote: 'Enforcement runs through wb hooks; the existing ccstatusline is preserved',
      tier2: 'Tier-2 cap',
      tier2Off: 'Off · 0 / 4 this month',
      data: 'Data',
      ledgerMissing: 'Ledger not created',
      ledgerReady: 'state.json connected to wb',
      ledgerReadyNote: 'Written by wb core; rebuild with wb rebuild',
      ledgerNote: 'Read-only preview; state.json arrives with the wb core',
      close: 'Close',
      saveSettings: 'Save settings',
      cancel: 'Cancel',
      confirmTitle: 'Confirm changes',
      confirmNote: 'This writes config.json and asks wb to recompute today’s budget.',
      confirmWrite: 'Write changes',
      backToEdit: 'Back',
      saving: 'Saving…',
      saved: 'Saved and applied',
      savedPending: 'Saved; waiting for wb watch (≤15s)',
      saveError: 'Save failed',
      noChanges: 'No changes detected',
      invalidSettings: 'Invalid input',
      peakLabel: 'Peak windows',
      peakHint: 'Format: 09:00-12:00,14:00-18:00 (whole hours)',
      holidaysLabel: 'Holidays',
      holidaysHint: 'YYYY-MM-DD, comma separated; empty means none',
      startToast: 'Manual start arrives next; today uses the first request time',
      finishToast: 'The finish record is not written to wb state yet',
      startedToast: 'Started at {time}',
      finishedToast: 'Finished · wall clock {wall} · today gain {gain}',
      reopenedToast: 'Reopened at {time}',
      timeError: 'Time action failed',
      finishTitle: 'Finish today',
      finishNote: 'This writes the single interval to wb state; wall clock runs from start to finish.',
      confirmFinish: 'Confirm finish',
      reopenTitle: 'Reopen today',
      reopenNote: 'Single-interval mode: keep the original start, or replace it with the selected time. No second segment is added.',
      reopenAt: 'Start time',
      reopenHint: 'Defaults to the original start; changing it replaces the one start for today.',
      confirmReopen: 'Confirm reopen',
      wrapToast: 'Wrap-up: run wb wrapup (30 min / ¥0.50); the button arrives next',
      tierToast: 'Tier-2: run wb tier2 --on "reason"; the button arrives next',
      wrapupOnToast: 'Wrap-up on · +¥0.50 / 30 min',
      wrapupOffToast: 'Wrap-up off',
      tier2OnToast: 'Tier-2 cap on · ¥20',
      tier2OffToast: 'Tier-2 cap off',
      budgetError: 'Budget action failed',
      tier2Title: 'Request tier-2 cap',
      tier2Note: 'Monthly quota {count} / 4 · raises the cap to ¥20.',
      tier2Reason: 'One-line reason',
      tier2ReasonPlaceholder: 'e.g. client added a must-ship item today',
      tier2EmptyReason: 'Reason required',
      tier2MonthlyFull: 'Monthly quota of 4 is used up',
      confirmTier2: 'Turn on tier-2',
      tier2OffNote: 'Raises the cap to ¥20; at most 4 times per month',
      summaryTitle: 'Finish today',
      summaryNote: 'Finish summary',
      spent: 'Work spend',
      remainingLabel: 'Remaining',
      requestCount: 'Requests',
      timeCredit: 'Time credit',
      summaryFree: 'about {value}',
      footer: 'Enforcement off · Claude Code logs + DSH sessions · settings/time writable',
      footerEnforced: 'Enforcement on · wb state + DSH sessions · settings/time writable',
      files: '{n} log files',
      updated: 'Updated {time}',
      loading: 'Adding up today…',
      loadingHint: 'The first open scans Claude Code session logs; a few seconds.',
      error: 'Could not compute today',
      retry: 'Retry',
      errorHint: 'Check the Claude Code log path or try again.',
      claudeError: 'Claude Code log read failed: {message}',
    }

    const CSS = `
.wb-root { height:100%; overflow:auto; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-size:13px; line-height:1.5; }
.wb-inner { max-width:1280px; margin:0 auto; padding:24px 32px 36px; }
.wb-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:4px 0 20px; }
.wb-brand { display:flex; gap:14px; min-width:0; }
.wb-mark { flex:none; width:32px; height:32px; border-radius:9px; background:var(--dsw-alias-brand-primary); color:#fff; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:700; }
.wb-title { margin:0; font-size:20px; line-height:1.25; font-weight:700; letter-spacing:-.01em; }
.wb-sub { margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:10px; }
.wb-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; padding-top:1px; }
.wb-state { display:inline-flex; align-items:center; justify-content:center; min-width:78px; height:22px; padding:0 10px; border-radius:999px; font-size:9px; font-weight:700; letter-spacing:.04em; border:1px solid transparent; }
.wb-state.NORMAL { color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent); }
.wb-state.WARN, .wb-state.WINDDOWN { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, transparent); }
.wb-state.LOCKED { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent); }
.wb-state.TIER2 { color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent); }
.wb-state.TIER2_WARN { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, transparent); }
.wb-state.TIER2_LOCKED { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent); }
.wb-state.WRAPUP { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, transparent); }
.wb-chip { display:inline-flex; align-items:center; height:18px; padding:0 7px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-chip.warn { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); }
.wb-btn { appearance:none; height:30px; padding:0 14px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:11px; font-weight:600; cursor:pointer; transition:background .15s, border-color .15s; }
.wb-btn:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l2); }
.wb-btn:disabled { opacity:.45; cursor:not-allowed; }
.wb-btn:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.wb-btn.primary { background:var(--dsw-alias-brand-primary); border-color:transparent; color:#fff; }
.wb-btn.primary:hover { filter:brightness(1.05); background:var(--dsw-alias-brand-primary); }
.wb-btn.danger { background:var(--dsw-alias-state-error-primary); border-color:transparent; color:#fff; }
.wb-btn.ghost { background:transparent; }
.wb-card { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:16px; }
.wb-hero { position:relative; padding:22px 24px; min-height:196px; margin-bottom:12px; }
.wb-hero-label { font-size:10px; font-weight:600; color:var(--dsw-alias-label-secondary); }
.wb-hero-label.WARN, .wb-hero-label.WINDDOWN { color:var(--dsw-alias-state-warn-primary); }
.wb-hero-label.LOCKED { color:var(--dsw-alias-state-error-primary); }
.wb-hero-main { display:flex; align-items:flex-end; gap:10px; margin-top:8px; }
.wb-amount { font-size:44px; line-height:1; font-weight:700; letter-spacing:-.035em; font-variant-numeric:tabular-nums; }
.wb-cap { font-size:15px; color:var(--dsw-alias-label-secondary); font-weight:500; padding-bottom:4px; }
.wb-hero-right { position:absolute; right:24px; top:22px; width:340px; display:flex; flex-direction:column; align-items:flex-end; gap:6px; text-align:right; }
.wb-hero-right strong { font-size:24px; line-height:1.1; font-weight:700; letter-spacing:-.02em; }
.wb-hero-right .wb-small { font-size:10px; color:var(--dsw-alias-label-secondary); }
.wb-hero-right .wb-accent { font-size:10px; color:var(--dsw-alias-brand-primary); font-weight:600; }
.wb-hero-right .wb-faint { font-size:8px; color:var(--dsw-alias-label-secondary); opacity:.8; }
.wb-progress { margin-top:34px; position:relative; width:min(760px, 64%); }
.wb-track { height:10px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); overflow:hidden; }
.wb-fill { height:100%; border-radius:999px; background:var(--dsw-alias-brand-primary); transition:width .35s ease; }
.wb-fill.WARN, .wb-fill.WINDDOWN { background:var(--dsw-alias-state-warn-primary); }
.wb-fill.LOCKED { background:var(--dsw-alias-state-error-primary); }
.wb-fill.TIER2 { background:var(--dsw-alias-brand-primary); }
.wb-fill.TIER2_WARN { background:var(--dsw-alias-state-warn-primary); }
.wb-fill.TIER2_LOCKED { background:var(--dsw-alias-state-error-primary); }
.wb-fill.WRAPUP { background:var(--dsw-alias-state-warn-primary); }
.wb-mark-line { position:absolute; top:-5px; width:1px; height:20px; background:var(--dsw-alias-label-secondary); opacity:.45; }
.wb-progress-labels { display:flex; justify-content:space-between; margin-top:7px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-progress-labels b { color:var(--dsw-alias-brand-primary); font-weight:700; }
.wb-progress-note { margin-top:2px; color:var(--dsw-alias-label-secondary); font-size:8px; opacity:.85; }
.wb-hero-foot { margin-top:8px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-hero-actions { position:absolute; right:24px; bottom:20px; display:flex; gap:8px; }
.wb-sources { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; margin-bottom:12px; }
.wb-source { padding:18px 20px 16px; min-height:136px; position:relative; }
.wb-source-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.wb-source-title { font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wb-tag { flex:none; border-radius:999px; padding:2px 8px; font-size:8px; font-weight:600; border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary); }
.wb-tag.counted { color:var(--dsw-alias-brand-primary); border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.wb-tag.tool { color:var(--dsw-alias-state-success-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
.wb-source-amount { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; margin-top:10px; }
.wb-source-amount strong { font-size:24px; line-height:1; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.wb-source-pct { font-size:14px; font-weight:700; color:var(--dsw-alias-brand-primary); }
.wb-source-pct.tool { color:var(--dsw-alias-state-success-primary); font-size:10px; font-weight:600; }
.wb-source-sub { margin-top:10px; color:var(--dsw-alias-label-secondary); font-size:9px; }
.wb-mini { margin-top:10px; height:4px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); overflow:hidden; }
.wb-mini span { display:block; height:100%; border-radius:999px; background:var(--dsw-alias-brand-primary); }
.wb-combined { margin:-2px 0 12px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-lower { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr); gap:12px; }
.wb-chart-card { padding:18px 20px 14px; min-height:316px; }
.wb-panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.wb-panel-title { font-size:13px; font-weight:600; }
.wb-panel-sub { margin-top:2px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-panel-right { color:var(--dsw-alias-label-secondary); font-size:9px; text-align:right; }
.wb-bars { position:relative; height:150px; margin-top:14px; display:flex; align-items:flex-end; gap:6px; border-bottom:1px solid var(--dsw-alias-border-l1); padding:0 2px; }
.wb-bar-line { position:absolute; left:0; right:0; border-top:1px dashed var(--dsw-alias-state-error-primary); opacity:.7; pointer-events:none; }
.wb-barcol { flex:1; min-width:0; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; position:relative; }
.wb-bar-value { font-size:8px; color:var(--dsw-alias-label-secondary); height:12px; font-variant-numeric:tabular-nums; }
.wb-bar { width:100%; max-width:58px; min-height:2px; border-radius:4px 4px 2px 2px; background:var(--dsw-alias-brand-primary); }
.wb-bar.zero { background:var(--dsw-alias-bg-layer-2); }
.wb-bar.over { background:var(--dsw-alias-state-warn-primary); }
.wb-axis { display:flex; gap:6px; padding:6px 2px 0; }
.wb-axis span { flex:1; min-width:0; text-align:center; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-chart-foot { display:flex; justify-content:space-between; gap:12px; margin-top:10px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-req-card { padding:18px 20px 12px; min-height:316px; display:flex; flex-direction:column; }
.wb-req-head, .wb-req-row { display:grid; grid-template-columns:52px minmax(0,1fr) 58px; gap:8px; align-items:center; }
.wb-req-head { padding:10px 0 6px; border-bottom:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-req-head span:last-child { text-align:right; }
.wb-req-rows { flex:1; }
.wb-req-row { padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.wb-req-row:last-child { border-bottom:0; }
.wb-req-time { color:var(--dsw-alias-label-secondary); font-size:9px; font-variant-numeric:tabular-nums; }
.wb-req-main { min-width:0; }
.wb-req-project { font-size:10px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wb-req-model { margin-top:1px; color:var(--dsw-alias-label-secondary); font-size:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wb-req-cost { text-align:right; font-size:10px; font-weight:600; font-variant-numeric:tabular-nums; }
.wb-req-foot { margin-top:8px; color:var(--dsw-alias-brand-primary); font-size:8px; font-weight:600; }
.wb-empty { color:var(--dsw-alias-label-secondary); font-size:10px; text-align:center; padding:36px 0; }
.wb-footer { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 14px; margin-top:14px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-dot { display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--dsw-alias-state-success-primary); margin-right:5px; vertical-align:1px; }
.wb-banner { display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1)); border-radius:10px; padding:9px 12px; margin-bottom:12px; font-size:10px; }
.wb-overlay { position:fixed; inset:0; background:rgba(12,15,20,.45); z-index:40; }
.wb-drawer { position:fixed; top:0; right:0; bottom:0; width:440px; max-width:100vw; background:var(--dsw-alias-bg-layer-1); border-left:1px solid var(--dsw-alias-border-l1); z-index:41; overflow:auto; padding:24px; box-shadow:-18px 0 48px rgba(0,0,0,.18); }
.wb-drawer-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.wb-drawer-title { font-size:20px; font-weight:700; }
.wb-drawer-sub { margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-close { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary); font-size:20px; line-height:1; cursor:pointer; padding:2px 4px; }
.wb-section { margin-top:18px; }
.wb-section-title { font-size:10px; font-weight:600; padding-bottom:6px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.wb-field { padding:9px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.wb-field:last-child { border-bottom:0; }
.wb-field-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.wb-field-label { color:var(--dsw-alias-label-secondary); font-size:9px; }
.wb-field-input { width:132px; height:28px; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l1); border-radius:6px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; font-size:10px; text-align:right; padding:0 8px; }
.wb-field-input.wide { width:100%; text-align:left; }
.wb-field-input:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; border-color:transparent; }
.wb-price-edit { display:grid; grid-template-columns:minmax(0,1fr) 92px 92px; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.wb-price-edit:last-child { border-bottom:0; }
.wb-price-edit span { color:var(--dsw-alias-label-secondary); font-size:9px; }
.wb-price-edit input { width:100%; }
.wb-form-error { margin-top:8px; color:var(--dsw-alias-state-error-primary); font-size:9px; white-space:pre-wrap; }
.wb-save-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:18px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l1); }
.wb-save-status { font-size:9px; color:var(--dsw-alias-label-secondary); }
.wb-confirm { position:fixed; inset:0; z-index:70; background:rgba(12,15,20,.55); display:flex; align-items:center; justify-content:center; padding:24px; }
.wb-confirm-card { width:460px; max-width:100%; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:14px; padding:22px; box-shadow:0 24px 80px rgba(0,0,0,.3); }
.wb-confirm-title { font-size:18px; font-weight:700; }
.wb-confirm-note { margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:9px; }
.wb-change-list { margin-top:14px; border-top:1px solid var(--dsw-alias-border-l1); }
.wb-change-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--dsw-alias-border-l1); font-size:9px; }
.wb-change-row b { font-weight:600; font-variant-numeric:tabular-nums; }
.wb-confirm-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
.wb-krow { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.wb-krow:last-child { border-bottom:0; }
.wb-krow-label { color:var(--dsw-alias-label-secondary); font-size:9px; }
.wb-krow-value { font-size:9px; font-weight:500; text-align:right; max-width:230px; word-break:break-all; }
.wb-krow-note { margin-top:2px; color:var(--dsw-alias-label-secondary); font-size:8px; opacity:.8; }
.wb-warn { color:var(--dsw-alias-state-warn-primary); }
.wb-danger { color:var(--dsw-alias-state-error-primary); }
.wb-brand-text { color:var(--dsw-alias-brand-primary); }
.wb-success-text { color:var(--dsw-alias-state-success-primary); }
.wb-price-head, .wb-price-row { display:grid; grid-template-columns:minmax(0,1fr) 64px 64px; gap:8px; align-items:center; }
.wb-price-head { color:var(--dsw-alias-label-secondary); font-size:8px; padding:6px 0 4px; }
.wb-price-head span:not(:first-child) { text-align:right; }
.wb-price-row { padding:7px 0; font-size:9px; }
.wb-price-row span:not(:first-child) { text-align:right; font-variant-numeric:tabular-nums; }
.wb-modal { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(12,15,20,.45); }
.wb-modal-card { width:520px; max-width:100%; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:16px; padding:24px; box-shadow:0 24px 80px rgba(0,0,0,.22); }
.wb-modal-title { font-size:20px; font-weight:700; }
.wb-modal-note { margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:18px; }
.wb-summary-item { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:10px 12px; }
.wb-summary-item span { display:block; color:var(--dsw-alias-label-secondary); font-size:8px; }
.wb-summary-item b { display:block; margin-top:4px; font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; }
.wb-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
.wb-toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:80; max-width:520px; background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:9px 14px; font-size:10px; box-shadow:0 12px 40px rgba(0,0,0,.22); }
.wb-loading { min-height:420px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:var(--dsw-alias-label-secondary); }
.wb-loading strong { color:var(--dsw-alias-label-primary); font-size:13px; }
.wb-skeleton { height:10px; border-radius:6px; background:var(--dsw-alias-bg-layer-2); animation:wb-pulse 1.3s ease-in-out infinite; }
@keyframes wb-pulse { 0%,100% { opacity:.45; } 50% { opacity:.9; } }
@media (max-width:1000px) {
  .wb-hero-right { position:static; width:auto; align-items:flex-start; text-align:left; margin-top:14px; }
  .wb-hero-actions { position:static; margin-top:14px; }
  .wb-progress { width:100%; margin-top:18px; }
  .wb-lower { grid-template-columns:minmax(0,1fr); }
  .wb-chart-card, .wb-req-card { min-height:0; }
}
@media (max-width:700px) {
  .wb-inner { padding:18px 16px 28px; }
  .wb-head { flex-direction:column; gap:12px; }
  .wb-actions { justify-content:flex-start; }
  .wb-sources { grid-template-columns:minmax(0,1fr); }
  .wb-hero { padding:18px; }
  .wb-amount { font-size:38px; }
  .wb-summary-grid { grid-template-columns:minmax(0,1fr); }
}
`

    const fmtCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
    const fmtInt = new Intl.NumberFormat()

    function tr(t, key, params) {
      let text = t(key)
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.split('{' + name + '}').join(String(value))
        }
      }
      return text
    }
    function fmtMoney(value, digits) {
      const number = Number(value) || 0
      const places = digits ?? (Math.abs(number) >= 100 ? 0 : 2)
      return '¥' + number.toFixed(places)
    }
    function fmtTokens(value) {
      return fmtCompact.format(Number(value) || 0)
    }
    function fmtIntValue(value) {
      return fmtInt.format(Math.round(Number(value) || 0))
    }
    function fmtPct(value) {
      const number = Number(value) || 0
      return (number >= 10 ? number.toFixed(0) : number.toFixed(1)) + '%'
    }
    function fmtMinutes(total) {
      const minutes = Math.max(0, Math.round(Number(total) || 0))
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours === 0) return rest + 'm'
      return hours + 'h ' + String(rest).padStart(2, '0') + 'm'
    }
    function fmtTime(ms) {
      try {
        return new Intl.DateTimeFormat(undefined, {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ms))
      } catch {
        return '—'
      }
    }
    function dateLabel(date) {
      const parts = String(date || '').split('-')
      if (parts.length !== 3) return date || ''
      const value = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      try {
        return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', weekday: 'short' }).format(value)
      } catch {
        return date
      }
    }
    function shortPath(value) {
      const text = String(value || '')
      return text.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/u, '~').replace(/\\/g, '/')
    }
    function pctHeight(value, max, height) {
      if (!Number.isFinite(value) || value <= 0) return 2
      return Math.max(2, (value / max) * height)
    }
    function isOver(cost, cap) {
      return Number(cost) > Number(cap)
    }

    function Loading(props) {
      const { t } = props
      return h(
        'div',
        { className: 'wb-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'wb-inner' },
          h(
            'div',
            { className: 'wb-loading' },
            h('div', { className: 'wb-skeleton', style: { width: 180 } }),
            h('strong', null, t('loading')),
            h('span', { style: { fontSize: 10 } }, t('loadingHint')),
          ),
        ),
      )
    }

    function useSummary() {
      const [data, setData] = useState(null)
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState(null)
      const [nonce, setNonce] = useState(0)
      useEffect(() => {
        let alive = true
        let pendingTimer = null
        const load = async () => {
          try {
            const response = await fetch(SUMMARY_URL, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const next = await response.json()
            if (!alive) return
            setData(next)
            setStatus('ready')
            setError(null)
            if (next.tooling?.pending === true) {
              clearTimeout(pendingTimer)
              pendingTimer = setTimeout(() => {
                if (alive) setNonce((value) => value + 1)
              }, 1200)
            }
          } catch (failure) {
            if (!alive) return
            setStatus('error')
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        }
        load()
        const interval = setInterval(load, 30_000)
        return () => {
          alive = false
          clearTimeout(pendingTimer)
          clearInterval(interval)
        }
      }, [nonce])
      return { data, status, error, refresh: () => setNonce((value) => value + 1) }
    }

    function Header(props) {
      const { data, t, onStart, onFinish, onReopen, onSettings, timeBusy } = props
      const time = data.time || {}
      const working = time.state === 'working'
      const finished = time.state === 'finished'
      const badge = data.wrapup?.active === true ? 'WRAPUP' : data.work.state
      const timeLabel = working
        ? fmtTime(time.startedAt) + ' ' + t('start')
        : finished
          ? fmtTime(time.startedAt) + '–' + fmtTime(time.endedAt) + ' · ' + t('wallClock') + ' ' + fmtMinutes(time.wallClockMinutes)
          : t('notStarted')
      return h(
        'header',
        { className: 'wb-head' },
        h(
          'div',
          { className: 'wb-brand' },
          h('div', { className: 'wb-mark' }, '¥'),
          h(
            'div',
            { style: { minWidth: 0 } },
            h('h1', { className: 'wb-title' }, t('title')),
            h('div', { className: 'wb-sub' }, dateLabel(data.date) + ' · ' + timeLabel),
          ),
        ),
        h(
          'div',
          { className: 'wb-actions' },
          h('span', { className: 'wb-state ' + badge }, t('state.' + badge)),
          h(
            'button',
            { type: 'button', className: 'wb-btn ghost', onClick: onStart, disabled: timeBusy || working || finished },
            working ? t('started') : finished ? t('finished') : t('start'),
          ),
          h(
            'button',
            { type: 'button', className: 'wb-btn primary', onClick: onFinish, disabled: timeBusy || !working },
            finished ? t('finished') : t('finish'),
          ),
          finished
            ? h('button', { type: 'button', className: 'wb-btn', onClick: onReopen, disabled: timeBusy }, t('reopen'))
            : null,
          h('button', { type: 'button', className: 'wb-btn', onClick: onSettings }, t('settings')),
        ),
      )
    }

    function Hero(props) {
      const { data, t, onWrap, onTier, onTierOff } = props
      const work = data.work
      const state = work.state
      const wrapupActive = data.wrapup?.active === true
      const tier2Enabled = data.tier2?.enabled === true
      const effectiveLimit = Number(data.limit) > 0 ? Number(data.limit) : data.cap
      const left = Math.max(0, effectiveLimit - work.spent)
      const over = Math.max(0, work.spent - effectiveLimit)
      const progressPct = Number(work.effectivePct ?? (effectiveLimit > 0 ? (work.spent / effectiveLimit) * 100 : work.pct))
      const displayState = wrapupActive ? 'WRAPUP' : state
      const label = wrapupActive && state === 'LOCKED'
        ? tr(t, 'hero.wrapup', { left: fmtMoney(left), limit: fmtMoney(effectiveLimit) })
        : state === 'TIER2_LOCKED'
        ? t('hero.tier2Locked')
        : state === 'TIER2_WARN'
          ? t('hero.tier2Warn')
          : state === 'TIER2'
            ? t('hero.tier2')
            : state === 'LOCKED'
              ? t('hero.locked')
              : state === 'WINDDOWN'
                ? t('hero.winddown')
                : state === 'WARN'
                  ? tr(t, 'hero.warn', { left: fmtMoney(left), cap: fmtMoney(data.cap) })
                  : tr(t, 'hero.normal', { cap: fmtMoney(data.cap) })
      const forecast = data.forecast
        ? data.forecast === '今天用不完'
          ? t('forecastToday')
          : tr(t, 'forecastAt', { time: data.forecast })
        : t('forecastNone')
      const danger = state === 'LOCKED' || state === 'TIER2_LOCKED'
      const warn = state === 'WARN' || state === 'WINDDOWN' || state === 'TIER2_WARN'
      const showActions = danger || state === 'WINDDOWN' || tier2Enabled || wrapupActive
      return h(
        'section',
        { className: 'wb-card wb-hero' },
        h('div', { className: 'wb-hero-label ' + displayState }, label),
        h(
          'div',
          { className: 'wb-hero-main' },
          h('strong', { className: 'wb-amount' }, fmtMoney(work.spent)),
          h('span', { className: 'wb-cap' }, '/ ' + fmtMoney(effectiveLimit)),
        ),
        h(
          'div',
          { className: 'wb-hero-right' },
          h('strong', { className: danger ? 'wb-danger' : warn ? 'wb-warn' : 'wb-success-text' }, over > 0 ? tr(t, 'over', { n: '' }) + ' ' + fmtMoney(over) : t('remaining') + ' ' + fmtMoney(left)),
          h('span', { className: 'wb-small' }, forecast),
          h('span', { className: 'wb-accent' }, '≈ ' + fmtMinutes(data.timeCreditMinutes) + ' ' + t('free')),
          h('span', { className: 'wb-faint' }, t('todayGain') + ' ' + fmtMinutes(data.time?.todayGainMinutes || 0) + ' · ' + t('wallClock') + ' ' + fmtMinutes(data.time?.wallClockMinutes || 0)),
          wrapupActive
            ? h('span', { className: 'wb-chip warn' }, t('wrapupActive') + ' +¥' + Number(data.wrapup?.cap || 0.5).toFixed(2))
            : null,
          tier2Enabled
            ? h('span', { className: 'wb-chip' }, t('tier2Active') + ' ¥' + Number(data.tier2?.cap || 20).toFixed(0) + ' · ' + (data.tier2?.count || 0) + '/4')
            : null,
          h('span', { className: 'wb-faint' }, tr(t, 'raw', { raw: fmtMoney(work.raw), cal: data.calibration })),
        ),
        showActions
          ? h(
              'div',
              { className: 'wb-hero-actions' },
              h(
                'button',
                { type: 'button', className: 'wb-btn' + (wrapupActive ? '' : ' danger'), onClick: onWrap },
                wrapupActive ? t('wrapupOff') : t('wrapup'),
              ),
              tier2Enabled
                ? h('button', { type: 'button', className: 'wb-btn', onClick: onTierOff }, t('tier2OffAction'))
                : h('button', { type: 'button', className: 'wb-btn', onClick: onTier }, t('tier2')),
            )
          : null,
        h(
          'div',
          { className: 'wb-progress' },
          h(
            'div',
            { className: 'wb-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(100, Math.round(progressPct)) },
            h('div', { className: 'wb-fill ' + displayState, style: { width: Math.min(100, Math.max(0, progressPct)) + '%' } }),
          ),
          h('span', { className: 'wb-mark-line', style: { left: '70%' } }),
          h('span', { className: 'wb-mark-line', style: { left: '90%' } }),
          h(
            'div',
            { className: 'wb-progress-labels' },
            h('b', null, fmtPct(progressPct)),
            h('span', null, '70%'),
            h('span', null, '90%'),
            h('span', null, '100%'),
          ),
          h('div', { className: 'wb-progress-note' }, t('budgetNote')),
        ),
        h('div', { className: 'wb-hero-foot' }, 'Claude Code ' + tr(t, 'requests', { n: work.requests }) + ' · ' + (data.hooks.installed ? t('hooksOn') : t('hooksOff'))),
      )
    }

    function SourceCards(props) {
      const { data, t } = props
      const work = data.work
      const tool = data.tooling
      const toolPending = tool.pending === true
      const toolValue = toolPending && Number(tool.spent) === 0 ? '…' : fmtMoney(tool.spent)
      const toolSub = toolPending
        ? t('toolingSyncing')
        : tr(t, 'toolSub', { sessions: tool.sessions, tokens: fmtTokens(tool.tokens) })
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'wb-sources' },
          h(
            'section',
            { className: 'wb-card wb-source' },
            h(
              'div',
              { className: 'wb-source-head' },
              h('span', { className: 'wb-source-title' }, t('workLedger')),
              h('span', { className: 'wb-tag counted' }, t('counted')),
            ),
            h(
              'div',
              { className: 'wb-source-amount' },
              h('strong', null, fmtMoney(work.spent)),
              h('span', { className: 'wb-source-pct' }, fmtPct(work.effectivePct ?? work.pct)),
            ),
            h('div', { className: 'wb-source-sub' }, tr(t, 'workSub', { n: work.requests, raw: fmtMoney(work.raw), cal: data.calibration })),
            h('div', { className: 'wb-mini' }, h('span', { style: { width: Math.min(100, Math.max(0, work.pct)) + '%' } })),
          ),
          h(
            'section',
            { className: 'wb-card wb-source' },
            h(
              'div',
              { className: 'wb-source-head' },
              h('span', { className: 'wb-source-title' }, t('toolLedger')),
              h('span', { className: 'wb-tag tool' }, t('notCounted')),
            ),
            h(
              'div',
              { className: 'wb-source-amount' },
              h('strong', null, toolValue),
              h('span', { className: 'wb-source-pct tool' }, t('onlyView')),
            ),
            h('div', { className: 'wb-source-sub' }, toolSub),
            h('div', { className: 'wb-source-sub', style: { marginTop: 4 } }, tr(t, 'toolNote', { cap: fmtMoney(data.cap) })),
          ),
        ),
        h(
          'div',
          { className: 'wb-combined' },
          tr(t, 'combined', { total: fmtMoney(data.combined), work: fmtMoney(work.spent) }),
        ),
      )
    }

    function Trend(props) {
      const { data, t } = props
      const days = data.work.days || []
      const cap = data.cap
      const max = Math.max(cap, ...days.map((day) => Number(day.cost) || 0), 0.01)
      const sum = days.reduce((total, day) => total + (Number(day.cost) || 0), 0)
      const over = days.filter((day) => isOver(day.cost, cap)).length
      return h(
        'section',
        { className: 'wb-card wb-chart-card' },
        h(
          'div',
          { className: 'wb-panel-head' },
          h(
            'div',
            null,
            h('div', { className: 'wb-panel-title' }, t('trend')),
            h('div', { className: 'wb-panel-sub' }, tr(t, 'trendUnit', { cap: fmtMoney(cap) })),
          ),
          h('div', { className: 'wb-panel-right' }, tr(t, 'dailyAvg', { value: fmtMoney(sum / 7) })),
        ),
        h(
          'div',
          { className: 'wb-bars', role: 'img', 'aria-label': t('trend') },
          h('span', { className: 'wb-bar-line', style: { bottom: (cap / max) * 120 + 'px' } }),
          days.map((day) => {
            const cost = Number(day.cost) || 0
            const height = pctHeight(cost, max, 120)
            return h(
              'div',
              { className: 'wb-barcol', key: day.day, title: day.label + ' · ' + fmtMoney(cost) + ' · ' + tr(t, 'requests', { n: day.requests }) },
              h('div', { className: 'wb-bar-value' }, cost > 0 ? fmtMoney(cost) : '—'),
              h('div', { className: 'wb-bar ' + (cost > 0 ? (isOver(cost, cap) ? 'over' : '') : 'zero'), style: { height: height + 'px' } }),
            )
          }),
        ),
        h(
          'div',
          { className: 'wb-axis' },
          days.map((day) => h('span', { key: day.day }, day.label)),
        ),
        h(
          'div',
          { className: 'wb-chart-foot' },
          h('span', null, tr(t, 'weekTotal', { total: fmtMoney(sum), days: over })),
          h('span', null, '¥' + cap.toFixed(0)),
        ),
      )
    }

    function Recent(props) {
      const { data, t } = props
      const work = data.work
      return h(
        'section',
        { className: 'wb-card wb-req-card' },
        h(
          'div',
          { className: 'wb-panel-head' },
          h(
            'div',
            null,
            h('div', { className: 'wb-panel-title' }, t('todayRequests')),
            h('div', { className: 'wb-panel-sub' }, tr(t, 'requests', { n: work.requests })),
          ),
          h('div', { className: 'wb-panel-right' }, tr(t, 'viewAll', { n: work.requests })),
        ),
        h(
          'div',
          { className: 'wb-req-head' },
          h('span', null, t('time')),
          h('span', null, t('project')),
          h('span', null, t('cost')),
        ),
        work.recent.length === 0
          ? h('div', { className: 'wb-empty' }, t('noRequests'))
          : h(
              'div',
              { className: 'wb-req-rows' },
              work.recent.map((row, index) =>
                h(
                  'div',
                  { className: 'wb-req-row', key: index },
                  h('span', { className: 'wb-req-time' }, row.time),
                  h(
                    'div',
                    { className: 'wb-req-main' },
                    h('div', { className: 'wb-req-project' }, row.project || '—'),
                    h('div', { className: 'wb-req-model' }, row.model + ' · ' + fmtTokens(row.tokens) + ' token'),
                  ),
                  h('span', { className: 'wb-req-cost' }, fmtMoney(row.cost)),
                ),
              ),
            ),
      )
    }

    function KRow(props) {
      return h(
        'div',
        { className: 'wb-krow' },
        h(
          'div',
          null,
          h('div', { className: 'wb-krow-label' }, props.label),
          props.note ? h('div', { className: 'wb-krow-note' }, props.note) : null,
        ),
        h('div', { className: 'wb-krow-value ' + (props.tone || '') }, props.value),
      )
    }

    function initialSettings(data) {
      const config = data.config || {}
      const pricing = config.pricing || {}
      return {
        cap: Number(config.cap ?? data.cap),
        calibration: Number(config.calibration ?? data.calibration),
        timeValueMinutesPerUnit: Number(config.timeValueMinutesPerUnit ?? data.timeValueMinutesPerUnit),
        pricing: {
          offPeak: {
            cacheHit: Number(pricing.offPeak?.cacheHit ?? 0.02),
            cacheMiss: Number(pricing.offPeak?.cacheMiss ?? 1),
            output: Number(pricing.offPeak?.output ?? 4),
          },
          peak: {
            cacheHit: Number(pricing.peak?.cacheHit ?? 0.04),
            cacheMiss: Number(pricing.peak?.cacheMiss ?? 2),
            output: Number(pricing.peak?.output ?? 8),
          },
        },
        peakWindows: Array.isArray(config.peakWindows) && config.peakWindows.length > 0
          ? config.peakWindows
          : [[9, 12], [14, 18]],
        holidays: Array.isArray(config.holidays) ? config.holidays : [],
      }
    }

    function padHour(hour) {
      return String(hour).padStart(2, '0') + ':00'
    }

    function formatPeakWindows(windows) {
      return (windows || []).map(([from, to]) => `${padHour(from)}-${padHour(to)}`).join(', ')
    }

    function parsePeakWindows(value) {
      const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
      if (parts.length === 0) return { error: 'at least one peak window is required' }
      const windows = []
      for (const part of parts) {
        const match = part.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
        if (match === null) return { error: `invalid peak window: ${part}` }
        if (match[2] !== '00' || match[4] !== '00') return { error: 'peak windows must use whole hours' }
        const from = Number(match[1])
        const to = Number(match[3])
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 24 || from >= to) {
          return { error: `invalid peak window: ${part}` }
        }
        windows.push([from, to])
      }
      return { windows }
    }

    function parseHolidays(value) {
      const parts = String(value || '').split(/[\s,，]+/).map((part) => part.trim()).filter(Boolean)
      const holidays = []
      for (const part of parts) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(part) || Number.isNaN(Date.parse(`${part}T00:00:00Z`))) {
          return { error: `invalid holiday: ${part}` }
        }
        if (!holidays.includes(part)) holidays.push(part)
      }
      return { holidays }
    }

    function numberField(value, min) {
      if (String(value).trim() === '') return null
      const number = Number(value)
      return Number.isFinite(number) && number >= min ? number : null
    }

    function SettingsDrawer(props) {
      const { data, t, onClose, onSave } = props
      const initial = initialSettings(data)
      const [draft, setDraft] = useState(initial)
      const [peakText, setPeakText] = useState(formatPeakWindows(initial.peakWindows))
      const [holidaysText, setHolidaysText] = useState((initial.holidays || []).join(', '))
      const [errors, setErrors] = useState({})
      const [confirm, setConfirm] = useState(null)
      const [saving, setSaving] = useState(false)
      const [saveState, setSaveState] = useState(null)

      const setNumber = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
      const setPrice = (group, field, value) =>
        setDraft((current) => ({
          ...current,
          pricing: { ...current.pricing, [group]: { ...current.pricing[group], [field]: value } },
        }))

      const compile = () => {
        const nextErrors = {}
        const payload = {
          cap: numberField(draft.cap, 0.01),
          calibration: numberField(draft.calibration, 0.01),
          timeValueMinutesPerUnit: numberField(draft.timeValueMinutesPerUnit, 1),
          pricing: {
            offPeak: {
              cacheHit: numberField(draft.pricing.offPeak.cacheHit, 0),
              cacheMiss: numberField(draft.pricing.offPeak.cacheMiss, 0),
              output: numberField(draft.pricing.offPeak.output, 0),
            },
            peak: {
              cacheHit: numberField(draft.pricing.peak.cacheHit, 0),
              cacheMiss: numberField(draft.pricing.peak.cacheMiss, 0),
              output: numberField(draft.pricing.peak.output, 0),
            },
          },
        }
        if (payload.cap === null) nextErrors.cap = t('invalidSettings')
        if (payload.calibration === null) nextErrors.calibration = t('invalidSettings')
        if (payload.timeValueMinutesPerUnit === null) nextErrors.timeValue = t('invalidSettings')
        for (const group of ['offPeak', 'peak']) {
          for (const field of ['cacheHit', 'cacheMiss', 'output']) {
            if (payload.pricing[group][field] === null) nextErrors[`${group}.${field}`] = t('invalidSettings')
          }
        }
        const peak = parsePeakWindows(peakText)
        if (peak.error) nextErrors.peakWindows = peak.error
        else payload.peakWindows = peak.windows
        const holidays = parseHolidays(holidaysText)
        if (holidays.error) nextErrors.holidays = holidays.error
        else payload.holidays = holidays.holidays
        return { errors: nextErrors, payload }
      }

      const changeList = (payload) => {
        const changes = []
        if (payload.cap !== initial.cap) changes.push({ label: t('dailyBudget'), from: fmtMoney(initial.cap), to: fmtMoney(payload.cap) })
        if (payload.calibration !== initial.calibration) changes.push({ label: t('calibration'), from: '×' + initial.calibration, to: '×' + payload.calibration })
        if (payload.timeValueMinutesPerUnit !== initial.timeValueMinutesPerUnit) {
          changes.push({ label: t('timeValue'), from: initial.timeValueMinutesPerUnit + ' min', to: payload.timeValueMinutesPerUnit + ' min' })
        }
        for (const group of ['offPeak', 'peak']) {
          for (const field of ['cacheHit', 'cacheMiss', 'output']) {
            const before = initial.pricing[group][field]
            const after = payload.pricing[group][field]
            if (before !== after) {
              const groupLabel = group === 'offPeak' ? t('priceOff') : t('pricePeak')
              const fieldLabel = field === 'cacheHit' ? t('cacheHit') : field === 'cacheMiss' ? t('cacheMiss') : t('output')
              changes.push({ label: `${fieldLabel} · ${groupLabel}`, from: before.toFixed(2), to: after.toFixed(2) })
            }
          }
        }
        if (formatPeakWindows(payload.peakWindows) !== formatPeakWindows(initial.peakWindows)) {
          changes.push({ label: t('peakLabel'), from: formatPeakWindows(initial.peakWindows), to: formatPeakWindows(payload.peakWindows) })
        }
        if ((payload.holidays || []).join(',') !== (initial.holidays || []).join(',')) {
          changes.push({
            label: t('holidaysLabel'),
            from: (initial.holidays || []).join(', ') || '—',
            to: (payload.holidays || []).join(', ') || '—',
          })
        }
        return changes
      }

      const openConfirm = () => {
        const result = compile()
        setErrors(result.errors)
        setSaveState(null)
        if (Object.keys(result.errors).length > 0) return
        const changes = changeList(result.payload)
        if (changes.length === 0) {
          setSaveState({ ok: true, message: t('noChanges') })
          return
        }
        setConfirm({ payload: result.payload, changes })
      }

      const confirmSave = async () => {
        if (confirm === null) return
        setSaving(true)
        setSaveState(null)
        try {
          const result = await onSave(confirm.payload)
          setConfirm(null)
          setSaveState({ ok: true, message: result.applied ? t('saved') : t('savedPending') })
        } catch (error) {
          setConfirm(null)
          setSaveState({ ok: false, message: t('saveError') + '：' + (error instanceof Error ? error.message : String(error)) })
        } finally {
          setSaving(false)
        }
      }

      const field = (label, value, onChange, options = {}) =>
        h(
          'div',
          { className: 'wb-field' },
          h(
            'div',
            { className: 'wb-field-head' },
            h('span', { className: 'wb-field-label' }, label),
            h('input', {
              className: 'wb-field-input' + (options.wide ? ' wide' : ''),
              type: options.type || 'number',
              min: options.min,
              step: options.step || '0.01',
              value,
              onChange: (event) => onChange(event.target.value),
              'aria-label': label,
            }),
          ),
          options.error ? h('div', { className: 'wb-form-error' }, options.error) : null,
        )

      return h(
        React.Fragment,
        null,
        h('div', { className: 'wb-overlay', onClick: onClose }),
        h(
          'aside',
          { className: 'wb-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settingsTitle') },
          h(
            'div',
            { className: 'wb-drawer-head' },
            h(
              'div',
              null,
              h('div', { className: 'wb-drawer-title' }, t('settingsTitle')),
              h('div', { className: 'wb-drawer-sub' }, t(data.hooks.installed ? 'settingsNoteEnforced' : 'settingsNote')),
            ),
            h('button', { type: 'button', className: 'wb-close', onClick: onClose, 'aria-label': t('close') }, '×'),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('budgetTime')),
            field(t('dailyBudget'), draft.cap, (value) => setNumber('cap', value), { min: '0.01', error: errors.cap }),
            h(KRow, { label: t('standardDay'), value: t('standardDayValue') }),
            field(t('timeValue'), draft.timeValueMinutesPerUnit, (value) => setNumber('timeValueMinutesPerUnit', value), { min: '1', step: '1', error: errors.timeValue }),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('measure')),
            h(KRow, { label: t('claudePath'), value: shortPath(data.paths.claudeDir) }),
            field(t('calibration'), draft.calibration, (value) => setNumber('calibration', value), { min: '0.01', error: errors.calibration }),
            h(KRow, { label: t('toolingOnly'), value: t('onlyView'), note: t('toolingOnlyNote'), tone: 'wb-success-text' }),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('price')),
            h(
              'div',
              { className: 'wb-price-head' },
              h('span', null, ''),
              h('span', null, t('priceOff')),
              h('span', null, t('pricePeak')),
            ),
            h(
              'div',
              { className: 'wb-price-edit' },
              h('span', null, t('cacheHit')),
              h('input', { className: 'wb-field-input', type: 'number', min: '0', step: '0.01', value: draft.pricing.offPeak.cacheHit, onChange: (e) => setPrice('offPeak', 'cacheHit', e.target.value) }),
              h('input', { className: 'wb-field-input', type: 'number', min: '0', step: '0.01', value: draft.pricing.peak.cacheHit, onChange: (e) => setPrice('peak', 'cacheHit', e.target.value) }),
            ),
            errors['offPeak.cacheHit'] || errors['peak.cacheHit'] ? h('div', { className: 'wb-form-error' }, t('invalidSettings')) : null,
            h(
              'div',
              { className: 'wb-price-edit' },
              h('span', null, t('cacheMiss')),
              h('input', { className: 'wb-field-input', type: 'number', min: '0', step: '0.01', value: draft.pricing.offPeak.cacheMiss, onChange: (e) => setPrice('offPeak', 'cacheMiss', e.target.value) }),
              h('input', { className: 'wb-field-input', type: 'number', min: '0', step: '0.01', value: draft.pricing.peak.cacheMiss, onChange: (e) => setPrice('peak', 'cacheMiss', e.target.value) }),
            ),
            errors['offPeak.cacheMiss'] || errors['peak.cacheMiss'] ? h('div', { className: 'wb-form-error' }, t('invalidSettings')) : null,
            h(
              'div',
              { className: 'wb-price-edit' },
              h('span', null, t('output')),
              h('input', { className: 'wb-field-input', type: 'number', min: '0', step: '0.01', value: draft.pricing.offPeak.output, onChange: (e) => setPrice('offPeak', 'output', e.target.value) }),
              h('input', { className: 'wb-field-input', type: 'number', min: '0', step: '0.01', value: draft.pricing.peak.output, onChange: (e) => setPrice('peak', 'output', e.target.value) }),
            ),
            errors['offPeak.output'] || errors['peak.output'] ? h('div', { className: 'wb-form-error' }, t('invalidSettings')) : null,
            h('div', { className: 'wb-krow-note', style: { marginTop: 6 } }, t('peakNote')),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('peakLabel')),
            field(t('peakLabel'), peakText, setPeakText, { type: 'text', wide: true, error: errors.peakWindows }),
            h('div', { className: 'wb-krow-note' }, t('peakHint')),
            field(t('holidaysLabel'), holidaysText, setHolidaysText, { type: 'text', wide: true, error: errors.holidays }),
            h('div', { className: 'wb-krow-note' }, t('holidaysHint')),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('hooks')),
            h(KRow, {
              label: t('hooks'),
              value: data.hooks.installed ? t('installed') : t('notInstalled'),
              note: data.hooks.installed
                ? (data.hooks.watch ? t('hooksOnNote') : t('watchOffNote')) +
                  ' · ' +
                  (data.hooks.statusline ? t('statuslineMerged') : t('statuslineKept'))
                : t('hooksNote'),
              tone: data.hooks.installed ? 'wb-success-text' : 'wb-warn',
            }),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('tier2')),
            h(KRow, {
              label: t('tier2'),
              value: data.tier2?.enabled
                ? '¥' + Number(data.tier2.cap || 20).toFixed(0) + ' · ' + (data.tier2.count || 0) + '/4'
                : t('tier2Off'),
              note: data.tier2?.enabled ? data.tier2.reason : t('tier2OffNote'),
            }),
          ),
          h(
            'div',
            { className: 'wb-section' },
            h('div', { className: 'wb-section-title' }, t('data')),
            h(KRow, {
              label: data.ledger.ready ? t('ledgerReady') : t('ledgerMissing'),
              value: data.ledger.ready ? t('ledgerReadyNote') : t('ledgerNote'),
              note: t('footer'),
            }),
          ),
          Object.keys(errors).length > 0
            ? h('div', { className: 'wb-form-error' }, Object.values(errors).join(' · '))
            : null,
          h(
            'div',
            { className: 'wb-save-row' },
            h('span', { className: 'wb-save-status' }, saveState ? saveState.message : saving ? t('saving') : ''),
            h('button', { type: 'button', className: 'wb-btn', onClick: onClose }, t('cancel')),
            h('button', { type: 'button', className: 'wb-btn primary', disabled: saving, onClick: openConfirm }, t('saveSettings')),
          ),
        ),
        confirm !== null
          ? h(
              'div',
              { className: 'wb-confirm', onClick: (event) => { if (event.target === event.currentTarget) setConfirm(null) } },
              h(
                'div',
                { className: 'wb-confirm-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('confirmTitle') },
                h('div', { className: 'wb-confirm-title' }, t('confirmTitle')),
                h('div', { className: 'wb-confirm-note' }, t('confirmNote')),
                h(
                  'div',
                  { className: 'wb-change-list' },
                  confirm.changes.map((change, index) =>
                    h(
                      'div',
                      { className: 'wb-change-row', key: index },
                      h('span', null, change.label),
                      h('span', null, h('b', null, change.from), ' → ', h('b', null, change.to)),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'wb-confirm-actions' },
                  h('button', { type: 'button', className: 'wb-btn', onClick: () => setConfirm(null) }, t('backToEdit')),
                  h('button', { type: 'button', className: 'wb-btn primary', disabled: saving, onClick: confirmSave }, t('confirmWrite')),
                ),
              ),
            )
          : null,
      )
    }

    function FinishModal(props) {
      const { data, t, onClose, onConfirm, busy } = props
      const time = data.time || {}
      return h(
        'div',
        { className: 'wb-modal', onClick: (event) => { if (event.target === event.currentTarget && !busy) onClose() } },
        h(
          'div',
          { className: 'wb-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('summaryTitle') },
          h('div', { className: 'wb-modal-title' }, t('finishTitle')),
          h('div', { className: 'wb-modal-note' }, t('finishNote')),
          h(
            'div',
            { className: 'wb-summary-grid' },
            h('div', { className: 'wb-summary-item' }, h('span', null, t('spent')), h('b', null, fmtMoney(data.work.spent) + ' / ' + fmtMoney(Number(data.limit) > 0 ? data.limit : data.cap))),
            h('div', { className: 'wb-summary-item' }, h('span', null, t('remainingLabel')), h('b', null, fmtMoney(data.work.remaining))),
            h('div', { className: 'wb-summary-item' }, h('span', null, t('requestCount')), h('b', null, fmtIntValue(data.work.requests))),
            h('div', { className: 'wb-summary-item' }, h('span', null, t('timeCredit')), h('b', null, tr(t, 'summaryFree', { value: fmtMinutes(data.timeCreditMinutes) }))),
            h('div', { className: 'wb-summary-item' }, h('span', null, t('wallClock')), h('b', null, fmtMinutes(time.wallClockMinutes || 0))),
            h('div', { className: 'wb-summary-item' }, h('span', null, t('todayGain')), h('b', null, fmtMinutes(time.todayGainMinutes || 0))),
          ),
          h(
            'div',
            { className: 'wb-modal-actions' },
            h('button', { type: 'button', className: 'wb-btn', onClick: onClose, disabled: busy }, t('cancel')),
            h('button', { type: 'button', className: 'wb-btn primary', onClick: onConfirm, disabled: busy }, busy ? t('saving') : t('confirmFinish')),
          ),
        ),
      )
    }

    function ReopenModal(props) {
      const { data, t, onClose, onConfirm, busy } = props
      const startedAt = data.time?.startedAt || Date.now()
      const [at, setAt] = useState(fmtTime(startedAt))
      return h(
        'div',
        { className: 'wb-modal', onClick: (event) => { if (event.target === event.currentTarget && !busy) onClose() } },
        h(
          'div',
          { className: 'wb-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('reopenTitle') },
          h('div', { className: 'wb-modal-title' }, t('reopenTitle')),
          h('div', { className: 'wb-modal-note' }, t('reopenNote')),
          h(
            'div',
            { className: 'wb-field', style: { marginTop: 14 } },
            h(
              'div',
              { className: 'wb-field-head' },
              h('span', { className: 'wb-field-label' }, t('reopenAt')),
              h('input', {
                className: 'wb-field-input',
                type: 'time',
                value: at,
                onChange: (event) => setAt(event.target.value),
                'aria-label': t('reopenAt'),
              }),
            ),
            h('div', { className: 'wb-krow-note' }, t('reopenHint')),
          ),
          h(
            'div',
            { className: 'wb-modal-actions' },
            h('button', { type: 'button', className: 'wb-btn', onClick: onClose, disabled: busy }, t('cancel')),
            h('button', { type: 'button', className: 'wb-btn primary', onClick: () => onConfirm(at), disabled: busy || !at }, busy ? t('saving') : t('confirmReopen')),
          ),
        ),
      )
    }

    function Tier2Modal(props) {
      const { data, t, onClose, onConfirm, busy } = props
      const [reason, setReason] = useState('')
      const count = Number(data.tier2?.count) || 0
      const full = count >= 4
      return h(
        'div',
        { className: 'wb-modal', onClick: (event) => { if (event.target === event.currentTarget && !busy) onClose() } },
        h(
          'div',
          { className: 'wb-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tier2Title') },
          h('div', { className: 'wb-modal-title' }, t('tier2Title')),
          h('div', { className: 'wb-modal-note' }, tr(t, 'tier2Note', { count })),
          h(
            'div',
            { className: 'wb-field', style: { marginTop: 14 } },
            h('div', { className: 'wb-field-head' }, h('span', { className: 'wb-field-label' }, t('tier2Reason'))),
            h('input', {
              className: 'wb-field-input wide',
              type: 'text',
              value: reason,
              maxLength: 120,
              placeholder: t('tier2ReasonPlaceholder'),
              onChange: (event) => setReason(event.target.value),
              'aria-label': t('tier2Reason'),
              disabled: full,
            }),
            h('div', { className: 'wb-krow-note' }, full ? t('tier2MonthlyFull') : reason.trim() ? ' ' : t('tier2EmptyReason')),
          ),
          h(
            'div',
            { className: 'wb-modal-actions' },
            h('button', { type: 'button', className: 'wb-btn', onClick: onClose, disabled: busy }, t('cancel')),
            h(
              'button',
              { type: 'button', className: 'wb-btn primary', onClick: () => onConfirm(reason.trim()), disabled: busy || full || reason.trim().length === 0 },
              busy ? t('saving') : t('confirmTier2'),
            ),
          ),
        ),
      )
    }

    function App(props) {
      const t = props.t
      const summary = useSummary()
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [finishOpen, setFinishOpen] = useState(false)
      const [reopenOpen, setReopenOpen] = useState(false)
      const [tier2Open, setTier2Open] = useState(false)
      const [timeBusy, setTimeBusy] = useState(false)
      const [budgetBusy, setBudgetBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const data = summary.data

      const showToast = (text) => setToast({ text, id: Date.now() })
      const budgetAction = async (action, reason) => {
        setBudgetBusy(true)
        try {
          const response = await fetch(BUDGET_URL, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action, reason }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status)
          summary.refresh()
          return body
        } finally {
          setBudgetBusy(false)
        }
      }
      const toggleWrapup = async () => {
        const active = data.wrapup?.active === true
        try {
          await budgetAction(active ? 'wrapup-off' : 'wrapup-on')
          showToast(active ? t('wrapupOffToast') : t('wrapupOnToast'))
        } catch (error) {
          showToast(t('budgetError') + '：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const confirmTier2 = async (reason) => {
        try {
          await budgetAction('tier2-on', reason)
          setTier2Open(false)
          showToast(t('tier2OnToast'))
        } catch (error) {
          showToast(t('budgetError') + '：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const turnOffTier2 = async () => {
        try {
          await budgetAction('tier2-off')
          showToast(t('tier2OffToast'))
        } catch (error) {
          showToast(t('budgetError') + '：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const timeAction = async (action, at) => {
        setTimeBusy(true)
        try {
          const response = await fetch(TIME_URL, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action, at }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status)
          summary.refresh()
          return body
        } finally {
          setTimeBusy(false)
        }
      }
      const startWork = async () => {
        try {
          const body = await timeAction('start')
          showToast(tr(t, 'startedToast', { time: fmtTime(body.time.startedAt) }))
        } catch (error) {
          showToast(t('timeError') + '：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const finishWork = async () => {
        try {
          const body = await timeAction('done')
          setFinishOpen(false)
          showToast(tr(t, 'finishedToast', {
            wall: fmtMinutes(body.time.wallClockMinutes),
            gain: fmtMinutes(body.time.todayGainMinutes),
          }))
        } catch (error) {
          showToast(t('timeError') + '：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const reopenWork = async (at) => {
        try {
          const body = await timeAction('reopen', at)
          setReopenOpen(false)
          showToast(tr(t, 'reopenedToast', { time: fmtTime(body.time.startedAt) }))
        } catch (error) {
          showToast(t('timeError') + '：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const saveSettings = async (payload) => {
        const response = await fetch(SETTINGS_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          const fields = body.fields && typeof body.fields === 'object' ? ' (' + Object.keys(body.fields).join(', ') + ')' : ''
          throw new Error((body.error || 'HTTP ' + response.status) + fields)
        }
        summary.refresh()
        if (body.applied !== true) setTimeout(summary.refresh, 1500)
        return body
      }
      useEffect(() => {
        if (toast === null) return
        const timer = setTimeout(() => setToast(null), 3200)
        return () => clearTimeout(timer)
      }, [toast])
      useEffect(() => {
        if (!settingsOpen && !finishOpen && !reopenOpen && !tier2Open) return
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setSettingsOpen(false)
            setFinishOpen(false)
            setReopenOpen(false)
            setTier2Open(false)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [settingsOpen, finishOpen, reopenOpen, tier2Open])

      if (summary.status === 'loading' && data === null) return h(Loading, { t })
      if (data === null) {
        return h(
          'div',
          { className: 'wb-root' },
          h('style', null, CSS),
          h(
            'div',
            { className: 'wb-inner' },
            h(
              'div',
              { className: 'wb-banner', role: 'alert' },
              h('span', null, t('error') + ': ' + (summary.error || t('errorHint'))),
              h('button', { type: 'button', className: 'wb-btn', onClick: summary.refresh }, t('retry')),
            ),
            h(
              'div',
              { className: 'wb-loading' },
              h('div', { className: 'wb-skeleton', style: { width: 180 } }),
              h('strong', null, t('error')),
              h('span', { style: { fontSize: 10 } }, t('errorHint')),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'wb-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'wb-inner' },
          h(Header, {
            data,
            t,
            timeBusy,
            onStart: startWork,
            onFinish: () => setFinishOpen(true),
            onReopen: () => setReopenOpen(true),
            onSettings: () => setSettingsOpen(true),
          }),
          summary.status === 'error'
            ? h(
                'div',
                { className: 'wb-banner', role: 'alert' },
                h('span', null, t('error') + ': ' + (summary.error || t('errorHint'))),
                h('button', { type: 'button', className: 'wb-btn', onClick: summary.refresh }, t('retry')),
              )
            : null,
          data.work.error
            ? h(
                'div',
                { className: 'wb-banner', role: 'alert' },
                h('span', null, tr(t, 'claudeError', { message: data.work.error })),
                h('button', { type: 'button', className: 'wb-btn', onClick: summary.refresh }, t('retry')),
              )
            : null,
          h(Hero, {
            data,
            t,
            onWrap: toggleWrapup,
            onTier: () => setTier2Open(true),
            onTierOff: turnOffTier2,
          }),
          h(SourceCards, { data, t }),
          h(
            'div',
            { className: 'wb-lower' },
            h(Trend, { data, t }),
            h(Recent, { data, t }),
          ),
          h(
            'footer',
            { className: 'wb-footer' },
            h('span', null, h('i', { className: 'wb-dot' }), data.hooks.installed ? t('footerEnforced') : t('footer')),
            h('span', null, tr(t, 'updated', { time: fmtTime(data.generatedAt) }) + ' · ' + tr(t, 'files', { n: data.work.files })),
          ),
        ),
        settingsOpen ? h(SettingsDrawer, { data, t, onClose: () => setSettingsOpen(false), onSave: saveSettings }) : null,
        finishOpen ? h(FinishModal, { data, t, onClose: () => setFinishOpen(false), onConfirm: finishWork, busy: timeBusy }) : null,
        reopenOpen ? h(ReopenModal, { data, t, onClose: () => setReopenOpen(false), onConfirm: reopenWork, busy: timeBusy }) : null,
        tier2Open ? h(Tier2Modal, { data, t, onClose: () => setTier2Open(false), onConfirm: confirmTier2, busy: budgetBusy }) : null,
        toast ? h('div', { className: 'wb-toast' }, toast.text) : null,
      )
    }

    function BudgetIcon(props) {
      const size = props.size || 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M4 17a8 8 0 1 1 16 0' }),
        h('path', { d: 'M12 17l4-6' }),
        h('circle', { cx: 12, cy: 17, r: 1.5, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M8 20h8', opacity: 0.55 }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh,
              en,
            }),
          'workday-budget: dictionaries',
        )
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t }),
            },
            App,
          ),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 5,
              locale: NS,
              label: () => t('panel'),
            },
            BudgetIcon,
          ),
        )
      },
    }
  },
})
