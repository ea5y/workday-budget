# npm 发布

`workday-budget` 现在是**单包**：包内同时包含 DSH 插件、`wb` CLI、计价/账本模块，安装后不再依赖外部 `core` 目录。

## 包信息

```text
name      workday-budget
version   1.0.1
license   Apache-2.0
bin       wb -> core/wb.mjs
```

检查包内容：

```powershell
npm pack --dry-run
```

应包含：

```text
index.js
client.js
cordis.patch.yml
locale/
icon.svg
core/wb.mjs
core/time-core.mjs
core/usage-core.mjs
core/usage-ledger.mjs
core/budget-actions.mjs
core/watch-core.mjs
README.md
LICENSE
```

不包含 `tests/`、`docs/`、`design/`、运行时数据。

## 发布

先登录：

```powershell
npm login
npm whoami
```

发布：

```powershell
npm publish
```

未加 scope 的包默认 public；如果改成 `@scope/workday-budget`，使用：

```powershell
npm publish --access public
```

发布后验证：

```powershell
npm view workday-budget version
npm install -g workday-budget
wb doctor
```

## DSH 安装

从 npm 安装插件：

```text
workday-budget@1.0.1
```

本地开发仍使用：

```text
link:E:/AI/workday-budget
```

## 版本流程

1. 修改 `package.json` 的 `version`；
2. 更新 `README` 版本说明；
3. `npm test` 25 项通过；
4. `npm pack --dry-run` 检查文件；
5. `npm publish`；
6. Git 提交并打 tag：

```powershell
git tag v1.0.1
git push
git push origin v1.0.1
```

> 不要把 `%APPDATA%\workbuddy`、`settings-backup-*`、账单截图或 `.env` 打进包；`files` 白名单和 `.gitignore` 已排除。
