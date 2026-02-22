# LinghuiAI 定时任务配置

本目录包含所有定时任务的配置和调度器。

## 📋 任务清单

| 任务名称 | 执行时间 | 脚本路径 | 说明 |
|---------|---------|---------|------|
| 清理过期删除工单 | 每日 02:00 | `cleanup-expired-deletion-tickets.ts` | 删除冻结期已过的用户账户（免费 30 天，付费 90 天）[ADR-020] |
| 归档使用日志 | 每日 03:00 | `archive-usage-logs.ts` | 归档 180 天前的使用日志到 CSV/OSS，释放数据库空间 [ADR-021] |
| 数据一致性检查 | 每日 04:00 | `check-credit-consistency.js` | 检查并修复 `users.credits_remaining` 与 `credits.balance` 的不一致 |
| 账号冻结清理 | 每日 05:00 | `account-freeze-cleanup.js` | 清理过期的账号注销申请（30天冻结期） |
| 健康检查 | 每小时 | `health-check.js`（TODO） | 检查数据库、Redis、外部服务状态 |

---

## 🚀 部署方式

### 方式 1：Node.js Cron 调度器（推荐）

**适用场景**：开发环境、容器化部署

**步骤**：

1. 安装依赖：
   ```bash
   cd frontend
   npm install node-cron
   ```

2. 运行调度器：
   ```bash
   node infra/scripts/cron/scheduler.js
   ```

3. Docker Compose 部署（生产环境）：
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.cron.yml up -d
   ```

4. 查看日志：
   ```bash
   docker logs -f linghuiai-cron
   ```

---

### 方式 2：系统 Crontab（传统方式）

**适用场景**：直接部署在 Linux 服务器

**步骤**：

1. 复制配置文件：
   ```bash
   sudo cp crontab.example /etc/cron.d/linghuiai-cron
   ```

2. 修改路径和用户：
   ```bash
   sudo vim /etc/cron.d/linghuiai-cron
   # 修改 /app/frontend 为实际路径
   ```

3. 重启 cron 服务：
   ```bash
   sudo service cron reload
   ```

4. 查看日志：
   ```bash
   tail -f /var/log/linghuiai/credit-consistency.log
   ```

---

### 方式 3：GitHub Actions（云端定时任务）

**适用场景**：无需本地部署，直接在 GitHub Actions 中运行

参见 `.github/workflows/scheduled-tasks.yml`（TODO）

---

## 📊 监控与告警

### 查看任务执行状态

**Node.js 调度器**：
```bash
# 查看实时日志
docker logs -f linghuiai-cron

# 查看最近 100 行日志
docker logs --tail 100 linghuiai-cron
```

**系统 Crontab**：
```bash
# 查看积分一致性检查日志
tail -f /var/log/linghuiai/credit-consistency.log

# 查看账号清理日志
tail -f /var/log/linghuiai/account-cleanup.log
```

### 告警配置（TODO）

未来可集成：
- 钉钉机器人
- 企业微信
- 邮件通知
- Sentry 错误追踪

---

## 🧪 手动测试

### 测试数据一致性检查

**只读检查（不修复）**：
```bash
cd frontend
node scripts/check-credit-consistency.js --dry-run
```

**自动修复**：
```bash
node scripts/check-credit-consistency.js --fix
```

### 测试账号冻结清理

```bash
cd frontend
node scripts/account-freeze-cleanup.js
```

---

## 📝 日志管理

### 日志目录结构

```
/var/log/linghuiai/
├── credit-consistency.log  # 积分一致性检查日志
├── account-cleanup.log     # 账号清理日志
├── token-cleanup.log       # Token 清理日志（TODO）
├── login-logs-archive.log  # 登录日志归档（TODO）
└── health-check.log        # 健康检查日志（TODO）
```

### 日志轮转配置

创建 `/etc/logrotate.d/linghuiai`：

```
/var/log/linghuiai/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
```

---

## 🔧 故障排查

### 问题 1：数据库连接失败

**症状**：
```
Error: P1001: Can't reach database server
```

**解决方案**：
1. 检查 `DATABASE_URL` 环境变量是否正确
2. 检查数据库容器是否运行：`docker ps | grep postgres`
3. 检查网络连接：`docker network inspect linghuiai-network`

### 问题 2：定时任务未执行

**症状**：任务未按计划执行

**解决方案**：
1. 检查调度器是否运行：`docker ps | grep cron`
2. 检查日志：`docker logs linghuiai-cron`
3. 验证时区设置：`date` 命令查看容器时区

### 问题 3：权限不足

**症状**：
```
Error: EACCES: permission denied
```

**解决方案**：
1. 检查文件权限：`ls -la scripts/`
2. 添加执行权限：`chmod +x scripts/*.js`
3. 检查 Docker 卷挂载权限

---

## 📦 相关文件

| 文件 | 说明 |
|------|------|
| `scheduler.js` | Node.js Cron 调度器 |
| `crontab.example` | 系统 Crontab 配置示例 |
| `README.md` | 本文档 |
| `../check-credit-consistency.js` | 数据一致性检查脚本 |
| `../account-freeze-cleanup.js` | 账号冻结清理脚本 |
| `../../docker-compose.cron.yml` | Docker Compose 配置 |

---

## 🔗 相关文档

- [用户管理模块架构文档](../../../docs/arch-modules/user-management/ARCH.md#数据备份与恢复)
- [付费订阅模块架构文档](../../../docs/arch-modules/payment-subscription/ARCH.md#积分初始化策略)
- [数据一致性策略](../../../docs/arch-modules/payment-subscription/ARCH.md#积分初始化策略)

---

## 📅 维护计划

| 任务 | 频率 | 负责人 |
|------|------|--------|
| 检查日志空间 | 每周 | DevOps |
| 验证任务执行 | 每周 | 后端团队 |
| 性能优化 | 每季度 | 后端团队 |
| 告警配置更新 | 按需 | 全栈团队 |
