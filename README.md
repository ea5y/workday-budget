# Workday Budget

把「今天的工作」当成一笔 **¥10 硬预算**来经营：真实计量 Claude Code 花费、日预算/硬顶、状态栏、全屏 DSH 仪表盘、收工结算。

## 目录

```text
core/     wb CLI、计价/账本、时间、watch/自启
plugin/   DSH 插件（Host + 全屏面板）
tests/    25 项测试
docs/     需求、任务清单、安装/卸载/回滚、产物清单
design/   设计稿归档
```

`plugin` 通过相对路径复用 `core` 的共享模块；因此**两者必须一起 checkout**。

## 快速验证

```powershell
cd core
.\wb.cmd doctor
.\wb.cmd selftest

cd ..\tests
.\run-tests.cmd
```

预期：25/25 通过，`selftest PASS`。

## 安装

完整步骤见 [安装/卸载/回滚](docs/安装卸载回滚.md)。最短路径：

1. 在 DSH 插件管理里安装本地 bundle：`link:<repo>/plugin`
2. 运行 `core\wb.cmd hooks install`
3. 可选：`core\wb.cmd statusline install`
4. 可选：`core\wb.cmd autostart install`
5. 刷新 DSH，左栏「预算」

## 数据与隐私

运行时数据不在仓库里，默认位于：

```text
%APPDATA%\workbuddy\
```

包括 `state.json`、`usage-log.jsonl`、`usage-cache.json`、审计日志和备份。**不要把这些文件提交到 Git。**

## 版本

- v1.0.0（2026-11-04）
- 需求基线：`docs/需求文档.md` v1.0
- 设计基线：`design/v0.5/`

## 文档

- [需求文档](docs/需求文档.md)
- [任务清单](docs/任务清单.md)
- [安装/卸载/回滚](docs/安装卸载回滚.md)
- [产物清单](docs/产物清单.md)
- [T07 验收记录](docs/T07-验收记录.md)
