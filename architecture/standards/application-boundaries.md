# 应用与模块边界

apps 是独立运行/发布单元；apps 之间通过 API、事件或公共 packages 交互，不能导入另一个 apps 的源文件。packages 不依赖 apps；领域逻辑不依赖 UI/数据库具体驱动。需要共用页面时先抽取 packages，再由各应用组合。

架构选型按应用分别声明 stack 和 targets；数据库按业务责任声明 engine、path、consumers。后端 Go/Node 与数据库 PostgreSQL/SQLite 可自由按应用组合。Web 不直接访问数据库；桌面访问本地服务使用带类型的 host port。业务权限在 API/host 层验证，UI 隐藏按钮不能代替授权。

规则的执行入口是 `pnpm agent -- architecture check`。它检查已配置目录的应用导入边界、UI 使用和存储迁移资产；native/toolchain 与业务约束继续使用项目 checks。

v2 的共享包通过 workspace:* 和 exports 连接。数据库、服务端 config/observability 不得进入 Web 或公共浏览器包，Prisma 类型也不属于公开契约；API client 无 React，React 依赖只放 query/UI 层。Tauri 的默认蓝图通过 API 读写业务数据，本地文件和平台操作走宿主端口。
