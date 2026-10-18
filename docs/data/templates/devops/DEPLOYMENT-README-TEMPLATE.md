# 部署记录目录

> **用途**：由 DevOps 专家维护，存放于 `/docs/data/deployments/README.md`。只保留各环境当前状态与索引，不追加叙述段落；整体 ≤8KB。仅记录 staging 和 production。

## 各环境当前状态

| 环境 | 当前版本 | Commit | 部署时间 | 备注 |
| ---- | -------- | ------ | -------- | ---- |
| staging | - | - | - | - |
| production | - | - | - | - |

## 记录方式

- 常规部署：在当月台账 `LOG-{YYYY-MM}.md` 追加一行，不新建文件。
- 失败或重试、回滚、热修复、事故、人工迁移、生产数据或运行模式变更：新建 `DEPLOY-{YYYYMMDD}-{SEQ}-{slug}.md`（≤60 行），并在台账该行链接。
- 本 README 只更新当前状态表与下方索引；历史以台账和 git 历史为准。

## 月度台账

- [LOG-YYYY-MM](LOG-YYYY-MM.md)

## 最近独立记录（约 10 条）

- [DEPLOY-YYYYMMDD-001-slug](DEPLOY-YYYYMMDD-001-slug.md)：一句话说明

## 模板引用

- 月度台账：`/docs/data/templates/devops/DEPLOYMENT-LOG-TEMPLATE.md`
- 独立记录：`/docs/data/templates/devops/DEPLOYMENT-RECORD-TEMPLATE.md`
