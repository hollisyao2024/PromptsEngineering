# 环境配置文档（Environment Configuration）

> **用途**：由 DevOps 专家创建与维护，存放于 `/docs/data/environment-config.md`。记录各环境的配置、访问方式与健康检查，确保环境一致性与可追溯性。

日期：YYYY-MM-DD  版本：v0

---

## 1. 环境清单

| 环境 | 用途 | URL | 部署方式 | 当前版本 | 状态 |
| ---- | ---- | --- | -------- | -------- | ---- |
| dev | 本地开发/联调 | http://localhost:3000 | `/ship dev` | - | 🟢 正常 |
| staging | 预发验证/UAT | https://staging.example.com | `/ship staging` 或 `/cd staging` | - | 🟢 正常 |
| production | 生产环境 | https://example.com | `/ship prod` 或 `/cd prod` | - | 🟢 正常 |

## 2. 环境配置项

### 2.1 通用配置

| 配置项 | dev | staging | production | 说明 |
| ------ | --- | ------- | ---------- | ---- |
| NODE_ENV | development | staging | production | |
| DATABASE_URL | .env.local | Secret Manager | Secret Manager | 不入库 |
| API_BASE_URL | http://localhost:3001 | https://api-staging.example.com | https://api.example.com | |
| LOG_LEVEL | debug | info | warn | |

### 2.2 外部服务依赖

| 服务 | dev | staging | production | 备用方案 |
| ---- | --- | ------- | ---------- | -------- |
| | Mock / 沙箱 | 沙箱 | 生产 | |

## 3. 环境变量管理策略

- **本地开发**：通过 `.env.local` 管理（已加入 `.gitignore`）
- **staging / production**：通过 Secret Manager（如 GitHub Secrets、AWS SSM）管理
- **敏感信息**（API Key、数据库密码、JWT Secret）：禁止硬编码或入库

## 4. 健康检查端点

| 环境 | 端点 | 期望状态 | 检查频率 |
| ---- | ---- | -------- | -------- |
| dev | /api/health | 200 OK | 手动 |
| staging | /api/health | 200 OK | 每次部署后 |
| production | /api/health | 200 OK | 持续监控 |

## 5. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
| ---- | ---- | -------- | ---- |
| v0 | YYYY-MM-DD | 初始版本 | @author |
