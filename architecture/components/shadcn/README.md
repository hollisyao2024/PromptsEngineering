# shadcn 公共组件

息壤 3.1.0 提供 33 个官方 shadcn 基础控件和 6 个可选 Registry 组合项，共 39 项。原有 24 个控件保持基础集；新增 Field、InputGroup、ButtonGroup、Command、Calendar、Alert、Empty、Spinner、Sonner 按选择项的依赖安装。来源是官方 new-york-v4/Radix registry；[provenance.json](provenance.json) 记录原始响应 URL/SHA-256，MIT 许可证随项目分发。源代码保留 cn 导入，只映射 registry 别名。

## 选择和实际安装目录

```json
{
  "schemaVersion": 1,
  "applications": [{
    "id": "web", "stack": "react-vite", "path": "apps/web",
    "componentSets": ["data-table", "react-hook-form"]
  }]
}
```

| componentSets 选择 | 公共实现 | 自动带入 |
| --- | --- | --- |
| data-table | DataTable：分页、选择、CRUD/批量回调、导出、显隐、排序与筛选 | selectors、dates、feedback |
| forms | FormField、FormSection、FormDialog、FormSheet | feedback |
| react-hook-form | RHFField、submitForm；RHF/Zod/resolvers 固定依赖 | forms |
| selectors | SearchSelect、MultiSelect、AsyncCombobox | feedback |
| dates | DatePicker、DateRangePicker、日历日期工具 | 所需基础控件 |
| feedback | ConfirmDialog、AsyncActionButton、Loading/Empty/ErrorState、Notifications/notify | 所需基础控件 |

省略 componentSets 默认选择 data-table。显式 [] 只初始化原有 24 个基础控件；不会引入 TanStack Table 或表单状态库。选择项及依赖闭包统一决定源码、依赖和测试。减少选择不会卸载已受管组件及其依赖，避免破坏项目已有引用。

默认实际路径为 apps/<app>/<sourceDir>/components/{ui,data-table,forms,selectors,feedback}。日期也在 selectors。跨应用共享时配置 components.ui = packages/ui/src/ui、components.dataTable = packages/ui/src/data-table，其他三组默认同级，也可以显式映射 components.forms/selectors/feedback。共享包安装所有消费者依赖的并集；编译/测试别名保持一致。源资产目录不能直接被业务代码导入。

用 architecture plan → init/update → install-deps → check 落地；init 默认也执行安装和检查。依赖固定在 [dependencies.json](../../dependencies.json)，兼容理由在 [dependency-audit.json](../../dependency-audit.json)。采用 React 19.2.8、TypeScript 6.0.3、TanStack Table 8.21.3；V9 的 ColumnDef 变化和 TypeScript 7 的 Compiler API 变化仍不适合直接替换既有消费者。

新增 cmdk 1.1.1、react-day-picker 10.0.1、date-fns 4.4.0、sonner 2.0.8、next-themes 0.4.6；可选 RHF 7.87.0、resolvers 5.9.1、Zod 4.5.4。新依赖均来自已核对的当前稳定版本，并在生成消费者中验证。项目 lib/utils.ts 仅缺失时初始化；既有 cn 和业务 helper 保留，clsx/tailwind-merge 继续提供兼容支持。

## 表单与异步操作

FormField 为输入关联 label、description、error 和 aria 属性；支持单子元素或 render prop。FormSection 支持 1/2 列布局。FormDialog/FormSheet 是受控容器，必须提供 open、onOpenChange、title、description、onSubmit；dirty 表示存在未保存修改，onDiscard 可在确认放弃时清理项目状态。

```tsx
<FormDialog open={open} onOpenChange={setOpen} title="编辑记录"
  description="修改名称后保存" dirty={dirty}
  onSubmit={async () => {
    if (!name.trim()) { setError("名称必填"); return false }
    await api.save({ name })
  }}>
  <FormField label="名称" error={error}>
    <Input value={name} onChange={e => setName(e.target.value)} />
  </FormField>
</FormDialog>
```

返回 false 保持打开；抛出的错误在面板内展示，输入保留并可重试；成功才关闭。提交中阻止重复和误关闭。使用 RHF 时传 onSubmit={submitForm(form, save)}，字段用 RHFField 的 render 回调；该适配明确区分校验失败，不能把 handleSubmit 的 void 结果当作成功。普通 forms 不导入 RHF。

ConfirmDialog 同样用受控 open/onOpenChange 和异步 onConfirm；false/异常保持打开。AsyncActionButton 接收 onAction，执行中显示状态、阻止重复，错误可重试。Notifications 在应用布局挂载一次，notify.success/error 用于轻量提示；持续错误留在 ErrorState 中。

## 搜索与日期

SearchSelect / MultiSelect 接收 label、options、受控 value/onChange；option 为 {value,label,disabled?,group?}。单选清除为 undefined，多选清除为 []。搜索、键盘、禁用项和清除由组件处理；selectedOptions 用来回显未包含在当前 options 中的选中项。

AsyncCombobox 接收稳定的 loadOptions(search,{signal}) → Promise<SelectOption[]>，可设 debounceMs。项目负责真实 API；组件处理加载、空结果、错误/重试、取消以及乱序结果丢弃。

DatePicker 的值是 YYYY-MM-DD，DateRangePicker 是 {from,to}；onChange(undefined) 清除。min/max 限制日期，范围支持 presets: [{label,value}]。输入必须是真实日期、完整且有序，使用本地日历日期转换，不做 UTC 序列化。服务端与项目负责明确时间戳的业务时区。

## DataTable

必传 data、columns、稳定 getRowId。onCreate/onEdit/onDelete/onExport 绑定实际业务；缺少回调时不展示对应写按钮。原有 Props 保持兼容，新筛选通过列 meta 指定：

```tsx
const columns: ColumnDef<Row>[] = [
  { accessorKey: "status", header: "状态", meta: {
    filterVariant: "multi-select",
    filterOptions: [{ value: "active", label: "启用" }, { value: "paused", label: "暂停" }]
  } },
  { accessorKey: "date", header: "日期", meta: { filterVariant: "date-range" } }
]
```

原有 text/select/range（数值范围）继续可用。服务端模式需要 query/onQueryChange/rowCount，并在接口中实现数组和日期范围筛选；跨页全量导出必须实现 onExport。导出默认可见列并防 CSV 公式注入。配置 canDelete 时，批量删除只包含已加载且通过校验的行；数量显示在按钮上。

## 示例、测试与升级

选择 data-table + forms（或 react-hook-form）时，初始页面和 src/examples/foundation-demo.tsx 提供内存 CRUD、日期/多选、异步选项、失败重试与通知示例。页面/示例只在缺失时生成，已有页面不会替换。其他选择使用适合已选依赖的起始页。各组件 tests 按闭包生成，可运行 pnpm test、pnpm type-check、pnpm build；Tauri Web 使用 pnpm build:web。

基础控件与公共组件走三方 update；依赖按字段合并；业务页面、示例、utils 走 init-if-missing。旧组件 owner ID 保留。局部升级 DataTable 会补齐新筛选/反馈和消费者依赖。冲突仍会阻断，不用复制覆盖来绕过基线。

registry.json 遵循官方 schema。node architecture/scripts/build-registry.js <输出目录> 生成内容内嵌、依赖固定的独立 JSON，供 shadcn CLI 使用；标准 CLI 使用其 components.json 的目录规则，带自定义组映射和模板升级管理的项目应使用 architecture 命令。

来源：[shadcn Field/RHF](https://ui.shadcn.com/docs/forms/react-hook-form)、[Date Picker](https://ui.shadcn.com/docs/components/radix/date-picker)、[Registry](https://ui.shadcn.com/docs/registry)。

## 高级能力组合

可选 auth、job-status、uploads、editor、charts、sortable、flow 和 virtual-table；具体组件 API 与依赖见 [开源能力指南](../../guides/open-source-components.md)。现有表格的虚拟化走 VirtualDataTable，分页、筛选、多选、CRUD 和导出仍由同一个 DataTable 实现。基础 Chart 源码与来源摘要已登记；Registry 合计 48 项，基础 UI 34 项。
