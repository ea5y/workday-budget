# Workday Budget tests

All tests use `node:test` and Node's built-in assert/fetch; no npm dependencies.

## Run

```powershell
cd tests
.\run-tests.cmd
```

or:

```powershell
node --test tests/core.test.mjs tests/hooks.test.mjs tests/time.test.mjs tests/budget-actions.test.mjs tests/ledger.test.mjs tests/watch.test.mjs tests/stale.test.mjs tests/regression.test.mjs
```

Current suite: **30 tests**, all passing.

## What is covered

| File | Coverage |
|---|---|
| `core.test.mjs` | Peak/off-peak pricing, UTC→Asia/Shanghai day boundary, dedupe by `message.id`, cache/output price bands, 70% threshold, `wb selftest` |
| `hooks.test.mjs` | Hook install/uninstall preserving `env`/`statusLine`, idempotence, statusline install/uninstall preserving existing widgets, ANSI colors at 70/90 |
| `time.test.mjs` | T02 one-interval start/done/reopen, repeated clicks, invalid finish, reopen time, cross-midnight |
| `budget-actions.test.mjs` | T03 wrapup on/off、tier2 on/off、idempotence、月度配额、理由；wrapup×tier2 双向保持 +¥0.50、refresh；effective remaining/status/check |
| `ledger.test.mjs` | T05 incremental append, truncation/replacement, state rebuild from ledger/source, price changes repricing |
| `watch.test.mjs` | T08 single instance, duplicate start rejection, clean stop, log rotation |
| `stale.test.mjs` | 5-minute stale threshold; hook fail-open single-line STALE; normal CLI single-line error |
| `regression.test.mjs` | Five-day platform bill regression within ±8%; skips if Claude Code logs are unavailable |
| `perf.mjs` | `wb check`/`statusline` latency (20 runs), cold/warm summary route if the DSH page is running |

Tests always write to a temp `WB_DATA_DIR`; hook/statusline tests use temp settings/config paths via `WB_CLAUDE_SETTINGS` and `WB_CCSTATUSLINE`. The real `~/.claude/settings.json` and `~/.config/ccstatusline/settings.json` are not touched.

## Perf

```powershell
.\perf.cmd
```

Reports:

- `check` avg/p95/max;
- `statusline --color` avg/p95/max;
- cached summary cold/warm;
- a note that first browser render is not measurable here.

## Regression only

```powershell
.\regression.cmd
```

Requires the real `~/.claude/projects` corpus and the five platform bills in `wb-core` / `AGENTS.md`.
