# 部署记录目录

> **用途**：由 DevOps 专家创建与维护，存放于 `/docs/data/deployments/README.md`。记录各环境的最新部署状态，并作为部署记录文件的索引。仅记录 staging 和 production 部署，dev 部署不记录。

日期：YYYY-MM-DD  版本：v0

---

## 各环境当前状态

| 环境 | 当前版本 | Commit | 部署时间 | 记录文件 |
| ---- | -------- | ------ | -------- | -------- |
| staging | - | - | - | - |
| production | - | - | - | - |

## 命名规范

部署记录文件命名：`DEPLOY-{YYYYMMDD}-{SEQ}-{env}.md`

| 段 | 说明 | 示例 |
| -- | ---- | ---- |
| YYYYMMDD | 部署日期 | 20250115 |
| SEQ | 当日序号，三位零填充 | 001、002 |
| env | 目标环境 | staging / production |

- 每次 staging 或 production 部署新建一个文件
- 按文件名排序即为时间线
- 可用 `DEPLOY-*-production.md` 筛选特定环境

## 模板引用

- 单次部署记录模板：`/docs/data/templates/devops/DEPLOYMENT-RECORD-TEMPLATE.md`
- 本 README 模板：`/docs/data/templates/devops/DEPLOYMENT-README-TEMPLATE.md`

## 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
| ---- | ---- | -------- | ---- |
| v0 | YYYY-MM-DD | 初始版本 | @author |
