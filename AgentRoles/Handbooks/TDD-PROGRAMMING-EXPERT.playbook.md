
# TDD-PROGRAMMING-EXPERT

- 此文档禁止大模型修改，只能人工调整
- 本文档用于指导 AI 编码代理（Agent）在本 monorepo 项目中执行各项编码工作。  
- 目标是让 Agent 能够高效、统一地生成、修改和维护代码，同时保持团队工程规范与安全边界。

---

## 1. Agent 职责与行为准则

Agent 负责项目中的所有编码相关工作，包括但不限于：
- 辅助生成与改进代码；
- 编写与维护单元测试；
- 优化注释与文档；
- 修复 bug；
- 重构与性能优化；
- 编写并提交 PR；
- 执行 lint、build、test 等命令以确保变更可验证。

Agent 具有：
- ✅ 代码文件读写权限；
- ✅ 执行命令权限（npm、pytest、build、lint 等）；
- ❌ 无跨项目协作 Agent 交互。

若指令与本文件规则冲突，以显式任务指令为最高优先级。

---

## 2. 项目结构与目录边界

本项目为 **monorepo** 结构，包含多个子目录：

```text
/
├── frontend/       # 前端应用（TypeScript + React）
├── backend/        # 后端服务（Python + FastAPI）
├── shared/         # 前后端共享代码与类型定义
├── scripts/        # 构建与运维脚本
│   └── database/   # 数据库脚本
├── docs/           # 文档
├── tests/          # 集成与单元测试
│   ├── frontend/   # 前端应用测试
│   └── backend/    # 后端服务测试
└── AGENTS.md       # 本说明文件
```

### 目录规则

- **frontend/**  
  - 语言：TypeScript  
  - 框架：React / Next.js、Vite、Ant Design
  - 可访问 `.env`等目录进行测试；  
  - 不可改动环境配置（如 `.next`, `.env.production`）。  
  - 修改逻辑文件后，需运行 `npm run lint && npm test` 验证。

- **backend/**  
  - 语言：Python（FastAPI）  
  - 遵守 Black 格式化与 PEP8 风格；  
  - 可访问 `.env`、`migrations/` 等目录进行测试；  
  - 修改后需通过 `pytest` 全量测试。

- **shared/**  
  - 仅定义类型、常量与通用工具；  
  - 修改需确保前后端兼容性。

- **docs/**  
  - 与项目相关文档。

- **scripts/**  
  - 构建与运维脚本。
  - **database/**
    - 数据库脚本放在 databsae 目录下，脚本命名规则“日期”(20251013)+“脚本作用简述”，如果一天有多个脚本，按照顺序叠加，20251013_2。
    - database_schema.md文件是用来描述数据库架构的文档，每次数据库有任何架构变化需要同步更新此文档。

- **tests/**  
  - 集成与单元测试。
  - **frontend/**
    - 前端应用测试采用组合方案，70% 用 Vitest 覆盖单元/组件 + 少量用 Playwright 覆盖E2E核心路径（登录/支付/下单/核心报表导出）
  - **backend/**
    - 后端应用测试采用pytest、pytest-asyncio、httpx 等框架
  
  
---

## 3. 代码风格规范

### 语言与格式
- **TypeScript：** 遵循 ESLint 规则，启用 Prettier。  
- **Python：** 采用 Black 格式化，PEP8 命名约定。  
- 函数与类命名使用驼峰或 PascalCase；数据库表名、字段名使用下划线。  

### 编程风格
- 强调简洁、可读、注释充分；  
- 代码应模块化、函数短小、逻辑清晰；  
- 允许函数式与面向对象混合风格。

---

## 4. 关键开发流程
- 编码开发采用测试驱动开发 TDD（Test-driven development），基于预期的输入/输出对编写测试
- 请严格遵循“红-绿-重构”循环进行开发
- 红：先写一个会失败的测试
- 绿：用最少代码让测试通过
- 重构：优化代码，保持测试通过
- 
### 关键规则
❌ 禁止在测试失败时修改测试
✅ 只在所有测试通过后才可重构
🎯 每个循环只实现一个微小功能
🔄 完成当前循环后再开始下一个
✅ 为提高性能，优先运行单一测试，而非整个测试套件

---

## 5. 开发命令与自动化流程

```bash
# 安装依赖
npm install
pip install -r requirements.txt

# 启动前端和后端（可以并行启动）
cd frontend && npm run dev
cd backend && uvicorn app.main:app --reload

# 测试（前端和后端的测试）
npm test
pytest

# 格式化与校验（先检查，后格式化）
npm run lint && npm run format
black backend/

# 构建与部署（确保代码无误后构建并部署）
- npm run build # 构建项目
- npm run typecheck # 运行类型检查器
- scripts/deploy.sh staging|production # 本地部署（口令：/ship staging|prod，默认会跑 scripts/ci.sh）
- scripts/deploy-stage.sh / scripts/deploy-production.sh # 触发 GitHub Actions（口令：/cd staging|prod）
```

所有改动前必须通过 lint 与测试。

---

## 6. 安全与合规

- 项目包含内部配置（API Key、内部服务地址、商业机密）。  
- 这些内容仅可在开发环境访问，不得上传至 Git 仓库。  
- Agent 可在受控范围内访问 `.env`、`secret/`、`migrations/` 等目录，以便自动化测试与部署。  
- 若涉及外部 API（百度云、Supabase、Fastspring、OpenAI、Anthropic 等），需遵守以下原则：  
  - 不应硬编码 API Key；  
  - 对外调用需具备重试与错误处理逻辑。  

---

## 7. 提交与协作规范

### Commit 规范

Commit 信息统一格式：  
```
<类型>(<模块>): <描述>
```
示例：
```
feat(frontend): 新增用户登录页面
fix(backend): 修复 token 验证错误
refactor(shared): 优化通用日志函数
test(backend): 增加接口单测覆盖
```

常用类型：`feat`、`fix`、`refactor`、`docs`、`test`、`build`、`chore`。

### PR 模板

PR 描述应包含：
1. **变更说明**：简述改动点与目的；  
2. **测试结果**：说明已通过哪些测试命令；  
3. **风险评估**：列出可能影响的模块；  
4. **其他备注**（如截图、性能对比等）。

示例：
```
### 🧩 改动内容
新增前端用户登录页与接口联调。

### ✅ 测试结果
- npm run lint ✅
- pytest backend/tests ✅

### ⚠️ 风险评估
涉及 user 模块逻辑修改，需验证登录态兼容性。
```

---

## 8. 限制与边界

- 不得修改 `package.json`、`requirements.txt` 依赖版本，除非显式要求；  
- 不得新增未经批准的第三方库；  
- 不得删除生产配置文件；  
- 不得执行破坏性命令（如删除数据库）；  
- 所有变更必须具备可回滚性。

---

## 9. Agent 执行示例

- “根据 AGENTS.md 规范，优化 backend/user.py 中的用户注册逻辑并补充 pytest 单元测试。”  
- “在 frontend 中添加 `LoginForm.tsx` 组件，并确保通过 ESLint 校验。”  
- “在 shared/utils 目录新增一个 format_date 工具函数，增加注释与测试。”

---

## 10. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2025-10-08 | 首个轻量开发者版 AGENTS.md |
