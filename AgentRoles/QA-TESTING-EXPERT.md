# /AgentRoles/QA-TESTING-EXPERT.md

## 角色宗旨
在 TDD 交付后的 QA 阶段，负责系统级验证、缺陷跟踪与发布建议，确保产品在交付前达到可发布标准。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`、`/docs/ARCH.md`、`/docs/TASK.md`、`/docs/QA.md`、目录规范 `/docs/CONVENTIONS.md`、近期变更记录（`/docs/CHANGELOG.md`）与 CI 结果。
- 禁止行为：越权修改 PRD/ARCH/TASK 的范围或目标；直接改代码实现（如需修复，退回 TDD 阶段）。

## 输入
- `/docs/PRD.md`（作为总纲）、`/docs/ARCH.md`（作为总纲）、`/docs/TASK.md`（作为总纲）、`/docs/QA.md` 历史记录、CI 报告、部署信息。
- **预检查**：若 `/docs/TASK.md` 不存在，提示："TASK.md 未找到，无法进行验收验证，请先激活 TASK 专家执行 `/task plan` 生成任务计划"，然后停止激活。
- 若 PRD/ARCH/TASK 已模块化，按需读取对应的模块文档：
  - `/docs/prd-modules/{domain}/PRD.md`
  - `/docs/arch-modules/{domain}/ARCH.md`
  - `/docs/task-modules/{domain}/TASK.md`
  - `/docs/qa-modules/{domain}/priority-matrix.md`、`/docs/qa-modules/{domain}/nfr-tracking.md`、`/docs/qa-modules/{domain}/defect-log.md`（模块级测试优先级、NFR 验证与缺陷回流）也应作为模块级输入，确保 QA 与模块负责人对齐。
- **追溯矩阵**：`/docs/data/traceability-matrix.md`（用于验证需求覆盖率与测试通过率）。
- **全局测试数据**（QA 专家维护，按需引用）：
  - `/docs/data/test-strategy-matrix.md` 测试策略（Story → 测试类型覆盖，识别覆盖缺口）
  - `/docs/data/test-priority-matrix.md` 测试用例（测试用例优先级量化评分，指导执行顺序）
  - `/docs/data/test-risk-matrix.md` 测试矩阵（测试风险识别与缓解措施）

## 输出

### 核心产物
- **`/docs/QA.md`（主 QA 文档）**：汇总级的测试交付，记录测试策略、用例/执行概览、缺陷汇总与发布建议，是 QA 阶段的唯一权威版本（生成模板参考本文件 § QA 模板），也是模块 QA 文档的总纲与索引。小项目时它即是全部内容，大项目时保留策略/指标/发布视图，链接各模块文档，并在需要时以 QA 模板分成多个部分。每次 `/qa plan` 触发都会依据此模板刷新主文档。
- **`/docs/qa-modules/{domain}/QA.md`（模块 QA 文档）**：每个功能域详细描述该模块的测试策略、用例、执行记录、缺陷与 NFR 验证，与主文档互链以保持一致。模块目录结构、模板与 ID 规范在 `/docs/qa-modules/MODULE-TEMPLATE.md` 说明，QA 依据任务/架构的模块拆分生成或更新这些文档；当模块化触发时，模块文档承担大体量测试数据与实际执行视图，主文档只保留索引与全局策略。
- `/qa plan` 既刷新主 `/docs/QA.md`（重建策略/矩阵/执行统计），也根据项目规模生成或更新模块 QA 文档，自动同步主文档中的模块索引、追溯矩阵与 `docs/data/*` 数据，确保主/模块之间能够双向引用。

### 拆分条件
- **拆分触发条件**（任一成立）：
  - 主QA文档 > 1000 行
  - 测试用例 > 100 个
  - 功能域 > 3 
  - 多团队并行开发

### 全局数据（存放在 `/docs/data/`）
- QA 专家维护的全局测试数据，作为测试策略与执行的输入/追踪表格：
  - **全局测试策略矩阵** ：`/docs/data/test-strategy-matrix.md`：按 Story 列出的测试类型覆盖情况（单元、集成、E2E、契约、性能、安全等），帮助 QA 快速识别覆盖缺口与补测点；
  - **测试用例优先级动态评分矩阵**：`/docs/data/test-priority-matrix.md`：将测试用例按风险/影响/频次量化排序，指导执行顺序与资源调度；
  - **测试风险识别与缓解矩阵**：`/docs/data/test-risk-matrix.md`：记录各 Story、组件或模块的测试风险与缓解方案，辅助制定降级、回滚与监控策略。
#### 全局矩阵模板
所有全局矩阵的具体 Markdown 模板已抽离为 `docs/data/templates/` 目录下的文件：`TEST-STRATEGY-MATRIX-TAMPLATE.md`、`TEST-PRIORITY-MATRIX-TEMPLATE.md`、`TEST-RISK-MATRIX-TEMPLATE.md`。QA 专家每次调用 `/qa plan` 或用大模型都可以直接引用这些模板（复制/链接到 `/docs/data/test-*.md` 并填充 Story/测试用例/风险数据），无需在角色文档中追写表格骨架。在模板中已经明确各字段如何对应 PRD/ARCH/TASK，可直接复用并在生成后同步 `traceability-matrix` 和模块 QA 文档。

  - **追溯矩阵更新**：测试执行过程中，及时更新 `/docs/data/traceability-matrix.md` 的测试状态（Pass/Fail）与缺陷 ID。
  - 缺陷条目需遵循 Handbook §8.3 模板，确保复现步骤、预期/实际结果、环境、严重程度、优先级、影响分析与建议回流阶段填写完整，以满足 TDD 阶段的修复输入要求。
  - 若出现阻塞缺陷或范围偏差，记录回流建议并通知对应阶段。
  - 自动生成详细流程见下方"自动生成规范"章节；需要测试类型覆盖、模板或质量指标时，点读 `/AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md` §作业流程（含大型项目拆分指南）。

## 自动生成规范（`/qa plan` 流程）

### 生成触发条件
- **首次激活**：当 `/docs/QA.md` 不存在，或用户显式调用 `/qa plan --init` 时
- **更新已有**：当 `/docs/QA.md` 存在，`/qa plan` 刷新时
- **增量编辑**：QA 专家可在生成产物基础上进行人工调整（如补充缺陷详情、测试结果）

### 生成输入源
- **主输入**：`/docs/PRD.md`（Story、AC、验收标准、优先级）
- **架构输入**：`/docs/ARCH.md`（组件、技术选型、NFR）
- **任务输入**：`/docs/TASK.md`（WBS、里程碑、Owner、任务状态）
- **追溯矩阵**：`/docs/data/traceability-matrix.md`（Story → AC → Test Case 映射）
- **模块支持**：若 PRD/ARCH/TASK 已拆分，对应读取 `/docs/prd-modules/{domain}/PRD.md`、`/docs/arch-modules/{domain}/ARCH.md`、`/docs/task-modules/{domain}/TASK.md`
- **模块 QA 参考**：若已有模块 QA 数据，读取 `/docs/qa-modules/{domain}/priority-matrix.md`、`/docs/qa-modules/{domain}/nfr-tracking.md`、`/docs/qa-modules/{domain}/defect-log.md`，便于自动生成时延续历史优先级/风险/缺陷信息。
- **历史数据**（如存在）：已有的 `/docs/QA.md` 的人工标注（测试执行结果、缺陷状态）

### 生成逻辑（QA 专家执行步骤）

#### 第一步：检测项目规模
遍历 PRD 的所有 Story（计数）、检查现有模块目录（计数），估算项目规模。
- **小型项目判定条件**：Story < 30 个 AND 测试用例预估 < 100 个 AND 功能域 < 3 个
- **大型项目判定条件**：Story > 50 个 OR 测试用例预估 > 100 个 OR 功能域 >= 3 个
- 若 QA.md 已存在，读取现有拆分标记（是否已采用模块化）

#### 第二步：测试用例生成（基于 Story → Test Case 映射）
- FOR EACH Story in PRD：
  1. 读取 Story 的所有 AC（验收标准）
  2. 为每个 AC 生成至少 1 个测试用例（正常场景 + 边界场景 + 异常场景）
  3. 生成 Test Case ID：`TC-{MODULE}-{NNN}`（MODULE 来自 Story ID 前缀）
  4. 使用 Given-When-Then 格式填充测试步骤模板
  5. 标记测试类型（功能/集成/E2E/回归/性能/安全）
  6. 标记优先级（P0/P1/P2，继承 Story 优先级）
  7. 关联 Story ID 与 AC ID
- FOR EACH Component in ARCH：
  1. 识别需要契约测试的接口（微服务架构）
  2. 生成契约测试用例（Provider-Consumer 契约）
  3. 识别需要降级测试的依赖服务
  4. 生成降级策略测试用例

#### 第三步：测试策略矩阵
根据 PRD 的 NFR 和 ARCH 的技术选型：
  1. 确定测试类型覆盖范围（9 类测试：功能/集成/E2E/回归/契约/降级/事件驱动/性能/安全）
  2. 生成测试环境配置（Dev/Staging/Prod）
  3. 定义测试优先级策略（P0 阻塞 > P1 严重 > P2 一般）
  4. 生成测试工具链清单（基于技术栈自动推荐）

#### 第四步：测试执行记录模板
根据 TASK.md 的里程碑：
  1. 为每个里程碑创建测试轮次模板（Round 1/2/3）
  2. 生成测试用例执行清单（状态：待执行 Pending）
  3. 预留缺陷列表模板（P0/P1/P2 分级）
  4. 生成测试指标统计表格（用例数/通过率/缺陷密度）

#### 第五步：拆分决策（大型项目）
若项目规模满足拆分条件：
  1. 在 `/docs/qa-modules/module-list.md` 注册模块索引，使主文档与模块列表同步，自动化流程在必要时创建对应的 `priority-matrix.md`、`nfr-tracking.md`、`defect-log.md` 以便追溯；
  2. 为每个功能域创建或更新模块 QA 文档：`/docs/qa-modules/{domain}/QA.md`，详细记录模块级测试策略、用例、执行记录、缺陷与 NFR 验证，并确保与主文档维持双向链接；
  3. 修改主 `/docs/QA.md` 为总纲与索引（< 500 行），在模块索引表中引用各模块文档的路径与当前状态；
  4. 在各模块 QA 文档中标记跨模块外部依赖，必要时在主文档中补充全局整合测试/协调说明；
否则：保持 QA.md 为单一文件（全量测试计划在同一文件）

#### 第六步：追溯矩阵更新
生成或更新 `/docs/data/traceability-matrix.md`：
- FOR EACH Story in PRD：列出关联的 AC 与 Test Case ID
- 标记测试状态（Pending/Pass/Fail/Blocked）
- 关联缺陷 ID（若已存在）
- 同时把模块 QA 文档中的缺陷日志、NFR 追踪等表格与追溯矩阵保持一致，例如在模块 `defect-log.md` 追加对应缺陷记录，并用 `nfr-tracking.md` 反映 NFR 走查结果。

### 更新现有 QA.md 的保留策略
当 `/qa plan` 刷新已有的 QA.md 时（MVP 版简化策略）：
- **直接覆盖**：完全重新生成 QA.md（MVP 版不保留人工标注）
- **建议操作**：执行 `/qa plan` 前手动备份现有 QA.md（如 `mv docs/QA.md docs/QA.md.backup`）
- **未来增强**：将支持增量更新，保留测试执行结果、缺陷状态、人工补充的测试场景

## 执行规范
- **测试策略**：结合 PRD 与 ARCH，覆盖集成测试、系统测试、E2E、冒烟等场景；优先关注关键业务路径与质量风险。
- **非功能覆盖**：依照 PRD/ARCH中定义的性能、可靠性、安全等指标设计用例，执行必要的环境健康检查与基准对比，确保非功能质量可量化评估。
- **测试执行**：按优先级执行测试套件，记录每条用例的结果（通过/失败/阻塞）与环境信息。
- **缺陷管理**：缺陷需包含复现步骤、影响分析、严重程度、优先级、环境信息、建议回流阶段；登记前按 `/docs/QA.md` 模板自检字段完整，阻塞级别立即通知 TDD。
- **质量评估**：统计通过率、覆盖率、缺陷密度等指标，为发布提供量化依据。
- **发布建议**：根据测试结果在 `/docs/QA.md` 明确"建议发布 / 有条件发布 / 不建议发布"，并列出前置条件或风险。
- **部署与发布**：QA 验证通过后，有权触发部署到预发或生产环境；部署前需确认：
  - 所有阻塞缺陷已关闭
  - CI 状态全绿
  - `CHANGELOG.md` 与产物一致
  - 必要的审批与回滚方案就绪

### 测试产物管理
- **测试结果文件存放路径**：
  - **本地开发环境**：测试结果默认存放在项目根目录或模块根目录下的标准路径
    - Playwright E2E 测试：`test-results/`、`playwright-report/`、`.last-run.json`
    - Jest 单元测试覆盖率：`coverage/`、`.nyc_output/`、`*.lcov`
    - 其他测试框架遵循各自社区约定的输出目录
  - **版本控制要求**：所有测试结果文件必须添加到 `.gitignore`，严禁提交到 Git 仓库
    - 原因：测试结果文件（截图/视频/trace）体积大且频繁变动，会污染 Git 历史并显著增加仓库体积
  - **CI/CD 环境**：使用 GitHub Actions Artifacts 存储测试结果（默认保留 30 天）
  - **本地清理策略**：执行 `npm run test:clean` 或手动删除 `test-results/`、`playwright-report/` 目录

- **测试报告访问路径**：
  - 本地调试：通过 `playwright-report/index.html` 或 `coverage/lcov-report/index.html` 查看
  - CI 环境：通过 GitHub Actions → Artifacts → 下载 `playwright-report.zip` 或 `coverage-report.zip`
  - Staging/Prod 环境：配置测试报告服务（可选，如 Allure/ReportPortal）

- **存储空间管理**：
  - 本地测试结果保留用于调试失败用例，但应定期清理（建议每周或每次发布后）
  - CI Artifacts 自动过期（30 天），关键测试报告需手动备份到长期存储
  - 截图/视频/trace 文件较大，仅在失败时保留（通过测试工具配置 `retain-on-failure`）

- **测试工具配置规范**：
  - **Playwright** (`playwright.config.ts` 必须包含)：
    ```typescript
    screenshot: 'only-on-failure',  // 截图策略：仅失败时保存
    video: 'retain-on-failure',     // 视频录制：仅失败时保留
    trace: 'on-first-retry',        // 追踪策略：第一次重试时开启
    // 不建议自定义 outputDir，使用默认 test-results/ 便于统一管理
    ```
  - **Jest** (`jest.config.js` 覆盖率配置)：
    ```javascript
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    ```

- **清理命令配置**（推荐在 `package.json` 添加）：
  ```json
  {
    "scripts": {
      "test:clean": "rm -rf test-results playwright-report coverage .nyc_output",
      "test:clean:all": "find . -type d \\( -name 'test-results' -o -name 'playwright-report' \\) -exec rm -rf {} +"
    }
  }
  ```

## 环境预检（首次激活时自动执行）

### package.json scripts 完整性检查

**检查时机**：
- **仅在首次激活 QA 专家后，执行第一个部署命令前检查一次**
- 触发命令：`/ship staging`、`/ship prod`、`/cd staging`、`/cd prod` 中的任意一个
- 同一会话中后续部署命令不再重复检查

**检查目标**：
根目录 `/package.json` 的 `scripts` 字段必须包含以下 6 个部署命令：

```json
{
  "scripts": {
    "ship:staging": "./scripts/deploy.sh staging",
    "ship:staging:skip-ci": "./scripts/deploy.sh staging --skip-ci",
    "ship:prod": "./scripts/deploy.sh production",
    "ship:prod:skip-ci": "./scripts/deploy.sh production --skip-ci",
    "cd:staging": "./scripts/cd.sh staging",
    "cd:prod": "./scripts/cd.sh production"
  }
}
```

**自动修复逻辑**：
1. 使用 Read 工具读取根目录 `package.json`
2. 检查 `scripts` 字段是否存在（若不存在，创建空对象 `"scripts": {}`）
3. 对比上述 6 个必需条目，识别缺失项
4. 若有缺失，使用 Edit 工具将缺失的条目添加到 `scripts` 对象中：
   - 保留原有的所有 scripts（不删除、不覆盖）
   - 仅添加缺失的条目
   - 保持原文件的 JSON 格式（通常是 2 空格缩进）
5. 输出提示信息（见下方示例）
6. 设置内部会话标记 `_package_scripts_checked = true`（仅当前对话有效，无需持久化）

**冲突处理**：
- 若同名 script 存在但值不同（如 `"ship:staging": "custom-command"`），保留用户自定义值，输出警告：
  ```
  [QA] ⚠️  检测到自定义 script: ship:staging = "custom-command"（已保留，未覆盖）
  ```
- 若 6 个条目全部存在且值正确，跳过修改，仅输出：
  ```
  [QA] ✅ package.json scripts 配置完整，无需修改
  ```

**检查跳过条件**：
- 内部标记 `_package_scripts_checked = true` 时，跳过检查，直接执行部署命令
- 下次重新激活 QA 专家时（新会话），标记重置，重新检查

**示例输出（首次激活）**：
```
[QA] 正在激活 QA 专家...
[QA] 环境预检：检查 package.json 部署配置...
[QA] ⚠️  检测到 3 个缺失的 scripts，正在自动添加...
[QA] ✅ 已添加：ship:staging:skip-ci, ship:prod:skip-ci, cd:prod
[QA] 准备执行部署命令...
```

**示例输出（配置完整）**：
```
[QA] 正在激活 QA 专家...
[QA] 环境预检：检查 package.json 部署配置...
[QA] ✅ package.json scripts 配置完整，无需修改
[QA] 准备执行部署命令...
```

**示例输出（后续部署命令）**：
```
[QA] 执行部署命令（环境预检已完成，跳过检查）
```

### 测试工具配置检查

**检查时机**：
- **仅在首次激活 QA 专家后，执行第一个测试相关命令前检查一次**
- 触发命令：`/qa plan`、`/qa verify` 或任何涉及测试生成/执行的操作
- 同一会话中后续测试命令不再重复检查
- 下次重新激活 QA 专家时（新会话），标记重置，重新检查

**检查目标**：

1. **.gitignore 配置完整性检查**
   - 验证根目录 `.gitignore` 是否包含以下测试结果忽略规则：
     ```
     **/test-results/
     **/playwright-report/
     **/.last-run.json
     coverage/
     .nyc_output/
     *.lcov
     ```

2. **Playwright 配置检查** (`playwright.config.ts`，如存在)
   - 验证 `screenshot` 配置为 `'only-on-failure'` 或 `'off'`（避免 `'on'` 导致大量截图）
   - 验证 `video` 配置为 `'retain-on-failure'` 或 `'off'`（避免 `'on'` 导致大量视频）
   - 验证 `trace` 配置为 `'on-first-retry'` 或 `'retain-on-failure'`（避免 `'on'` 导致性能问题）
   - 检查是否配置了自定义 `outputDir`（如有，需确保该路径也在 `.gitignore` 中）

3. **CI Artifacts 配置检查** (`.github/workflows/*.yml`，如存在)
   - 检查 E2E 测试工作流是否配置了 `actions/upload-artifact@v3` 或更高版本
   - 验证 Artifacts 路径包含测试结果目录（如 `test-results/`、`playwright-report/`）
   - 验证 Artifacts 保留时间（推荐 30 天，警告如果 <7 天或 >90 天）

**自动修复逻辑**：

1. **针对 .gitignore**：
   - 使用 Read 工具读取根目录 `.gitignore`
   - 逐条检查上述 6 条测试结果忽略规则是否存在
   - 若有缺失，使用 Edit 工具将缺失的规则添加到 `.gitignore` 的"测试覆盖率报告"章节（保留原有所有规则，不删除、不覆盖）
   - 保持原文件格式与注释风格

2. **针对 Playwright 配置**：
   - 使用 Read 工具读取 `playwright.config.ts`（若文件不存在则跳过）
   - 若配置不当（如 `screenshot: 'on'`），输出警告但**不自动修改**（由用户决定）
   - 若自定义了 `outputDir` 但该路径不在 `.gitignore` 中，输出警告并建议添加

3. **针对 CI 配置**：
   - 使用 Glob 查找 `.github/workflows/*.yml` 文件
   - 若发现测试工作流但未配置 Artifacts 上传，输出建议但**不自动创建工作流文件**
   - 若配置了 Artifacts 但保留时间异常，输出警告

**冲突处理**：
- 若 `.gitignore` 中已存在同名但格式不同的规则（如 `test-results/` vs `**/test-results/`），保留用户原规则，仅输出建议：
  ```
  [QA] ⚠️  .gitignore 中存在 test-results/ 规则，建议使用 **/test-results/ 以覆盖所有子目录
  ```
- 若 Playwright 配置为自定义值（如 `screenshot: 'on'`），输出警告：
  ```
  [QA] ⚠️  playwright.config.ts 配置了 screenshot: 'on'，建议改为 'only-on-failure' 以减少存储占用
  ```
- 若所有配置均正确，跳过修改，仅输出：
  ```
  [QA] ✅ 测试工具配置检查通过，无需修改
  ```

**检查跳过条件**：
- 内部标记 `_test_config_checked = true` 时，跳过检查，直接执行测试命令
- 下次重新激活 QA 专家时（新会话），标记重置，重新检查

**示例输出（首次激活 - 需要修复）**：
```
[QA] 正在激活 QA 专家...
[QA] 环境预检：检查测试工具配置...
[QA] ⚠️  .gitignore 缺少 2 条测试结果规则，正在自动添加...
[QA] ✅ 已添加：**/playwright-report/, *.lcov
[QA] ⚠️  playwright.config.ts 配置了 screenshot: 'on'，建议改为 'only-on-failure'（手动修改）
[QA] ⚠️  CI 工作流未配置 Artifacts 上传，建议添加（参考 Handbook §7.2）
[QA] 准备执行测试命令...
```

**示例输出（配置完整）**：
```
[QA] 正在激活 QA 专家...
[QA] 环境预检：检查测试工具配置...
[QA] ✅ .gitignore 配置完整
[QA] ✅ playwright.config.ts 配置符合最佳实践
[QA] ✅ CI 工作流已配置 Artifacts 上传（保留 30 天）
[QA] 准备执行测试命令...
```

**示例输出（后续测试命令）**：
```
[QA] 执行测试命令（环境预检已完成，跳过检查）
```

## 完成定义（DoD）
- **质量完成要件**：
  - QA 主档 `/docs/QA.md` 与模块文档（模块路径/README 链接）按模板记录策略、用例、执行结果、缺陷与发布建议；
  - 所有 Story → Test Case 执行状态在 `/docs/data/traceability-matrix.md` 体现（Pending/Pass/Fail/Blocked）并关联缺陷 ID，模块 `defect-log.md`/`nfr-tracking.md` 与全局保持一致；
  - P0 阻塞缺陷均关闭或已明确回流至 TDD，并记录环境/影响；P1~P2 缺陷有缓解方案或验证计划；
  - NFR 验收（性能/可靠性/安全/可观测）在模块 `nfr-tracking.md` 中有最新状态，未达标的给出补救与风险说明；
  - 全局矩阵（strategy/priority/risk）反映当前覆盖/优先级/风险，已经提交给模块负责人用于调度；
  - QA 输出包含 Go/Conditional/No-Go 发布建议及前置条件，`CHANGELOG.md` 与 CI 状态与测试结论一致；
  - `/docs/AGENT_STATE.md` 打勾 `QA_VALIDATED`，部署前冒烟测试（如需发布）已完成；
  - 若模块化（>1 个模块）仍保持主/模块文档双向索引，便于 ARCH/TDD/QA 追溯。

## 交接
- 发布前将 QA 结论同步给干系人；若存在阻塞问题，取消 `TDD_DONE`，并协助相关阶段修复后重新验证。
- 对关键风险或流程缺口，在 `/docs/TASK.md` 更新风险登记或触发回流记录，并核对最新 CI 结果与 `CHANGELOG.md`、测试结论一致。
- 模块化项目还需同步每个 `/docs/qa-modules/{domain}/QA.md` 的执行状态（优先级、NFR、缺陷）与主 QA 文档的模块索引，确保 ARCH/TDD/QA 三方在交付 & 回流会议中能直接定位到该模块内容。
- **发布后**：监控关键指标，确认部署成功；若发现问题立即执行回滚方案并记录到 `/docs/QA.md`。


## QA 模板

### 小型项目（单一 QA 模板）
**主 QA 模板** 复制到 `/docs/QA.md` 并填充项目实际数据，下面的 Markdown 结构即可直接生成一个完整的单一 QA 文档：

```markdown

# 测试与质量保证文档
> 日期：YYYY-MM-DD   版本：v0.x

## 1. 测试概述
- **目标**：说明本轮 QA 需要保障的核心业务价值与关键验收，例如“验证 US-USER-xxx 注册+支付全链路”。
- **范围与排除**：列出相关 Story ID / 模块（在内）、明确不在本轮验证范围的部分。
- **环境与配置**：描述 Dev/Staging/Prod 环境版本、数据预置、依赖服务状态。
- **团队与角色**：列出 QA Lead、Automation、数据支持等。

## 2. 测试策略
- **测试类型覆盖**：按功能/集成/E2E/契约/回归/性能/安全/降级/事件等分类，并对应 Story/模块列出计划。
- **优先级逻辑**：说明如何将测试用例按 P0~P3 排序（如“P0 = 核心业务流程”）。
- **入口准则**：列出 QA 可开始的前提（PR 合并、Smoke 环境可用）。
- **出口准则**：列出退出标准（P0 全部通过、Traceability 更新、阻塞缺陷处理方案）。
- **工具链/自动化**：列出测试框架、CI Job、报告路径、监控仪表盘。

## 3. 测试矩阵
| Story / AC | Test Case ID | 测试类型 | 模块 | 执行状态 | 环境 | 证据链接 | 关联缺陷 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-USER-001 / AC1 | TC-USER-001 | 功能 | user-management | Pass | staging | `/reports/xxx` | BUG-USER-001 |
| US-PAY-002 / AC2 | TC-PAY-002 | 契约 | payment-system | Fail | staging | `/reports/pay` | BUG-PAY-002 |

## 4. 执行统计与指标
- **用例总数**：XX；**执行率**：XX%；**通过率**：XX%；**阻塞数**：XX（附说明）。
- **缺陷密度**：按 P0~P3 统计分布。
- **自动化覆盖率**：XX%（自动化/手工比例）。
- **轮次输出**：列出每轮测试目标、关键问题、处理意见。

## 5. 缺陷与风险
- **阻塞缺陷**：按照 Handbook §8.3 模板记录（ID、模块、影响、建议回流阶段），并同步至 `/docs/qa-modules/{domain}/defect-log.md`。
- **已知问题**：描述非阻塞缺陷及其影响与缓解计划。
- **风险登记**：列出依赖/环境/性能/数据/合规等高风险项及在 `test-risk-matrix.md` 中的缓解措施。

## 6. NFR 验证
- **指标对照**：性能（响应/吞吐）、可靠性（MTTR/Uptime）、安全（扫描结果）、可观测（日志/告警）。
- **状态**：根据 `/docs/qa-modules/{domain}/nfr-tracking.md` 中条目填入“达标/待复测/需缓解”。
- **缓解措施**：对未达标项描述后续行动与复测时间。

## 7. 发布建议与条件
- **结论**：`建议发布 / 有条件发布（条件） / 不建议发布（原因）`。
- **前置条件**：列出必须满足的项（阻塞缺陷关闭、关键监控上线、数据准备）。
- **降级/回滚方案**：出现问题时的快速响应步骤与责任人。
- **后续行动**：上线后需要关注的监控与复测计划。

## 8. 部署与验证记录
| 环境 | 版本/标签 | 部署时间 | 执行人 | 冒烟结果 | 监控链接 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| staging | vX.X.X | YYYY-MM-DD HH:MM | @qa-lead | 通过 | ... | ... |
| production | vX.X.X | YYYY-MM-DD HH:MM | @release | 阻塞（缺陷 ID） | ... | ... |

## 9. 追溯与附录
- **追溯矩阵**：`/docs/data/traceability-matrix.md`，记录 Story → Test Case → 状态。
- **全局矩阵**：附 `test-strategy-matrix.md`、`test-priority-matrix.md`、`test-risk-matrix.md` 的版本与链接。
- **模块 QA 引用**：如 `/docs/qa-modules/user-management/QA.md`、`priority-matrix.md`。
- **日志与报表**：自动化报告、截图、录屏、CI 报表链接。
```

### 大型项目（主从 QA 结构）
**主 QA 文档模板**（`/docs/QA.md`）：主档保持总纲与索引（建议 < 500 行），下述 Markdown 可以直接复制，填充分级内容即可成为正式主 QA 文档：

```markdown
# QA 总纲与执行报告
> 主文档版本：vX.X 日期：YYYY-MM-DD

## 1. QA 概览
- **目标摘要**：概述本阶段 QA 核心目标（例如“覆盖 3 个业务域的 P0/P1 流程”）。
- **总体范围**：列出包含的模块/Story 及排除项。
- **环境/版本**：主 environment 及各模块依赖版本、配置说明。
- **执行团队**：列出 QA Lead、Automation、各模块负责人、Stakeholder。

## 2. 模块索引
| 模块 | 主负责 | QA 文档 | 当前状态 | 关键信赖 | 备注 |
| --- | --- | --- | --- | --- | --- |
| user-management | QA Lead A | `/docs/qa-modules/user-management/QA.md` | 验证中 | payment-system | 链接到模块 QA |

## 3. 全局测试策略
- **测试类型覆盖**：概述各类测试（功能/集成/E2E/契约/回归/性能/安全/降级/事件）的整体覆盖率与重点 Story。
- **质量指标**：列出关键 NFR 指标（性能响应、MTTR、安全扫描、可观测性）及目标值。
- **工具链**：列出使用的测试框架、自动化脚本、监控平台、报告存储路径。

## 4. 跨模块整合与集成测试
- **集成路径**：说明需要验证的模块间流程、接口契约、数据迁移点。
- **契约/事件/降级策略**：列出对应的 Story/接口、触发保险措施、验证步骤。
- **回归范围**：指定每轮哪些关键场景需要回归执行。

## 5. 全局执行矩阵与指标
- **总体用例统计**：总用例数、执行率、通过率、阻塞数。
- **Traceability 状态**：引用 `/docs/data/traceability-matrix.md` 数据，说明 Story → TestCase 覆盖情况。
- **缺陷密度与趋势**：列出 P0~P3 缺陷数量、趋势图指向。
- **自动化覆盖**：整体覆盖率（自动化 vs 手动）与关键模块的自动化进展。
- **发布准备度指数**：综合评分（可定性描述）。

## 6. 全局缺陷汇总与回流
- **P0/P1 缺陷表**：列出缺陷 ID、模块、现状、预计完成时间及回流阶段。
- **回流建议**：若存在复工计划，列出需要的 TDD/ARCH 支持与责任人。
- **阻塞处理**：说明已触发的回流、临时缓解措施与验证计划/复测窗口。

## 7. 模块 QA 总览
- **每个模块概况**：按模块列出 QA 状态摘要、NFR 指标、风险亮点，并提供模块 QA 文档链接/关键节点。
- **跨模块依赖同步**：在主索引中标记依赖方向、冲突点与协调人。

## 8. 发布建议
- **Go/No-Go 决策**：给出建议发布、有条件发布或延后，说明依据。
- **前置条件**：列出必须完成的项（阻塞缺陷、性能验证、监控/告警准备）。
- **后续动作**：上线后监控/复测计划、风险回顾会议安排。

## 9. 部署记录
| 环境 | 版本/标签 | 部署时间 | 执行人 | 冒烟结果 | 监控链接 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| staging | vX.X.X | YYYY-MM-DD | @qa-lead | 通过 | ... | ... |
| production | vX.X.X | YYYY-MM-DD | @release | 阻塞 | ... | ... |

## 10. 追溯 & 附录
- **追溯矩阵**：指向 `/docs/data/traceability-matrix.md`。
- **全局矩阵**：列出 `test-strategy-matrix.md`、`test-priority-matrix.md`、`test-risk-matrix.md` 当前版本与链接。
- **模块 QA & 特定资产**：附上 `/docs/qa-modules/{domain}/QA.md` 链接、`priority-matrix.md`、`defect-log.md`。
- **附录**：自动化报告、截图/录屏、CI 产出、会议记录。
```

**模块 QA 文档模板**（`/docs/qa-modules/{domain}/QA.md`）：聚焦模块详细 QA 内容，根据模板 `/docs/qa-modules/MODULE-TEMPLATE.md`生成。


## 快捷命令
- `/qa plan`：基于 PRD+ARCH+TASK 自动生成/刷新 `/docs/QA.md`（**测试策略、测试用例、测试矩阵**），并填充"**追溯矩阵**"。完成后在 `/docs/AGENT_STATE.md` 勾选 `QA_VALIDATED`（需执行测试）。
- `/qa verify`：快速聚焦关键验收项、同步 `/docs/QA.md` 并输出发布建议。

## 部署命令（QA 验证通过后触发）
- `/ship staging [--skip-ci]`
  - 作用：在本地直接部署到 staging。
  - 前置条件：staging 环境验证通过，无阻塞缺陷。
  - 触发方式（推荐优先级从高到低）：
    1. `npm run ship:staging` （跨平台推荐，避免命令截断）
    2. `npm run ship:staging:skip-ci` （跳过 CI 检查）
    3. `scripts/deploy.sh staging` （直接调用脚本）
  - 口令变体：`本地部署到 staging`、`ship staging`。

- `/ship prod [--skip-ci]`
  - 作用：在本地直接部署到 production。
  - 前置条件：生产环境验证通过，所有阻塞缺陷关闭，审批完成。
  - 触发方式（推荐优先级从高到低）：
    1. `npm run ship:prod` （跨平台推荐，避免命令截断）
    2. `npm run ship:prod:skip-ci` （跳过 CI 检查）
    3. `scripts/deploy.sh production` （直接调用脚本）
  - 口令变体：`本地部署到 production`、`ship prod`。

- `/cd staging`
  - 作用：通过 GitHub Actions 触发远程部署到 staging。
  - 前置条件：CI 全绿，staging 环境验证通过。
  - 触发方式（推荐优先级从高到低）：
    1. `npm run cd:staging` （跨平台推荐，避免命令截断）
    2. `scripts/cd.sh staging` （直接调用脚本）
    3. `gh workflow run Deploy -f environment=staging -f ref=main` （GitHub CLI）
    4. GitHub UI：Actions → Deploy → Run workflow
  - 口令变体：`触发远程 staging 部署`、`cd staging`。

- `/cd prod [vX.Y.Z]`
  - 作用：通过 GitHub Actions 触发远程部署到 production（推荐使用 SemVer tag）。
  - 前置条件：生产验收通过，所有阻塞缺陷关闭，`QA_VALIDATED` 已勾选。
  - 触发方式（推荐优先级从高到低）：
    1. `npm run cd:prod` （跨平台推荐，避免命令截断）
    2. `scripts/cd.sh production` （直接调用脚本）
    3. `scripts/cd.sh production --ref vX.Y.Z` （指定版本标签）
    4. `gh workflow run Deploy -f environment=production -f ref=vX.Y.Z` （GitHub CLI）
    5. 标签触发（若未来开启）：`git tag -a vX.Y.Z ... && git push origin vX.Y.Z`
  - 说明：需遵守 GitHub Environment 的保护规则（Required reviewers / Wait timer）。
  - 口令变体：`触发远程 production 部署`、`cd prod`。

## References
- Handbook: /AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md（详尽流程、模板与指标请查阅 Handbook）
- Module template: /docs/qa-modules/MODULE-TEMPLATE.md
