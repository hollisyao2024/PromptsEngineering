# PRD-WRITER-EXPERT Playbook

> 角色定义、输入输出与 DoD 见 `/AgentRoles/PRD-WRITER-EXPERT.md`。
> 主 PRD 总纲模板见 `/docs/data/templates/prd/PRD-TEMPLATE.md`；模块详细需求见 `/docs/prd-modules/MODULE-TEMPLATE.md`。
> **路径基准**：本文件中所有相对路径以 `repo/`（Git 主 worktree 根）为基准；详见 `/docs/CONVENTIONS.md` §路径与仓库拓扑。

## 核心工作流程

### 1. 需求收集阶段
- 主动询问产品背景、目标用户、核心价值主张
- 了解业务目标、成功指标和约束条件
- 收集竞品信息和市场环境

### 2. 需求分析阶段
- 将模糊想法转化为清晰的功能需求
- 定义用户画像和使用场景
- 确定功能优先级和依赖关系

### 3. 方案设计阶段
- 设计用户体验流程和交互方案
- 提供技术实现建议和架构概述
- 评估实现难度和资源需求

### 4. 文档编写阶段
- 生成结构化的主 PRD 总纲并保存至 `/docs/PRD.md`
- 创建 `/docs/prd-modules/module-list.md`，并为每个功能域生成 `/docs/prd-modules/{domain}/PRD.md`
- 在模块 PRD 中为每项功能定义明确的验收标准与追溯关系
- 包含时间规划、里程碑及风险/依赖说明

### 5. 用户体验设计（UX）
UX 设计流程与交付标准详见 `/docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md`；视觉与无障碍取值统一建立在根目录 `DESIGN.md`（骨架见 `/docs/data/templates/prd/DESIGN-TEMPLATE.md`）。PRD 专家需确保以下四项在 PRD 阶段启动：
- 关键用户旅程与线框图/原型
- 设计系统 Token 定义（写入 `DESIGN.md`）
- WCAG 2.1 AA 无障碍合规（目标写入 `DESIGN.md` 的 Accessibility）
- 响应式断点矩阵（写入 `DESIGN.md` 的 Layout）

存量项目（样式已存在）补建 `DESIGN.md` 时：
- 取值以样式表中实际生效的为准：同名属性后者覆盖前者，`@layer` 外的声明覆盖层内声明，`var()` 展开后再记录。
- 已有的硬编码色值、字号和偏离间距档位如实记为已知偏差，写入 Do's and Don'ts，不当作契约，也不在同一次变更里改样式。
- 取值或意图无法从代码判定的条目标【待确认】，交项目负责人裁定，不自行猜测。

项目接入官方 lint（`@google/design.md`）时，以退出码为门禁，不以警告条数为门禁；`orphaned-tokens` 对由样式表消费、没有组件引用的 Token（shadcn 风格）属结构性噪声，不为消除警告而虚构组件。

纯后端项目可标注"不适用"并跳过。

### 6. 实施计划
- 开发里程碑
- 资源需求评估
- 风险识别与应对
- 测试验收计划（与任务规划阶段对齐）

---

## 7. 需求验证前置检查清单（Shift-Left）

> **目的**：在 PRD 阶段提前发现技术不可行、合规风险、依赖冲突等问题，避免后续返工。

在 PRD 交付评审前，逐项检查：

### 技术可行性
- [ ] 新技术栈评估：是否涉及团队未使用过的技术？如是，是否已完成 PoC？
- [ ] 数据量级评估：是否超过现有架构承载能力？
- [ ] 第三方依赖：API 稳定性（SLA）、费用、备用方案？
- [ ] 性能预估：核心功能性能目标是否合理？是否需要 ARCH 提前评估？

**处理**：技术风险高的 Story 标记"需 PoC"，记入 PRD "风险与约束"章节。

### 数据合规性
- [ ] 敏感数据收集：是否涉及 PII、联系方式、财务信息、生物特征？
- [ ] 法律法规符合性：GDPR / PIPL / COPPA / 行业特定法规
- [ ] 数据保留策略：注销后数据处理方式、日志保留期限
- [ ] 隐私政策更新：是否需要法务审核？

**处理**：敏感数据 Story 必须新增"数据合规"章节，审批时间计入里程碑。

### 依赖风险
- [ ] 依赖的 Story 是否已确认可行？是否存在循环依赖？
- [ ] 跨模块依赖：是否已与对方团队确认交付时间？
- [ ] 外部依赖：外部系统是否支持所需接口？

**处理**：模块内依赖见 `dependency-graph.md`；跨模块依赖见 `/docs/data/global-dependency-graph.md`；高风险标记为"阻塞风险"。

### 验收标准完备性
- [ ] 每个 Story 至少有 1 个 AC（Given-When-Then 格式）
- [ ] AC 可量化验证（避免"用户体验良好"等模糊描述）
- [ ] AC 覆盖正常场景和异常场景
- [ ] AC 与 Test Case ID 关联（在追溯矩阵中）
- [ ] 有页面或客户端界面的功能域，模块 PRD 附录 A 维护原子 AC 表：一行一条 AC，Given/When/Then 分列，优先级、验证方式、端与 TC 列齐全，Then 写可断言的结果（状态、文案、错误码或数据）
- [ ] 原子 AC 表通过 `pnpm agent -- qa paths` 校验（无 `VIOLATION=` 行）；无法自动化的 AC 标为 `manual` 并写明原因
- [ ] 期望值来自 PRD、数据字典、UX 规范与 ARCH 接口契约，不依赖被测代码当前的输出；有歧义的 AC 在 PRD 阶段澄清，不留给测试阶段猜测

**处理**：不符合要求的 Story 退回修改，通过 `/docs/data/traceability-matrix.md` 确保可追溯；原子 AC 如何被 QA 用于路径推导与自动化验收，见 QA Playbook「业务测试自动化」一章。

### 业务目标对齐
- [ ] 每个 Story 关联至少 1 个业务目标（Objective）或 KR
- [ ] Story 的预期贡献可量化
- [ ] Story 集合能覆盖业务目标

**处理**：通过 `/docs/data/goal-story-mapping.md` 验证；"孤儿 Story" 评估是否删除或延后。

### 角色覆盖完整性
- [ ] 每个用户角色的核心需求都有对应 Story
- [ ] 不存在"孤儿角色"（覆盖率 < 30%）
- [ ] 权限定义清晰

**处理**：通过 `/docs/data/persona-story-matrix.md` 检查角色覆盖。

### 非功能需求（NFR）明确
- [ ] 每个核心 Story 至少关联 1 个 NFR
- [ ] NFR 有明确目标值
- [ ] NFR 有验证方式

**处理**：模块级 NFR 见 `nfr-tracking.md`；全局级在主 PRD §5 定义。

### 文档完整性
- [ ] 主 PRD 包含所有必需章节
- [ ] 追溯矩阵已创建
- [ ] 全局依赖图已创建（如需）
- [ ] `docs/prd-modules/module-list.md` 已创建并与主 PRD 功能域索引一致
- [ ] 每个功能域均有模块 PRD，且遵循标准结构

**处理**：可运行 `pnpm run prd:lint` 检查文档完整性。

---

### 技术评审会（可选，PRD 70% 完成时）
- 参与：PRD（主持）+ ARCH + TDD + QA + 业务代表
- 产出：技术风险评估报告、需 PoC 的 Story 清单、需新增 ADR 的技术决策、调整后的里程碑

---

## 8. 用户体验验证清单（UX Validation Checklist）

> **目的**：在 PRD 交付前确保 UX 设计交付物完整、合规且可实施。
> 完整检查细节详见 `/docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md` 对应章节。

在 PRD 交付评审前，逐项检查：

### 用户研究有效性
- 用户画像与 PRD §3 用户角色对齐，关键旅程覆盖 P0/P1 Story，痛点已映射到具体 Story/AC

### 线框图/原型完整性
- 所有关键页面/视图有低保真线框图，P0 Story 有高保真原型，可用性测试≥3 人次

### 设计系统一致性
- 根目录 `DESIGN.md` 已建立并定义 Design Tokens（色彩/排版/间距），基础组件清单已确定且有状态说明

### WCAG 无障碍合规性
- `DESIGN.md` 的 Accessibility 已写明对比度与触控目标，键盘可达所有功能，语义化 HTML 要求已传达

### 响应式设计覆盖
- `DESIGN.md` 的 Layout 已定义断点与各断点布局策略，触控目标达到其 Accessibility 目标

### 设计-开发交接准备
- 设计标注完整，组件映射表就绪，资源导出完成，`/docs/data/ux-specifications.md` 已创建/更新

**处理方式**：未通过项标记为"待完善"并列入 PRD 开放问题；阻塞性 UX 问题在 PRD 风险章节记录。
