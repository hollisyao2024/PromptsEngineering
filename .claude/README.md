# Claude Code 配置说明

本目录包含 Claude Code 的配置文件，用于控制 AI 辅助编程的行为和权限。

## 📁 文件说明

### `settings.json` - 团队共享配置
- **用途**：团队成员共享的基础安全配置（方案 C）
- **提交状态**：✅ 应提交到 Git 仓库
- **目标**：平衡安全性和便利性，为 AGENTS 路由系统优化

### `settings.local.json` - 个人配置
- **用途**：个人覆盖配置，实现完全自动化
- **提交状态**：❌ 不提交（已在 `.gitignore` 中忽略）
- **目标**：覆盖团队配置，实现无打扰的自动化工作流

## 自动压缩水位

团队配置在 `.claude/settings.json` 的 `env` 中设置 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` 和 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=90`，使支持自动压缩的 Claude Code 会话约在 180k token 触发。实际窗口受所用模型上限约束；用户可在 `.claude/settings.local.json` 的 `env` 中覆盖这两项。已运行的会话需重新启动才会读取新配置。

## 🎯 配置策略

### 团队共享配置 (`settings.json`)

#### ✅ 自动允许的操作
- Git 基础操作（add、commit、status、diff、log）
- 文档编辑（`docs/**`）
- 角色文件编辑（`AgentRoles/**`）

#### ❌ 禁止的操作
- 修改敏感文件（`.env*`）
- 修改数据库迁移（`db/migrations/*`）
- 修改状态文件（`docs/AGENT_STATE.md`）
- 危险命令（`rm -rf`、强制推送、硬重置）

#### ⚠️ 需要确认的操作
- 依赖安装（`npm install`、`pnpm install`）
- 推送到远程（`git push`）
- 网络访问（`WebFetch`）

### 个人配置 (`settings.local.json`)

#### 完全自动化配置
```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true
  },
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": ["Bash", "Edit", "Write", "WebFetch", "SlashCommand", "NotebookEdit"],
    "deny": [],
    "ask": []
  }
}
```

**说明**：
- 启用沙箱并自动执行所有命令
- 自动批准所有 MCP 服务器
- 允许所有操作类型，无需确认
- 沙箱提供安全保护（限制项目目录外的写入）

## 🔄 配置合并规则

配置按以下优先级合并（从高到低）：
1. 个人配置（`settings.local.json`）
2. 团队配置（`settings.json`）
3. 用户全局配置（`~/.claude/settings.json`）

更具体的配置会覆盖更广泛的配置。

## 📊 使用场景对比

### 新团队成员（没有 `.local.json`）
```
Git 操作     → ✅ 自动执行
文档编辑     → ✅ 自动执行
网络访问     → ⚠️ 需要确认
依赖安装     → ⚠️ 需要确认
推送代码     → ⚠️ 需要确认
修改 .env    → ❌ 禁止
```

### 有个人配置的成员
```
所有 Bash    → ✅ 自动执行（沙箱保护）
所有文件编辑  → ✅ 自动执行（项目目录内）
网络访问     → ✅ 自动执行
依赖安装     → ✅ 自动执行
推送代码     → ✅ 自动执行
```

## 🛡️ 安全考虑

### 沙箱保护
即使启用完全自动化，沙箱仍然提供以下保护：
- ✅ 限制文件写入到项目目录内
- ✅ 阻止修改系统文件（如 `/bin/`、`~/.bashrc`）
- ✅ 防止意外删除项目外的文件

### 敏感文件保护
团队配置明确禁止修改：
- `.env*` - 环境变量配置
- `db/migrations/*` - 数据库迁移文件
- `docs/AGENT_STATE.md` - AGENTS 路由状态文件

## 🚀 如何自定义

### 创建个人配置

如果你想实现完全自动化，创建 `settings.local.json`：

```bash
cat > .claude/settings.local.json << 'EOF'
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true
  },
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": ["Bash", "Edit", "Write", "WebFetch", "SlashCommand", "NotebookEdit"],
    "deny": [],
    "ask": []
  }
}
EOF
```

### 部分自动化

如果你只想自动化某些操作：

```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Edit(src/**)",
      "Write(docs/**)"
    ],
    "ask": [
      "WebFetch(domain:*)"
    ]
  }
}
```

## 📚 相关文档

- [Claude Code 官方文档](https://docs.claude.com/en/docs/claude-code)
- [权限系统说明](https://docs.claude.com/en/docs/claude-code/iam.md)
- [沙箱配置](https://docs.claude.com/en/docs/claude-code/sandboxing.md)

## 🤝 团队协作

### 提交变更

修改团队配置后，提交到 Git：
```bash
git add .claude/settings.json
git commit -m "chore: update team Claude Code settings"
```

### 不要提交

个人配置不应提交：
```bash
# settings.local.json 已在 .gitignore 中
# 无需手动排除
```

---

**最后更新**：2025-11-05
**维护者**：项目团队
