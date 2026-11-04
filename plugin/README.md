# Workday Budget · DSH 全屏仪表盘 + wb 核心

这是 `workday-budget` v1.0 需求与 v0.5 设计的第一版**可拦截实现**。

## 现在能做什么

- 左栏「预算」入口 → 全屏主面板；
- 读取真实 Claude Code 会话日志（`~/.claude/projects/**/*.jsonl`），按 `message.id` 去重、UTC+8、峰谷价、×1.14 校准，算出今日工作花费；
- 读取 DSH 会话（`ctx.sessionQuery`），作为 `tooling` 工具账本展示，**不计入 ¥10 预算、不校准**；
- 展示今日工作预算、剩余额度、预计用完时间、自由时间、两个账本、7 天工作趋势、今日请求；
- **真实硬顶**：`wb` 核心已安装 Claude Code `UserPromptSubmit` / `PreToolUse` hooks，到 ¥10 后下一次模型请求会被拒绝（退出码 2）；
- **状态栏已合并**：在现有 `ccstatusline-zh` 里加入一个 `custom-command` 组件运行 `wb statusline --color`，保留原有模型/上下文/Git/目录信息，末尾显示 `work X/10`；低于 70% 绿色、70–90% 黄色、90%+ 红色；
- `wb watch` 每 15 秒刷新 `state.json`；hook 快路径约 60ms；
- 单段开工/收工：`wb start` / `wb done` / `wb reopen [--at HH:MM]`；面板按钮、确认收工、reopen 时间选择、墙钟与今日收益；
- 收尾/二级上限：面板按钮已接线；收尾 +¥0.50 / 30 分钟；二级上限 ¥20、理由必填、每月 4 次；
- 设置抽屉可以直接修改日预算、时间当量、校准系数、价目表、峰时窗口、节假日；保存前二次确认，写入 `config.json`，并记录到 `config-changes.jsonl`；
- 设置抽屉展示预算、校准、价目表、hooks 状态、二级上限、wb state 状态。

## 运行时

```
Claude Code ──▶ ~/.claude/projects/*.jsonl
                       │
                       ▼
                 wb.mjs（本地核心，无端口、用户级）
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
     state.json    Claude hooks    wb statusline
          │
          ▼
    DSH 面板（读取 + 设置/时间写入） + DSH tooling
```

数据目录：`%APPDATA%\workbuddy\`

```
config.json      预算 / 系数 / 价目表 / 路径
state.json       今日 work + time + wrapup/tier2 + statusline
usage-log.jsonl  append-only Claude 事件账本（9,898 事件）
usage-cache.json 每个源文件的增量 offset
time-log.jsonl   开工/收工/reopen 审计日志
budget-log.jsonl 收尾/二级上限审计日志
watch.json       watcher PID/心跳/日志路径
watch.lock       单实例锁
logs\watch.log   watcher 日志（1MB × 3 份轮转）
startup VBS      当前用户登录自启
watch.pid        wb watch 进程号
logs\            watcher 日志
```

## 常用命令

在 `core\` 下可直接用 `wb.cmd`（内部查找 Node）：

```powershell
.\wb.cmd status
.\wb.cmd selftest
.\wb.cmd doctor
```

等价于：

```powershell
node wb.mjs refresh
node wb.mjs rebuild          # 从 ledger 恢复 state
node wb.mjs rebuild --source # 从原始日志重建 ledger
node wb.mjs status
node wb.mjs check --hook
node wb.mjs start
node wb.mjs done
node wb.mjs reopen
node wb.mjs reopen --at 09:00
node wb.mjs statusline
node wb.mjs statusline --color  # green/yellow/red
node wb.mjs statusline install   # 合并进 ccstatusline（带颜色）
node wb.mjs statusline uninstall
node wb.mjs wrapup          # 30 分钟 / ¥0.50
node wb.mjs tier2 --on "理由"
node wb.mjs hooks status
node wb.mjs watch           # 或 watch --stop / watch --status
node wb.mjs autostart install
node wb.mjs autostart uninstall
node wb.mjs autostart status
node wb.mjs selftest
node wb.mjs doctor
```

hooks 安装/卸载：

```powershell
node wb.mjs hooks install
node wb.mjs hooks uninstall
```

安装会先备份 `~/.claude/settings.json`，只添加 `UserPromptSubmit` 与 `PreToolUse` 条目，保留现有 `statusLine`。

## 后续

v1.0 P0 任务已完成。下一阶段是 v1.1：交付项、顺延队列、溢出报告、周报/导出。

## 文档

- [需求文档](../docs/需求文档.md)
- [任务清单](../docs/任务清单.md)
- [安装/卸载/回滚](../docs/安装卸载回滚.md)
- [产物清单与 SHA256](../docs/产物清单.md)
- [T07 验收记录](../docs/T07-验收记录.md)

## 数据与口径

- Claude Code：`input_tokens + cache_creation_input_tokens` 按未命中计，`cache_read_input_tokens` 按命中计，`output_tokens` 按输出计；结果 × `calibration`；
- DSH：`inputTokens`、`cacheReadTokens`、`outputTokens`，只用于工具账本；
- 峰时：工作日 09:00–12:00、14:00–18:00（Asia/Shanghai）；
- 日预算：¥10；状态：NORMAL / WARN / WINDDOWN / LOCKED。

## 验证与测试

```powershell
cd workday-budget\tests
.\run-tests.cmd   # 25 项：计价/时区/去重/阈值/hooks/statusline/时间/预算动作/ledger/watcher/5 天回归
.\perf.cmd        # check/statusline/接口冷热耗时
```

## Host 路由

- `GET /workday-budget/summary`：只读快照，仅 loopback
- `POST /workday-budget/settings`：写 `config.json`，服务端校验；仅 loopback
- `POST /workday-budget/time`：`start` / `done` / `reopen`，单段时间写入；仅 loopback
- `POST /workday-budget/budget`：`wrapup-on/off`、`tier2-on/off`；仅 loopback

## 下一步

1. v1.1 交付项/顺延/溢出报告/周报；
2. T07 浏览器 Performance 复核（接口代理已通过）。
