# 本轮缺陷回归

| ID | 复现及影响 | 修复 | 验证 / 状态 |
| --- | --- | --- | --- |
| ARCHPLAT-D01 | Next 测试保留 JSX 导致解析失败 | 生成 React 测试插件并对齐框架 TS 配置 | Next 8 项测试与 build；Closed |
| ARCHPLAT-D02 | 批量写入时外部锁变更可能被最后提交覆盖 | 提交前再次复验版本锁；串行化旧 writer 锁恢复 | 注入锁变更测试由红转绿；Closed |
| ARCHPLAT-D03 | Registry 单独安装 dialog 缺少 Button | 按实际源导入递归收集固定版本组件闭包 | 全部 25 项闭包断言；Closed |
| ARCHPLAT-D04 | 原生骨架未带图标导致 Rust 宏失败 | 首次构建生成确定性默认图标并保留自有图标 | 全新 Tauri cargo check；Closed |
| ARCHPLAT-D05 | 共享包出现 React 重复实例、类型身份和样式扫描缺失 | 统一解析运行时/类型、共享 utils 别名和显式 Tailwind source | Vite/Next 8 项测试及类型/生产构建；Closed |
| ARCHPLAT-D06 | 分组表头重复全选且范围筛选失效 | 页选择跨表头行、按叶列 metadata 筛选 | 分组交互回归；Closed |
| ARCHPLAT-D07 | 失败发布可能回退外部已切换链接 | 独占发布锁和链接归属复验 | 并发与外部变更测试；Closed |
| ARCHPLAT-D08 | React 类型路径被误报为应用源码依赖 | 依赖解析排除 node_modules，仍检查真实 apps 源码 | 组合 checks、原生/低阶 Table 负向检查；Closed |
| ARCHPLAT-D09 | 3.0.1 切换 cn 时，替换旧 utils 实现会与项目新增辅助函数冲突 | utils 改为 init-if-missing，保留旧依赖，基础控件直接导入 cn | 定向保护测试和真实 3.0.0 消费者升级/收敛；Closed |
| ARCHPLAT-D10 | TypeScript 6 下全新 Next 项目在首次 build 前 type-check 缺少 CSS 副作用导入声明 | 初始化 next-env.d.ts，补显式 types 与不依赖 baseUrl 的相对 paths | 独立 type-check、Next 构建及 Node 22.22.2 构建；Closed |
| ARCHPLAT-D11 | P1：共享组件的 cmdk/day-picker 等依赖在 Vitest 中加载第二个 React，期望正常渲染而实际 hook 报错 | Vite/Vitest 对依赖闭包统一 dedupe | Vite/Next/Tauri Web 各 29 项及构建；Closed |
| ARCHPLAT-D12 | P0：取消选集后若移除依赖，仍保留的受管源码无法编译；期望保留有效安装 | 从版本锁内受管文件恢复已安装组件闭包，不将取消选择视作卸载 | 连续两轮更新及依赖保留集成；Closed |
| ARCHPLAT-D13 | P1：受控面板没有内部 Trigger，关闭后焦点未回入口；期望键盘可继续工作 | 记录打开前元素，在 Dialog/Sheet 及确认关闭时恢复焦点 | focus DOM 与真实新增/侧栏保存；Closed |
| ARCHPLAT-D14 | P1：Next 生产 1280×720 弹窗打开日期并填值，Apply 超出视口，点击触发 dirty 关闭；期望只应用日期 | QA No-Go 回流 TDD；限制 Popover 可用高度并内部滚动，日期/范围同时修复 | 嵌套 Dialog/Sheet 2 项 DOM；1280×720/390×640 浏览器均应用并保存正确值，无关闭误触；Closed |
