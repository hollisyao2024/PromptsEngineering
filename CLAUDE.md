# 强制规范 — AGENTS.md 多专家协作框架

以下 `@./AGENTS.md` 为本项目核心路由规范，**强制生效**。

- 激活专家时，**立即** Read `AgentRoles/<对应专家>.md`，读取完成前禁止执行任何操作
- 未激活时，不主动加载专家文件

@./AGENTS.md

## Plan Mode 执行衔接规则

接受计划（plan mode 批准）后开始执行时，**第一步必须**：
1. 识别任务对应专家：实现代码 → TDD、测试 → QA、部署 → DEVOPS、需求 → PRD、架构 → ARCH、任务拆解 → TASK
2. 发出 `[[ACTIVATE: X]]` 并立即读取 `AgentRoles/<X>-EXPERT.md`
3. 专家文件读取完成后，再执行具体步骤

同时，写 plan 文件时必须将专家激活作为 **Step 0** 写入：

```markdown
## Step 0：激活专家
[[ACTIVATE: TDD]]  <!-- 替换为实际专家 -->
```

<!-- ⚠️ 以上为模板核心区域，禁止修改。定制内容在分隔线后追加，变更仅在模板源项目（PromptsEngineering）中进行后同步。 -->

---
