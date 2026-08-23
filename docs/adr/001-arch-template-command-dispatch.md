# ADR-001：扩展现有模板命令执行面

- 状态：Accepted
- 日期：2026-08-23
- 关联：CR-20260823-001、US-CMDSURF-001~004

## 背景

模板已有服务生命周期、环境检查和部署 dispatcher，但缺少客户端开发/构建的稳定入口；目标项目因此在 `RULES.md` 和 package aliases 中维护完整命令表。

## 决策

扩展现有 `agent-cli.js` 与 `devops-run.js`，新增 `app dev/build` 动作。`config.example.json` 登记完整规范 alias 默认矩阵，项目根 `agent.config.json` 保持稀疏并通过深合并继承或叶级覆盖。用户可见 private 服务重启统一写作 `/private restart`；执行器内部仍以显式 target/profile 精确选择项目命令。真实 `/ship` 保持空默认值。

## 被拒绝方案

- 原样复制项目命令表：会硬编码产品和平台实现。
- 新建独立客户端命令系统：形成第二执行面和证据模型。
- 向目标 `package.json` 强制添加全部实现：模板无法安全推断框架、平台构建器、签名或部署流程。
- 只保留空默认值：模板更新后实际项目无法解析稳定快捷命令，违背统一入口目标。

## 后果

- 正向：统一语义、可测试、可传播，项目差异保持外置。
- 代价：项目需要实现规范 alias，或在稀疏配置中覆盖对应叶值。
- 风险控制：显式 profile 不允许回退；缺失命令 fail closed；模板传播验证 project-owned 文件不变。
