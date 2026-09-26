# Gemini CLI 配置说明

本目录包含 Gemini CLI 的配置文件，用于控制 AI 辅助编程的行为和权限。

## 📁 文件说明

### `settings.json` - 团队共享配置
- **用途**：团队成员共享的基础安全配置
- **提交状态**：✅ 应提交到 Git 仓库
- **目标**：设定安全基准，所有操作需要确认（保守策略）

### `settings.local.json` - 历史示例
- 当前 Gemini CLI 不读取此文件；它仍被 Git 忽略，但其中的设置不会生效。
- 项目设置应写在 `.gemini/settings.json`。息壤同步保留已有字段值；若需要不同压缩水位，可在项目中调整 `model.compressionThreshold`。

## 自动压缩水位

`.gemini/settings.json` 设置 `model.compressionThreshold = 0.18`。Gemini CLI 按当前模型的上下文窗口比例触发压缩，1M 窗口约对应 180k token；换用其他窗口大小时，触发 token 数随之变化。工作区未获信任时，Gemini CLI 不加载项目设置。已运行的会话需重新启动才会读取新配置。

## 🎯 配置策略

### 团队共享配置 (`settings.json`)

#### 上下文配置
```json
{
  "context": {
    "fileName": ["AGENTS.md"]
  }
}
```
- 指定上下文文件为 `AGENTS.md`（AGENTS 路由系统的核心）

#### 文件设置
- `file.autoSave: true` - 自动保存工具发起的代码变更
- `file.confirm: true` - 应用文件变更前需要用户确认 ⚠️

#### 执行与网络
- `bash.autoExecute: false` - 执行 shell 命令前需要确认 ⚠️
- `networking.autoPermit: false` - 访问网络前需要确认 ⚠️

#### 工具设置
- `mcp.autoConnect: true` - MCP 服务器自动连接 ✅
- `slashCommand.autoExecute: false` - 斜杠命令前需要确认 ⚠️
- `jupyter.autoEdit: false` - Jupyter 编辑前需要确认 ⚠️

### 旧版个人配置示例（当前 Gemini CLI 不读取）

#### 完全自动化配置
```json
{
  "bash.autoExecute": true,
  "file.autoSave": true,
  "file.confirm": false,
  "networking.autoPermit": true,
  "mcp.autoConnect": true,
  "slashCommand.autoExecute": true,
  "jupyter.autoEdit": true
}
```

**说明**：
- 所有操作自动执行，无需确认
- 覆盖团队配置的保守策略
- 适合信任环境和快速迭代

## 🔄 配置合并规则

配置按以下优先级合并（从高到低）：
1. 工作区配置（项目 `.gemini/settings.json`）
2. 用户全局配置（`~/.gemini/settings.json`）

`settings.local.json` 不参与合并；现有项目自定义值保留在工作区配置中。

## 📊 使用场景对比

### 默认工作区配置
```
Bash 命令    → ⚠️ 需要确认
文件编辑     → ⚠️ 需要确认
网络访问     → ⚠️ 需要确认
MCP 连接     → ✅ 自动执行
斜杠命令     → ⚠️ 需要确认
Jupyter 编辑 → ⚠️ 需要确认
```

**适用场景**：
- 新成员熟悉项目阶段
- 不信任的代码库
- 高安全性要求的环境

### 旧版个人配置示例（当前不会生效）
```
Bash 命令    → ✅ 自动执行
文件编辑     → ✅ 自动执行
网络访问     → ✅ 自动执行
MCP 连接     → ✅ 自动执行
斜杠命令     → ✅ 自动执行
Jupyter 编辑 → ✅ 自动执行
```

如需更改实际行为，请使用 Gemini CLI 支持的 `.gemini/settings.json` 字段并提交项目变更。

## 🛡️ 安全考虑

### 团队配置的保守策略

团队配置采用"默认拒绝"策略：
- ✅ 防止新成员意外执行危险操作
- ✅ 提供审核机会
- ✅ 降低供应链攻击风险

### 个人配置的风险

启用完全自动化时，需注意：
- ⚠️ AI 可能执行意外的 bash 命令
- ⚠️ 文件修改可能覆盖重要内容
- ⚠️ 网络访问可能泄露敏感信息

**建议**：
1. 只在信任的项目中使用完全自动化
2. 定期审查 AI 的操作历史
3. 重要操作前先备份

## 🚀 如何自定义

### 修改项目压缩阈值

在已有 `.gemini/settings.json` 的 `model` 对象中调整 `compressionThreshold`。例如，1M 窗口模型下 `0.18` 约对应 180k token。已有项目值在息壤同步时保留。

### 旧版部分自动化示例（当前字段需按官方文档核对）

如果你只想自动化某些操作：

```json
{
  "bash.autoExecute": true,
  "file.autoSave": true,
  "file.confirm": false,
  "networking.autoPermit": false,
  "slashCommand.autoExecute": false
}
```

这样可以：
- ✅ 自动执行 Bash 和文件编辑
- ⚠️ 网络访问和斜杠命令仍需确认

## 🆚 与 Claude Code 配置的区别

| 特性 | Gemini CLI | Claude Code |
|------|-----------|-------------|
| **配置格式** | JSONC（支持注释） | JSON（不支持注释） |
| **权限粒度** | 全局开关 | 细粒度规则 |
| **沙箱支持** | 无 | 有（macOS/Linux） |
| **上下文文件** | `context.fileName` | 读取 `CLAUDE.md` |

## 📚 相关文档

- AGENTS 路由系统：`/AGENTS.md`
- Claude Code 配置：`/.claude/README.md`
- 项目规范：`/docs/CONVENTIONS.md`

## 🤝 团队协作

### 提交变更

修改团队配置后，提交到 Git：
```bash
git add .gemini/settings.json
git commit -m "chore: update team Gemini CLI settings"
```

### 不要提交

历史 `settings.local.json` 不应提交，Gemini CLI 也不会读取：
```bash
# settings.local.json 已在 .gitignore 中
# 无需手动排除
```

## 💡 最佳实践

### 新成员入职
1. 克隆仓库后，先使用团队配置（有确认提示）
2. 熟悉项目后，按 Gemini CLI 当前设置文档修改项目的 `.gemini/settings.json`
3. 根据个人偏好调整自动化程度

### 敏感操作
即使启用完全自动化，以下操作仍建议手动执行：
- 数据库迁移
- 生产环境部署
- 删除文件或目录
- 修改 `.env` 配置

### 代码审查
定期检查 AI 的操作：
```bash
git log --author="Gemini"
git diff HEAD~10 HEAD
```

---

**最后更新**：2025-11-05
**维护者**：项目团队
