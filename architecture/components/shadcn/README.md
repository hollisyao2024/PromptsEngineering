# shadcn 与公共 DataTable

24 个基础控件来自官方 `new-york-v4` registry，来源 URL、核对时间与原始响应 SHA-256 见 provenance.json，MIT 许可证随生成项目分发。保留上游从 `cn` 包导入的实现，只将 registry imports 映射到项目别名。没有使用原生 Select。

依赖固定版本及兼容性决定见 [dependencies.json](../../dependencies.json) 和 [dependency-audit.json](../../dependency-audit.json)。3.0.1 采用 `cn` 0.2.6、React 19.2.8、Lucide 1.43.0、TypeScript 6.0.3、Vitest 5.0.0 和 Next 16.3.4。TanStack Table 保留最新 V8 8.21.3，避免 V9 的 `ColumnDef` 类型变化破坏项目业务代码；TypeScript 7 缺少当前检查使用的 Compiler API，使用最新兼容 V6。

新项目的 `lib/utils.ts` 转导出 `cn`。已有应用或共享包的工具文件只在缺失时初始化，项目添加的 helper 和原有 `cn` 实现保留；`clsx`、`tailwind-merge` 继续作为兼容依赖提供。公共控件直接使用新 `cn` 包，不依赖改写项目工具文件。

`registry/ui/` 保存基础控件；`registry/data-table/` 保存组合表格。`tokens.css` 是项目可修改的语义 Token 起点。`tests/` 随应用生成并执行真实 DOM 交互验证。

默认实际路径是 apps/<app>/src/components/ui 与 apps/<app>/src/components/data-table；通过 architecture.config.json 的 components 映射可共享到 packages。components.json 的 aliases 配合 tsconfig/Vite 解析，不把模板源目录当作业务导入目录。

DataTable 必传 data、columns 和稳定 getRowId；可选 onCreate/onEdit/onDelete/onExport 绑定实际业务，不提供回调时对应写按钮不展示。排序、文本/枚举/范围列筛选、全局搜索、翻页、多选、列显隐、CSV 导出、批量操作与加载/空/错误状态都在公用组件中完成。服务端模式需要完整 query、onQueryChange 和 rowCount；跨页全量导出必须实现 onExport。canDelete 按行配置时，批量删除仅包含当前已加载且通过校验的行，其数量显示在按钮上。

registry.json 遵循官方 registry schema，target 使用 @ui/、@components/ 占位符。`node architecture/scripts/build-registry.js <输出目录>` 构建带内嵌内容、固定依赖及完整依赖闭包的 registry item JSON，可直接交给 shadcn CLI。日常模板初始化优先使用 architecture 命令，以同时获得版本锁和受管更新。

来源：[Registry](https://ui.shadcn.com/docs/registry)、[components.json](https://ui.shadcn.com/docs/components-json)、[registry-item.json](https://ui.shadcn.com/docs/registry/registry-item-json)。
