# Workday Budget

把「今天的工作」当成一笔 **¥10 硬预算**来经营：真实计量 Claude Code 花费、日预算/硬顶、状态栏、全屏 DSH 仪表盘、收工结算。

`workday-budget` 同时是一个 **npm CLI + DSH 插件**：包内自带 `wb` 核心和插件 Host/Client，安装后不需要额外复制 core。

## 安装

```powershell
npm install -g workday-budget
wb doctor
```

DSH 中安装插件（二选一）：

```text
workday-budget@1.0.1
link:E:/AI/workday-budget
```

本地开发时用 `link:`；从 npm 安装时用 `workday-budget`。

## 首次配置

```powershell
wb hooks install          # Claude Code 硬顶
wb statusline install     # 可选：合并 work X/10
wb autostart install      # 可选：登录自启
wb doctor
wb selftest
```

DSH 左栏出现「预算」，刷新页面即可。

## CLI

```powershell
wb status
wb refresh
wb rebuild
wb start
wb done
wb reopen --at 09:00
wb wrapup
wb tier2 --on "理由"
wb watch --status
wb autostart status
wb hooks status
wb statusline status
```

## 数据

运行时数据默认在：

```text
%APPDATA%\workbuddy\
```

包括 `state.json`、`usage-log.jsonl`、`usage-cache.json`、`time-log.jsonl`、`budget-log.jsonl`、备份和日志。**这些文件不属于 npm 包，也不应提交到 Git。**

## 开发

```powershell
npm test          # 25 项
npm run regression
npm run perf
```

目录：

```text
core/     wb CLI、计价/账本、时间、watch/自启
index.js  DSH Host
client.js DSH 全屏面板
locale/   界面文案
tests/    测试
docs/     需求、任务清单、安装/卸载/回滚
design/   设计稿
```

## 版本

- v1.0.1（2026-11-04，npm 包结构）
- 需求基线：`docs/需求文档.md`
- 设计基线：`design/v0.5/`
- License：Apache-2.0

## 文档

- [需求文档](https://github.com/ea5y/workday-budget/blob/main/docs/需求文档.md)
- [任务清单](https://github.com/ea5y/workday-budget/blob/main/docs/任务清单.md)
- [安装/卸载/回滚](https://github.com/ea5y/workday-budget/blob/main/docs/安装卸载回滚.md)
- [npm 发布](https://github.com/ea5y/workday-budget/blob/main/docs/npm发布.md)
- [产物清单](https://github.com/ea5y/workday-budget/blob/main/docs/产物清单.md)
- [T07 验收记录](https://github.com/ea5y/workday-budget/blob/main/docs/T07-验收记录.md)
