# Codex CLI 配置说明

本目录包含 Codex CLI 的配置文件，用于控制 AI 辅助编程的行为和权限。

## ⚠️ 重要提示

**Codex 使用 TOML 格式配置文件**，与 Claude Code（JSON）和 Gemini CLI（JSONC）不同：

| 工具 | 配置格式 | 团队配置 | 个人配置 | 注释语法 |
|------|---------|---------|---------|---------|
| Claude Code | JSON/JSONC | `settings.json` | `settings.local.json` | `//` |
| Gemini CLI | JSONC | `settings.json` | `settings.local.json` | `//` |
| **Codex** | **TOML** | **`config.example.toml`** | **`config.toml`** | **`#`** |

## 📁 文件说明

### `config.example.toml` - 团队共享配置模板
- **用途**：团队成员共享的基础配置（平衡策略）
- **提交状态**：✅ 应提交到 Git 仓库
- **目标**：平衡安全性和便利性，为 AGENTS 路由系统优化
- **格式**：TOML（使用 `#` 注释）

### `config.toml` - 个人配置
- **用途**：个人覆盖配置，实现完全自动化
- **提交状态**：❌ 不提交（已在 `.gitignore` 中忽略）
- **目标**：覆盖团队配置，实现无打扰的自动化工作流
- **格式**：TOML（从 `config.example.toml` 复制并修改）

### 其他忽略的文件
以下文件由 Codex 运行时生成，不应提交到 Git：
- `auth.json` - 认证信息
- `history.jsonl` - 对话历史
- `sessions/` - 会话数据

## 🚀 快速开始

### 1. 首次使用

复制团队配置模板为个人配置：

```bash
cp .codex/config.example.toml .codex/config.toml
```

### 2. 启用项目内配置

Codex 默认使用 `~/.codex/` 目录，要使用项目内的 `.codex/` 配置，需要设置环境变量：

```bash
# 方法 A：终端启动（推荐）
CODEX_HOME=$PWD/.codex codex

# 方法 B：export 后启动 VS Code
export CODEX_HOME=$PWD/.codex
code .
```

### 3. 验证配置

```bash
echo $CODEX_HOME
# 应该输出：/path/to/project/.codex
```

## 🎯 Codex 配置核心概念

### 批准策略（`approval_policy`）

控制何时需要用户批准命令执行：

| 值 | 说明 | 适用场景 |
|----|------|---------|
| `"untrusted"` | 大多数命令需要批准 | 团队默认、新项目 ✅ |
| `"on-failure"` | 失败时才提示 | 熟悉的项目 |
| `"on-request"` | Codex 请求时才提示 | 高度信任的环境 |
| `"never"` | 完全自动化 | 个人项目、完全信任 ⚠️ |

**团队默认**：`"untrusted"`

### 沙箱模式（`sandbox_mode`）

控制文件系统访问范围：

| 值 | 说明 | 文件访问权限 |
|----|------|-------------|
| `"read-only"` | 只读模式 | 只能读取，不能修改 |
| `"workspace-write"` | 工作区写入 | 可写入项目目录和 $TMPDIR ✅ |
| `"danger-full-access"` | 完全访问 | 可修改系统任何文件 ⚠️ |

**团队默认**：`"workspace-write"`

## 📊 配置对比

### 团队配置（`config.example.toml`）

```toml
# 平衡策略：安全性和便利性的折中
approval_policy = "untrusted"        # 大多数命令需要确认
sandbox_mode = "workspace-write"     # 仅允许修改项目文件
```

**效果**：
- ✅ Git 操作可能需要确认
- ✅ 文档编辑可能需要确认
- ✅ 项目文件可以修改
- ❌ 系统文件禁止修改

### 个人配置（`config.toml`）

```toml
# 完全自动化：无打扰工作流
approval_policy = "never"            # 所有命令自动执行
sandbox_mode = "danger-full-access"  # 完全文件系统访问
```

**效果**：
- ✅ 所有命令自动执行
- ✅ 所有文件可以修改
- ⚠️ 包括系统文件

## 🆚 与 Claude Code / Gemini CLI 的对比

### 配置理念差异

| 特性 | Claude Code | Gemini CLI | **Codex** |
|------|-------------|-----------|-----------|
| **权限模型** | 细粒度规则 | 全局开关 | **策略+沙箱** |
| **安全方式** | Allow/Deny 列表 | 逐项确认开关 | **批准策略** |
| **文件控制** | 路径规则 | 全局确认 | **沙箱模式** |
| **配置复杂度** | 高 | 中 | **低** ✅ |

### 配置映射关系

| 需求 | Claude Code | Gemini CLI | **Codex** |
|------|-------------|-----------|-----------|
| **完全自动化** | `permissions.allow: ["Bash", "Edit", "Write"]` | `bash.autoExecute: true` `file.confirm: false` | `approval_policy: "never"` `sandbox_mode: "danger-full-access"` |
| **保守安全** | 大量 deny 规则 | 所有开关设为 false | `approval_policy: "untrusted"` `sandbox_mode: "read-only"` |
| **平衡策略** | 精心设计的 allow/deny | 部分开关为 true | `approval_policy: "on-failure"` `sandbox_mode: "workspace-write"` ✅ |

## 🛡️ 安全考虑

### 团队配置的平衡策略

```toml
approval_policy = "untrusted"
sandbox_mode = "workspace-write"
```

- ✅ 阻止大多数意外操作
- ✅ 允许修改项目文件
- ❌ 禁止修改系统文件
- ⚠️ 关键操作需要确认

### 个人配置的风险

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

- ⚠️ 所有命令自动执行
- ⚠️ 可以修改任何文件
- ⚠️ 可以执行危险操作
- ⚠️ 无任何安全检查

**建议**：
1. 只在信任的项目中使用
2. 定期检查操作历史
3. 重要文件先备份

## 🔧 配置示例

### 示例 1：保守模式（最安全）

```toml
approval_policy = "untrusted"
sandbox_mode = "read-only"
```

**适用**：新项目、不信任的代码库

### 示例 2：平衡模式（推荐）

```toml
approval_policy = "on-failure"
sandbox_mode = "workspace-write"
```

**适用**：日常开发、团队协作

### 示例 3：激进模式（便利优先）

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

**适用**：个人项目、完全信任的环境

## 💡 MCP 服务器配置

Codex 支持 Model Context Protocol (MCP) 服务器扩展功能：

```toml
# 文件系统访问
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]

# GitHub 集成
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { "GITHUB_TOKEN" = "your-token" }
```

**注意**：使用下划线 `mcp_servers`，不是 `mcp-servers`

## 🤝 团队协作

### 提交变更

```bash
git add .codex/config.example.toml .codex/README.md
git commit -m "chore: update Codex config template"
```

### 不要提交

以下文件已在 `.gitignore` 中：
- `config.toml` - 个人配置
- `auth.json` - 认证信息
- `history.jsonl` - 对话历史
- `sessions/` - 会话数据

## 📚 相关文档

- AGENTS 路由系统：`/AGENTS.md`
- Claude Code 配置：`/.claude/README.md`
- Gemini CLI 配置：`/.gemini/README.md`
- Codex 官方文档：https://github.com/openai/codex/blob/main/docs/config.md

## 🔍 故障排查

### Codex 没有使用项目配置

```bash
# 检查环境变量
echo $CODEX_HOME
# 应该输出：/path/to/project/.codex
```

### 配置不生效

1. 确认 `config.toml` 存在
2. 检查 TOML 语法（无逗号、使用 `#` 注释）
3. 重启 Codex CLI 或 VS Code

---

**最后更新**：2025-11-05
**版本**：3.0 (基于官方文档修正)
