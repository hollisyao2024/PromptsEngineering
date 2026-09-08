# React / shadcn UI 标准

本标准在项目选择 React/shadcn 架构模块后适用。所有业务交互使用已安装的 shadcn 组件，禁止在业务页面直接书写 button/input/select/option/textarea/dialog/details/summary 等原生交互控件；底层组件内部的语义 HTML 是允许的。Native Select 不属于本模块选项。样式统一使用语义 Token，保持键盘操作、可见焦点和无障碍名称。

所有业务数据表统一组合公共 DataTable。业务层只定义原始 accessor、单元格渲染、稳定 getRowId、真实数据和 CRUD/导出/权限回调。排序、列筛选、分页、多选、列显隐、状态行和确认交互均由公共表格负责，禁止业务页面重写 Table 或表格状态系统。

默认安装目录见 directories.md。shadcn 官方基础控件源和许可证保存在 architecture/components/shadcn；项目中的组件代码可修改，后续采用三方更新保护定制。新增通用能力先进入公用组件并补行为测试。RULES.md 只记录项目额外要求，不复制本标准。

客户端模式拥有完整数据；服务端模式必须提供总数、受控查询与状态回调，服务端全量导出必须提供真实导出回调。选择基于稳定行 ID；导出默认可见列，CSV 文本避免电子表格公式注入。批量操作范围在按钮附近显示；删除需确认。没有业务回调的按钮不显示，不实现假新增/假保存。
