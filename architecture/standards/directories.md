# 应用目录标准

本标准独立于模型作业流程。容器层 repo/worktrees/tmp/cache/artifacts 由 docs/CONVENTIONS.md 定义；以下是 repo 内的逻辑职责。只创建项目实际需要的目录。

```text
repo/
├── apps/                 # 可独立运行/发布的应用
│   ├── web/              # 用户 Web
│   ├── admin/            # 管理端
│   ├── api/              # 服务接口；既有 server 也有效
│   ├── worker/           # 后台任务
│   ├── desktop/          # 桌面端
│   └── mobile/           # 移动端
├── packages/             # 应用间共享模块
│   ├── domain/           # 领域模型和规则
│   ├── ui/               # 跨应用组件（选用）
│   ├── query/            # React 查询适配
│   ├── platform/         # 多端宿主能力
│   ├── api-client/       # API 客户端
│   ├── contracts/        # 合约和生成类型
│   ├── database/         # 共享存储实现（选用）
│   ├── observability/    # 事件、错误、脱敏
│   └── config/           # 共享配置
├── db/                   # 独立数据库资产（也可映射 packages/database）
├── infra/                # 环境、容器、交付实现
├── tooling/              # 编译、格式、检查及工程工具
├── docs/                 # 项目决策、规范和治理文档
├── e2e/                  # 跨应用验收
├── perf/                 # 性能验证
└── security/             # 安全验证
```

目录职责是稳定约定，应用名称和语言不固定。architecture.config.json 记录实际 paths；已有 apps/server、src/renderer/src、db 与 packages/database 无需搬迁。pnpm-workspace.yaml 或其他 workspace 文件只声明包范围，不等于已初始化目录。

单应用的 shadcn 基础控件：apps/<app>/<sourceDir>/components/ui；组合表格：components/data-table；工具：<sourceDir>/lib；业务组件使用其上层目录。跨应用共享可显式映射 packages/ui/src 与 packages/ui/src/data-table。components.json 的 aliases 与 tsconfig/Vite 路径必须指向同一实际目录。

公共组件实际目录（sourceDir 默认为 src）：

```text
apps/<app>/<sourceDir>/components/
├── ui/           # shadcn 基础控件
├── data-table/   # 唯一公共数据表
├── forms/        # 字段、分组、弹窗/侧栏及可选 RHF 适配
├── selectors/    # 搜索、多选、异步选项、日期与日期范围
└── feedback/     # 确认、异步按钮、状态与通知
```

共享时推荐对应映射 packages/ui/src/{ui,data-table,forms,selectors,feedback}。共享组件的依赖也必须在共享包，不能反向导入 apps；共享相同源码的应用必须使用一致的依赖目录映射。技术源在 architecture/components/shadcn/registry，实际项目代码从上述 apps/packages 导入。

v2 Monorepo 默认共享 UI，单根 workspace/lock；数据库包使用 packages/database/<store>，各自维护 prisma/schema.prisma、prisma/migrations 和 src/generated。初始化与实际依赖安装见 [Monorepo 指南](../../architecture/guides/monorepo.md)。目录可以映射，技术选择由项目配置决定。
