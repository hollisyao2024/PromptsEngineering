# 开源公共能力的选择与使用

息壤维护可初始化的实现、版本、组合与升级规则。实际项目在采用时安装依赖；模板源无需下载全部组件。模型工作流程继续由 agent 包负责，技术选型与约束集中在 architecture。完整状态与官方来源见 [组件目录](../open-source-catalog.json)，文件接口另见 [文件存储指南](file-storage.md)。

## 1. 已采用组件与取舍

| 能力 | 推荐实现 | 选择依据与实际边界 |
| --- | --- | --- |
| 身份 | Better Auth 1.7.3 + Prisma adapter | Node/TypeScript 内集成会话、密码与组织管理；验证 PG/SQLite。外部 OAuth、邮件、桌面回调由项目配置 |
| 数据权限 | CASL 7.0.1 + Prisma adapter 2.0.2 | 绑定项目 Prisma.TypeMap，把允许条件放入实际查询/条件更新；默认策略拒绝全部 |
| 任务 | pg-boss 12.30.0 | 已有 PostgreSQL 时复用基础设施，可用 fromPrisma 同事务投递；不支持 SQLite |
| 独立队列 | BullMQ 6.3.4 | Redis 后端适合独立队列负载；PostgreSQL 后端作为显式可选实现，单独迁移与验证 |
| 上传 | Uppy 6 Hooks + shadcn | 上传编排和进度来自 Uppy，控件使用 shadcn，直接对接文件会话；当前传输为单对象上传 |
| 富文本 | Tiptap 3.31.3 开源核心 | JSON 内容、基础格式与列表，自组 shadcn 工具栏；不包含商业协作服务 |
| 图表 | Recharts 3.10.1 + shadcn Chart | 主题 Token、提示和文字数据替代；内置柱状组合，原子 Chart 可扩展其他图形 |
| 虚拟表格 | TanStack Virtual 3.14.11 | 通过现有 DataTable 的行渲染端口减少 DOM，保留同一分页、选择、排序与导出状态 |
| 拖拽 / 流程画布 | dnd-kit 0.5.0 / React Flow 12.11.6 | 排序提供键盘可用按钮，流程画布受控编辑节点与边；不承担工作流执行 |
| 国际化 | i18next 26.4.2 / react-i18next 17.0.13 | 每个应用/SSR 请求创建实例，词条归项目；不用跨请求可变全局单例 |
| 日志 | Pino 10.3.1 | JSON、请求上下文、嵌套敏感字段脱敏；消息采用固定文本，原始请求体/个人资料不作为日志输入 |
| 追踪 | OpenTelemetry API 1.9.1 / SDK 0.222.0 | 显式注册、导出端点与退出 flush；当前封装提供追踪，指标/日志后端由项目另行接入 |
| API Mock | MSW 2.15.0 | 浏览器开发与 Node 测试适配；不会因导入模块而自动启动 |

既有 shadcn、DataTable、TanStack Table/Query、React Hook Form、Zod、Prisma、OpenAPI、AppShell 与 Tauri 端口继续保留。DataTable 仍用兼容项目 ColumnDef 接口的 TanStack Table 8；不会以“最新版”为由破坏既有接口。Prisma 继续使用验证过的 7.10.0，8.0 RC 不作为稳定默认。

Better Auth 的可选 Vitest peer 当前为 2/3/4，UI 测试为 Vitest 5。因此 auth-client 独立于 UI 测试包；@better-auth/core 与 prisma-adapter 需要 utils 0.4.2，显式固定版本，不全局关闭 peer 检查。

## 2. 配置与目录

新增模块使用 schemaVersion 2；在项目现有配置中合并相应选择，不整份覆盖配置：

```json
{
  "modules": [
    {"id":"auth","path":"packages/auth","options":{"datastore":"main"}},
    {"id":"auth-client","path":"packages/auth-client"},
    {"id":"authorization","path":"packages/authorization","options":{"datastore":"main"}},
    {"id":"jobs","path":"packages/jobs","options":{"provider":"pg-boss","backend":"postgres"}},
    {"id":"i18n","path":"packages/i18n"},
    {"id":"logging","path":"packages/logging"},
    {"id":"telemetry","path":"packages/telemetry"},
    {"id":"api-mocks","path":"packages/api-mocks"}
  ]
}
```

服务端 applications.modules 声明 auth、authorization、jobs、logging、telemetry；React 应用声明 auth-client、i18n、api-mocks。auth/authorization 绑定的 Prisma datastore 必须被同一服务端应用消费。共享服务源码进入 packages/<module>/src，应用组合、监听端口与启动/停止位于 apps/<app>。

队列可改为 {"provider":"bullmq","backend":"redis"} 或 {"provider":"bullmq","backend":"postgres"}。SQLite 是业务库选项，无法替代队列要求的 PostgreSQL/Redis。Go 服务不会被隐式安装 Node 身份或队列；多语言选择见第 7 节。

前端 componentSets 可以选择 auth、job-status、uploads、editor、charts、sortable、flow、virtual-table，与既有 sets 组合。默认仍只启用原有 DataTable 闭包。组合目录是 packages/ui/src/advanced，任务状态属于 feedback，虚拟表格属于 data-table；单应用映射为 apps/<app>/src/components 下对应目录。components.advanced 可配置。

| set | 导出组件 | 主要输入 |
| --- | --- | --- |
| auth | IdentityPanel | IdentityPort，登录/组织切换/退出 |
| job-status | JobStatus | 已授权的状态、可选取消与重试回调 |
| uploads | FileUpload | 文件客户端、完成回调、大小/类型/数量限制 |
| editor | RichTextEditor | JSON value / onChange / disabled |
| charts | MetricChart；ui/ChartContainer | 有限数值、标签、主题配置 |
| sortable | SortableList | 稳定 ID、受控数组、变更回调 |
| flow | FlowEditor | 受控 nodes/edges、readOnly |
| virtual-table | VirtualDataTable | 现有 DataTable props + height |

所有组件按依赖闭包生成；撤销选择不是卸载，已生成源码及所需依赖保留。普通 DataTable 不因此强制安装 Virtual、Uppy 或编辑器。

## 3. 身份与权限接线

服务端从 @project/auth 导入 createAuth、toNodeHandler、fromNodeHeaders，传入项目 database、随机 secret、baseURL 与 trustedOrigins。初始化默认关闭公开注册；项目明确允许后传 allowSignUp:true。在 Node HTTP 路由读取请求体之前，将 /api/auth/* 请求交给 toNodeHandler(auth)。

React 使用：

```tsx
import {createProjectAuthClient,createIdentityPort} from "@project/auth-client";
import {IdentityPanel} from "@project/ui/advanced/identity-panel";
// 在组件外或 useMemo 中创建稳定实例。API URL 使用项目公开配置。
const identity=createIdentityPort(createProjectAuthClient("http://127.0.0.1:3000"));
export function Login(){return <IdentityPanel client={identity}/>;}
```

组织成员来源是服务端会话和成员关系查询。不要把客户端传来的角色、组织 ID 或隐藏按钮当作授权。CASL 的 policy.ts 首次生成后归项目，默认返回空规则；根据实际模型维护允许条件：

```ts
const database=authorizedDatabase(db);
const rows=await database.task.findMany({where:whereAuthorized(ability,"read","Task")});
const result=await database.task.updateMany({
  where:{AND:[whereAuthorized(ability,"update","Task"),{id:requestedId}]},
  data:{title}
});
```

拒绝条件必须通过 authorizedDatabase 创建的扩展客户端执行。新增模型的创建也要服务端赋予所有者/租户字段并校验 create 权限；本封装不生成项目业务规则。认证 Schema 单独放入 prisma/auth.prisma，迁移只追加，更新不重写已有身份表。

## 4. 任务与一致性

模块导出 createJobs、prepareJobs。JobDefinition.parse 由项目定义，用于入队和消费两端校验；负载限制 64 KiB，不放文件或凭据。pg-boss 的自定义 id 必须是 UUID，BullMQ 的稳定 jobId 不使用冒号。成功任务的保留周期决定队列 ID 去重窗口，不能替代业务幂等键。

PostgreSQL 队列首次使用前，由维护者显式设置 JOBS_DATABASE_URL/JOBS_SCHEMA 并执行：

```bash
XIRANG_APPLY_QUEUE_MIGRATIONS=1 pnpm --filter @project/jobs db:prepare
```

普通 init/install/start 不执行队列 SQL 迁移。pg-boss 使用 migrate:false 启动；BullMQ PostgreSQL 的 prepareJobs 显式调用 runMigrations。Redis 不执行 SQL，必须配置持久化、备份与容量。Worker 错误通过必填 onError 回调上报，close 等待在途工作完成；项目应对外部请求设置超时。

pg-boss 的 enqueueInTransaction(tx,definition,payload,id) 使用同一个 PostgreSQL 数据库与 Prisma transaction，已验证业务记录和任务一同提交/回滚。跨数据库或向 Redis 投递时采用项目 Outbox：业务事务写入 Outbox，投递者以稳定业务键入队后确认；消费者再次按业务键去重。不要在事务回调里直接调用 Redis 后声称原子提交。

取消只作用于队列可取消状态；正在执行的外部副作用需要业务自己的取消协议和补偿。JobStatus 只展示服务器已授权状态，模板不开放按任意 jobId 读取数据的公共接口。

## 5. 国际化、日志、追踪与 Mock

createI18n(language,resources) 返回独立实例，使用 I18nextProvider 包裹应用。resources.ts 是项目词条；Next 服务端按请求创建实例，向客户端传入可序列化词条，不传实例或服务端对象。

Pino 的 createLogger(service,destination)、withRequestContext(logger,callback,requestId) 与 requestLogger(logger) 保持异步请求隔离。对象字段按 password/secret/token/authorization/cookie/credential/apiKey 递归脱敏，Error 只保留 name/code。日志消息不要拼接令牌、连接字符串和用户输入。

OpenTelemetry 由应用唯一入口调用 startTelemetry({serviceName,endpoint}) 或传入自定义 exporter；不自动读取任意导出端点、不自动采集 HTTP 内容、不在 import 时发送数据。traced(name,operation) 提供手动 span；应用退出 await handle.shutdown()，同一进程只创建一次生命周期。

MSW 使用 @project/api-mocks/node 的 createMockServer，在测试显式 listen/resetHandlers/close。浏览器先在实际项目生成 worker：在 api-mocks 包运行 pnpm exec msw init <应用的 public 绝对目录>。仅在开发条件下调用 @project/api-mocks/browser 的 startMockWorker({enabled,serviceWorkerUrl})；不要在生产入口开启。handlers.ts 归项目维护。

## 6. 初始化与升级

```bash
pnpm agent -- architecture plan --config architecture.config.json
pnpm agent -- architecture init --config architecture.config.json
pnpm agent -- architecture check
pnpm test:workspace
```

已有采用项目使用 update。依赖严格安装，Prisma/合约生成与类型检查在实际 workspace 中完成；数据库迁移、身份密钥、队列服务和生产发布仍由项目显式配置。

可从 [完整配置示例](../examples/open-source-monorepo.json) 按需求裁减，示例默认本地文件与 SQLite 业务库，队列另用 Redis。单模块更新会带上必要应用与数据源配置，确保依赖闭包完整。

公共封装、组件、测试走 update；package.json/tsconfig/workspace 结构合并；policy/resources/handlers/业务接线及 Schema 使用 init-if-missing；迁移 append；项目配置与 RULES.md 保留。改队列后端、数据库绑定或已存在存储 provider 是迁移，不自动切换。无法确定三方基线时阻断。

## 7. 保留的备选

Auth.js 适合已有 Auth.js/OAuth 项目；Keycloak 适合企业 SSO、OIDC/SAML 与多语言独立身份；Casbin 适合跨语言授权模型；Temporal 适合长流程恢复与补偿；Asynq 可作为 Go/Redis Worker 备选。它们没有生成器实现，不会被偷偷安装。

MinIO JS SDK 保留备选，当前默认用官方 AWS SDK。Unstorage 面向 KV/cache，不能替代文件会话接口。比较实验发现 MinIO 与 Node Casbin 的传递依赖存在 moderate 公告，且 Unstorage 与 ioredis 6 peer 不兼容；升级/重选前需重新审计。详见目录中的来源、条件和状态，不能把“列入目录”当作“运行验证通过”。

## 8. 验证范围

源生成/所有权测试位于 architecture/__tests__，真实消费测试位于 architecture/tests/open-source.integration.mjs 与 jobs.integration.mjs；UI 交互测试按 set 生成。PG/SQLite、Redis、Node SDK 协议夹具与 Go 编译/本地协议分别验证。真实云、企业 IdP、邮件/短信、触摸设备和原生登录没有由这些本地测试覆盖，需要项目自己的验收。
