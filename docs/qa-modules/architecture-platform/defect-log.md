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
