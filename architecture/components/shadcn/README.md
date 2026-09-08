# shadcn 与公共 DataTable

24 个基础控件来自官方 `new-york-v4` registry，来源 URL 与原始响应 SHA-256 见 provenance.json，MIT 许可证随生成项目分发。仅将 `cn` 与 registry imports 映射到项目别名。没有使用原生 Select。

`registry/ui/` 保存基础控件；`registry/data-table/` 保存组合表格。`tokens.css` 是项目可修改的语义 Token 起点。`tests/` 随应用生成并执行真实 DOM 交互验证。

默认实际路径是 apps/<app>/src/components/ui 与 apps/<app>/src/components/data-table；通过 architecture.config.json 的 components 映射可共享到 packages。components.json 的 aliases 配合 tsconfig/Vite 解析，不把模板源目录当作业务导入目录。

DataTable 必传 data、columns 和稳定 getRowId；可选 onCreate/onEdit/onDelete/onExport 绑定实际业务，不提供回调时对应写按钮不展示。排序、文本/枚举/范围列筛选、全局搜索、翻页、多选、列显隐、CSV 导出、批量操作与加载/空/错误状态都在公用组件中完成。服务端模式需要完整 query、onQueryChange 和 rowCount；跨页全量导出必须实现 onExport。canDelete 按行配置时，批量删除仅包含当前已加载且通过校验的行，其数量显示在按钮上。

registry.json 遵循官方 registry schema，target 使用 @ui/、@components/ 占位符。`node architecture/scripts/build-registry.js <输出目录>` 构建带内嵌内容、固定依赖及完整依赖闭包的 registry item JSON，可直接交给 shadcn CLI。日常模板初始化优先使用 architecture 命令，以同时获得版本锁和受管更新。

来源：[Registry](https://ui.shadcn.com/docs/registry)、[components.json](https://ui.shadcn.com/docs/components-json)、[registry-item.json](https://ui.shadcn.com/docs/registry/registry-item-json)。
