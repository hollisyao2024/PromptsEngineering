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

### `hooks.json` - 团队共享启动钩子
- **用途**：会话启动/恢复时读取当前仓库 `.env.local`，把 `GH_TOKEN` 注入 CLI 环境文件，确保 GitHub 操作优先使用 repo-local token
- **提交状态**：✅ 应提交到 Git 仓库
- **安全边界**：只提交读取与转发逻辑，不提交 token 值；真实 token 仍只放在 `.env.local`
- **适用场景**：Claude/Codex 相关本地会话需要继承项目级 `GH_TOKEN` 时默认生效

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

### 4. Token 与上下文预算

- 默认设置 `model_auto_compact_token_limit = 180000`；不要为了让线程保持更长而把工作阈值提高到模型最大窗口。
- 阶段转换后使用 `pnpm agent -- task context --task <id>` 生成最多 8KB 的交接胶囊；新阶段在新执行上下文中继续。
- 长测试、构建和部署使用 `pnpm agent -- task exec --task <id> --name <name> -- <command...>`，完整日志进入容器 `tmp`，模型只读取有界摘要。
- 连续 10 次请求中，稳定阶段缓存命中率应达到 70%；低于该门槛时切换缓存可靠的模型或通道，无法切换时每 8 次请求交接一次。

## 🎯 Codex 配置核心概念

### 批准策略（`approval_policy`）

控制何时需要用户批准命令执行：

| 值 | 说明 | 适用场景 |
|----|------|---------|
| `"on-request"` | 由 Codex 判断何时请求批准 | 交互式开发、团队默认 ✅ |
| `"never"` | 不请求交互审批，失败直接返回 | 个人项目、完全信任 ⚠️ |

**团队默认**：`"on-request"`

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
approval_policy = "on-request"       # 需要时请求批准
sandbox_mode = "workspace-write"     # 仅允许修改项目文件

[sandbox_workspace_write]
network_access = true                # 启用网络访问
```

**效果**：
- ✅ 沙箱内的常规操作可直接执行
- ✅ 需要扩大权限时请求批准
- ✅ 项目文件可以修改
- ✅ 网络访问允许（WebFetch 等）
- ❌ 系统文件禁止修改

**交互式开发建议**：`approval_policy = "on-request"` 与 `sandbox_mode = "workspace-write"` 配合使用。

### 个人配置（`config.toml`）

```toml
# 完全自动化：无打扰工作流
approval_policy = "never"            # 不请求交互审批；操作仍可能被策略拒绝
sandbox_mode = "danger-full-access"  # 完全文件系统访问

[sandbox_danger_full_access]
network_access = true                # 明确启用网络访问
```

**效果**：
- ✅ 不请求交互审批；操作仍可能被策略拒绝
- 文件系统沙箱不限制路径，但仍受操作系统权限和平台策略约束
- ✅ 网络访问允许
- ⚠️ 平台策略、命令规则与操作系统权限仍然生效

**对齐 Claude Code 个人配置**：
- Claude: `permissions.allow = ["Bash", "Edit", "Write", "WebFetch", ...]`
- Codex: `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`

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
| **完全自动化** | `permissions.allow: ["Bash", "Edit", "Write", "WebFetch"]` | `bash.autoExecute: true` `file.confirm: false` `networking.autoPermit: true` | `approval_policy: "never"` `sandbox_mode: "danger-full-access"` `network_access: true` |
| **保守安全** | 大量 deny 规则 | 所有开关设为 false | `approval_policy: "on-request"` `sandbox_mode: "read-only"` |
| **平衡策略** | 精心设计的 allow/deny/ask | 部分开关为 true | `approval_policy: "on-request"` `sandbox_mode: "workspace-write"` `network_access: true` ✅ |

### 审批、沙箱与执行规则

`sandbox_mode` 控制隔离范围，`approval_policy` 控制审批请求，`approvals_reviewer` 决定合格请求由用户还是 Auto-review 审查；命令规则和托管要求还会施加约束，不能用其他工具的设置直接推断 Codex 的实际权限。

Auto-review 接管审批请求而不扩大可写目录。实际生效的 `approval_policy="never"` 不产生交互审批请求，不能仅凭本地配置或一条 `blocked by policy` 就认定 Auto-review 参与。应检查当次会话的有效权限与原始回执。参见 [官方审批说明](https://learn.chatgpt.com/docs/sandboxing/auto-review) 和 [沙箱与可写目录](https://learn.chatgpt.com/docs/sandboxing)。

### 息壤容器目录与本地任务记录

普通单会话只读解释、状态查询和诊断不因步骤数量创建任务；持久化触发条件统一见 `AGENTS.md`“长任务断点续跑”。`diagnose` 是工作类型，记录和恢复该任务仍可能写文件。

需要记录且路径不清楚时，可选执行 `pnpm agent -- task paths --task <id>`。它只输出 `PROJECT_ROOT`、`TASK_RUNS_ROOT`、`TASK_LOCK_ROOT` 和可选 `STATE_PATH`，不创建目录或锁、不联网；`SIDE_EFFECTS=NONE` 和 `PERMISSION_STATUS=NOT_EVALUATED` 表示此次查询没有副作用、也没有判定权限。该查询不是普通核查的新门禁。

默认状态在 `<container>/tmp/agent-task-runs`，锁在 `<container>/tmp/agent-locks`；两者通常位于 `repo` 之外，且不等同于系统临时目录。linked worktree 也使用主项目解析出的容器路径。`workspace-write` 只覆盖当前会话允许的目录，不能假定整个容器可写。

环境初始化时由用户或管理员核对实际可写根，按需要将精确容器目录纳入授权范围；配置示例仅提供注释，不自动改配置或移动现有状态。目录解析或操作系统访问检查都不能证明平台放行。已发生策略拒绝时保留回执、继续获准且独立的只读核查，禁止以扩大权限、换入口或搬迁记录重试同一被拒绝动作。

## 🛡️ 安全考虑

### 团队配置的平衡策略

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

- ✅ 沙箱内常规操作可直接执行，需要时请求批准
- ✅ 允许修改项目文件
- ✅ 允许网络访问
- ❌ 禁止修改系统文件
- ⚠️ 异常情况需要确认

### 个人配置的风险

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"

[sandbox_danger_full_access]
network_access = true
```

- ⚠️ 不请求交互审批；操作仍可能被策略拒绝
- ⚠️ 可以修改任何文件（包括系统文件）
- ⚠️ 可以执行危险操作
- ⚠️ 允许任意网络访问
- 平台策略、命令规则和操作系统权限仍然适用，不能承诺所有操作均获准

**建议**：
1. 只在信任的项目中使用
2. 定期检查操作历史
3. 重要文件先备份

## 🔧 配置示例

### 示例 1：保守模式（最安全）

```toml
approval_policy = "on-request"
sandbox_mode = "read-only"
```

**适用**：新项目、不信任的代码库

### 示例 2：平衡模式（推荐）

```toml
approval_policy = "on-request"
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
git add .codex/config.example.toml .codex/hooks.json .codex/README.md
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

**最后更新**：2026-08-27
**版本**：3.1 (移除已弃用的审批策略)


### 失败分类与恢复

拒绝发生在 shell 进程启动前时，仓库脚本无法捕获它；不要将执行工具的 `CreateProcess … blocked by policy` 等同于脚本返回的 `STATUS=BLOCKED / REASON=…`。不以错误关键词猜测未公开的审批规则。

仅有 `blocked by policy` 不能证明 Auto-review 参与，也不能证明具体路径违规或 pnpm 故障。准确表述为“执行工具策略拒绝，具体规则未知”；只有回执明确标识审查来源和理由时才报告具体审批组件。脚本无法给启动前的拒绝补造原因。

所有执行器统一遵循 [通用约定：失败分类与恢复](../docs/CONVENTIONS.md#失败分类与恢复)，其中定义失败分类、启动状态证据、记录不可用时的对话留痕和恢复门禁。

已有任务且 checkpoint 本身可执行时，可单独记录明确未启动的策略拒绝：

```bash
pnpm agent -- task checkpoint --task <id> --step S1 --status blocked --failure-kind policy_denied --execution-state not_started --call-id <id> --evidence "<脱敏拒绝事实>" --next "<查询具体拒绝原因>"
```

没有明确未启动证据时使用 `unknown` 和 `verify_required`；不能把外层工具处理器启动误当成子进程启动。任务记录本身被拒绝时不执行此示例，按通用协议在对话留痕。
