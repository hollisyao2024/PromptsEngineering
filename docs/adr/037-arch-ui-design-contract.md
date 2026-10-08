# ADR 037：界面视觉契约 DESIGN.md 的所有权与按需路由

- 状态：Accepted
- 日期：2026-10-06
- 关联：US-ARCHPLAT-015，TC-ARCHPLAT-015~017；模块架构 `architecture-platform` §9 界面视觉契约（息壤源仓已不保留，见 git 历史）
- 后续补充：2026-10-08 增补官方 lint 对骨架的验证结论，以及漂移检查延后的触发条件与设计输入；同日再补一次存量项目副本试验的映射数据点与两处取值难点，见文末「后续补充（2026-10-08）」；上文决策不变。

界面取值与无障碍目标原先分散在 UX 规范 §5～§7、PRD 与模块模板和各专家手册中，同一数值多处复述容易漂移，TDD 阶段也没有统一入口。采用项目根目录 `DESIGN.md`（YAML front matter 加固定顺序的八个二级章节，形态对齐 Google DESIGN.md alpha 规范）作为唯一视觉契约。作业包只在 `docs/data/templates/prd/DESIGN-TEMPLATE.md` 提供模板所有（`overwrite`）的骨架；根 `DESIGN.md` 不登记任何 manifest，因而属于项目，`template sync` 与 `template update` 永不写入。

路由只写在专家文件与手册：PRD 建立并维护，ARCH 只记录实现映射，TDD 实施前读取并先改 `DESIGN.md` 再改样式，QA 核验还原度与无障碍，TASK、DEVOPS 不加载。触发条件为任务触及界面且根 `DESIGN.md` 存在并含 YAML front matter，缺失时回退 UX 规范 §5 与 `styles.css`。`AGENTS.md`、`docs/CONVENTIONS.md`、`RULES.md` 每个新上下文都必读，不加入界面文字，避免常驻成本。UX 规范保留旅程、线框、状态与页面级检查清单，Token 与数值目标改为指向 `DESIGN.md`；既有误标“44×44px（WCAG 2.5.8）”更正为推荐 ≥ 44×44，WCAG 2.2 SC 2.5.8 最低 24×24（AA）。

骨架的色板与圆角取自 `architecture/components/shadcn/tokens.css` 的 `:root`，不含品牌色与网络字体；规范没有暗色机制，暗色策略以文字约定，由项目自行定义。不引入 `@google/design.md` 依赖：该规范仍为 alpha，且需要下载，项目可自行运行官方 lint。代价是有界面的项目多维护一个文件，且本轮不提供 `DESIGN.md` 与 `styles.css` 的自动漂移检查，依赖专家按需点读与 QA 核验；架构包 `ui.md` 增补与漂移检查另列后续（TASK-ARCHPLAT-012）。无服务端、schema、权限或部署变化。回滚为 revert 本次变更，项目已建立的根 `DESIGN.md` 仍是有效的项目文件。

## 后续补充（2026-10-08）

官方 lint 验证：v3.8.0 与 v3.8.1 的变更记录写明官方 lint 当时没有运行（下载未获授权）。2026-10-08 经批准下载后，用 `@google/design.md@0.4.0` 对骨架 `docs/data/templates/prd/DESIGN-TEMPLATE.md` 实跑：退出码 0，0 个错误，4 条 `orphaned-tokens` 警告（`foreground`、`destructive`、`border`、`ring` 已定义但没有组件引用）和 1 条统计信息，本次验证没有改动骨架。该包只在解压目录里运行，没有装进本仓，上文「不引入 `@google/design.md` 依赖」的决策不变。

4 条警告保留。骨架只有一个示例组件，官方允许的组件子 Token 只有 `backgroundColor`、`textColor`、`typography`、`rounded`、`padding`、`size`、`height`、`width`，没有边框或焦点环属性，写成 `borderColor` 会被当作未知子 Token 而报警告（`border` 虽不再算孤立，警告总数不变）。警告可以消除：另加分隔线、焦点环、正文、危险按钮 4 个示例组件，分别经 `backgroundColor` 或 `textColor` 引用 `border`、`ring`、`foreground`、`destructive`，实测 0 条警告、退出码 0。但这会让边框色和焦点环色以背景色的身份出现，还给骨架添上与示例无关的组件，所以没有这样做。官方 lint 也比本仓的结构断言宽松：未加引号的 `{colors.primary}`、把 front matter 换成围栏 yaml 代码块、把规范章节 `## Shapes` 降为 `### Shapes`，退出码和结果都与原骨架相同；重复的 `## Colors` 只得到章节顺序警告，包内 `dist/spec.md` 第 377 行写的却是「Error; reject the file」。另有一处两边都没拦：无单位的 `fontSize: 16` 官方 lint 不报问题，规范把 `fontSize` 定义为带单位的 Dimension，本仓断言也没有检查字号单位。因此官方 lint 通过不等于满足本仓断言，骨架与 `tokens.css` 的取值一致仍只由本仓测试检查；下游若接入官方 lint，应以退出码作门禁，不以警告条数作门禁。验证只覆盖 0.4.0（alpha）一个版本，在一台 macOS（Node v24.19.0）上进行。

漂移检查仍不实现，触发条件为二者之一：出现第一个真正采用 `DESIGN.md` 的下游界面项目；QA 手工抓到一次 `DESIGN.md` 与 `styles.css` 取值不一致。延后的理由是息壤源没有真实的根 `DESIGN.md` 与 `styles.css`，规则缺少真实输入可验证，而检查一旦随作业包分发，误报会直接阻断下游项目的检查。已经固定的是另一层：骨架与 `architecture/components/shadcn/tokens.css` 的取值一致（颜色、圆角、正文字体族），由 `template-surface.test.js` 里仅在息壤源运行的断言覆盖，不在延后范围内。上文提到的 TASK-ARCHPLAT-012 这一任务条目随 v3.10.1 清理源仓项目文档一并移除，上文与 v3.8.x 变更记录里的引用仅作历史；其中漂移检查部分的触发条件与设计输入改记在本节。

触发后的设计输入：只覆盖 shadcn 技术栈；只比较归一化后的颜色、圆角和正文字体族，不比较暗色、间距与组件；先只告警不阻断；夹具测试放在架构包。此前认为难点在「Token 名到 CSS 变量名的映射约定」，实测后更正：官方 `export --format css-tailwind` 从骨架导出 18 个名字，其中 7 个颜色名和 3 个圆角名与 `tokens.css` 的 `@theme inline` 逐一同名，映射本身不难。真正的难点有四处。一是另外 8 个名字（`--font-body`、`--text-body`、`--font-weight-body` 和 `--spacing-xs` 至 `--spacing-xl`）在 `tokens.css` 里没有对应项，间距、字号层级与组件都没有 CSS 对应物，导出的 `--font-body` 还把整串字体栈包进了一对引号，所以正文字体族应读 `body` 的 `font-family` 声明，不读 `--font-body`。二是 `DESIGN.md` 没有暗色机制，而 `tokens.css` 有 12 处 `.dark` 覆盖，只能比较亮色。三是颜色写法要先归一化，导出会把 `oklch(.30 .08 260)` 换成 `#142c55`。四是圆角要先展开 `calc(var(--radius) - 4px)` 这类写法，`--radius: .625rem`（10px）才得到导出的 6px、8px、10px。本节只增补记录，没有代码、模板、测试或配置变化。

### 存量项目副本试验

2026-10-08 在一个已有 `styles.css` 的下游界面项目（shadcn 技术栈，装有 3.7.8 版作业包）的一次性副本上，先把作业包更新到 3.10.4，再补建根 `DESIGN.md`，用 `@google/design.md@0.4.0` 实跑官方 lint：退出码 0，0 个错误，6 条 `orphaned-tokens` 警告（`popover`、`accent-foreground`、`border`、`input`、`ring`、`sidebar-muted` 已定义但没有组件引用）和 1 条统计信息。副本没有提交、推送或合并，下游真实仓库和骨架都没有改动。这 6 条与上文骨架上的 4 条同类：Token 由样式表消费，没有组件引用，不为消除警告而虚构组件。

映射数据点：25 个颜色 Token 加 `--` 前缀后，与 `styles.css` 里实际生效的 CSS 自定义属性逐一同名且取值一致（25/25）；圆角 8px、10px、12px 由 `--radius` 展开后一致；正文 14px、行高 1.6 和字体族也一致。这再次印证上文「映射本身不难」。

上文四处难点之外，读取「实际生效」的取值还有两处。一是这份样式表有两个 `:root` 块：前一块用 `oklch`，后一块用 17 个十六进制值和一个 `--radius` 重新定义了其中 18 个名字，而 `--popover-foreground` 只在前一块定义，再经 `var()` 引用，所以只读第一处声明会拿到被覆盖的旧值。二是 `body` 的 `font-family` 声明了两次，`@layer base` 里的 `ui-sans-serif, system-ui, sans-serif` 被未分层的中文字体栈覆盖，实际生效的是后者。因此将来若实现漂移检查，要先解决「读哪一处声明」：同名属性后者覆盖前者，`@layer` 外的声明覆盖层内声明，`var()` 先展开，之后才是比较。这三条取值规则已写进 PRD 手册 §5 的存量项目补建指引，供专家补建 `DESIGN.md` 时遵守。

这次是一次性副本，不算「真正采用」，上文延后的触发条件没有满足，漂移检查仍不实现。本小节只增补记录；同一次变更里的更新器与手册改动见 `CHANGELOG.md`。
