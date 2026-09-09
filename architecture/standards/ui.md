# React / shadcn UI 标准

本标准在项目选择 React/shadcn 架构模块后适用。所有业务交互使用已安装的 shadcn 组件，禁止在业务页面直接书写 button/input/select/option/textarea/dialog/details/summary 等原生交互控件；底层组件内部的语义 HTML 是允许的。Native Select 不属于本模块选项。样式统一使用语义 Token，保持键盘操作、可见焦点和无障碍名称。

所有业务数据表统一组合公共 DataTable。业务层只定义原始 accessor、单元格渲染、稳定 getRowId、真实数据和 CRUD/导出/权限回调。排序、列筛选、分页、多选、列显隐、状态行和确认交互均由公共表格负责，禁止业务页面重写 Table 或表格状态系统。

默认安装目录见 directories.md。shadcn 官方基础控件源和许可证保存在 architecture/components/shadcn；项目中的组件代码可修改，后续采用三方更新保护定制。新增通用能力先进入公用组件并补行为测试。RULES.md 只记录项目额外要求，不复制本标准。

客户端模式拥有完整数据；服务端模式必须提供总数、受控查询与状态回调，服务端全量导出必须提供真实导出回调。选择基于稳定行 ID；导出默认可见列，CSV 文本避免电子表格公式注入。批量操作范围在按钮附近显示；删除需确认。没有业务回调的按钮不显示，不实现假新增/假保存。

公共组件集由 applications[].componentSets 选择，component-sets.json 和 registry.json 共同定义依赖闭包。项目表单复用 FormField/FormSection、FormDialog/FormSheet；本地/异步选项复用 SearchSelect/MultiSelect/AsyncCombobox；日期复用 DatePicker/DateRangePicker；异步确认和加载/空/失败状态复用 feedback 组件。RHF 只在选择 react-hook-form 时安装，业务验证可以使用项目自己的方案。

提交回调返回 false 代表校验未通过，不关闭面板；抛错展示提交错误并保留输入；成功才关闭。未保存关闭须确认，处理中阻止重复提交。API、鉴权和数据持久化由项目负责；UI 按钮禁用不代替服务端权限判断。

日历日期以 YYYY-MM-DD 传递，范围为 {from,to}，避免使用 UTC 解析或 toISOString 截取日期。DataTable 日期列的 accessor 应返回同格式的日历日期；时间戳须由项目按业务时区转换。多选列筛选值为字符串数组，日期范围值为有序完整范围；服务端模式必须在查询接口实现对应语义。

AsyncCombobox 的 loadOptions 使用稳定回调，接受 {signal}，同时用请求序号防止不响应取消的旧请求覆盖新结果。selectedOptions 提供不在当前搜索结果中的已选标签。Notifications 在应用布局挂载一次，由项目在操作成功/失败时调用 notify。
