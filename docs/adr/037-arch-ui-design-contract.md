# ADR 037：界面视觉契约 DESIGN.md 的所有权与按需路由

- 状态：Accepted
- 日期：2026-10-06
- 关联：US-ARCHPLAT-015，TC-ARCHPLAT-015~017；[模块架构](../arch-modules/architecture-platform/ARCH.md#9-界面视觉契约-designmd38)

界面取值与无障碍目标原先分散在 UX 规范 §5～§7、PRD 与模块模板和各专家手册中，同一数值多处复述容易漂移，TDD 阶段也没有统一入口。采用项目根目录 `DESIGN.md`（YAML front matter 加固定顺序的八个二级章节，形态对齐 Google DESIGN.md alpha 规范）作为唯一视觉契约。作业包只在 `docs/data/templates/prd/DESIGN-TEMPLATE.md` 提供模板所有（`overwrite`）的骨架；根 `DESIGN.md` 不登记任何 manifest，因而属于项目，`template sync` 与 `template update` 永不写入。

路由只写在专家文件与手册：PRD 建立并维护，ARCH 只记录实现映射，TDD 实施前读取并先改 `DESIGN.md` 再改样式，QA 核验还原度与无障碍，TASK、DEVOPS 不加载。触发条件为任务触及界面且根 `DESIGN.md` 存在并含 YAML front matter，缺失时回退 UX 规范 §5 与 `styles.css`。`AGENTS.md`、`docs/CONVENTIONS.md`、`RULES.md` 每个新上下文都必读，不加入界面文字，避免常驻成本。UX 规范保留旅程、线框、状态与页面级检查清单，Token 与数值目标改为指向 `DESIGN.md`；既有误标“44×44px（WCAG 2.5.8）”更正为推荐 ≥ 44×44，WCAG 2.2 SC 2.5.8 最低 24×24（AA）。

骨架的色板与圆角取自 `architecture/components/shadcn/tokens.css` 的 `:root`，不含品牌色与网络字体；规范没有暗色机制，暗色策略以文字约定，由项目自行定义。不引入 `@google/design.md` 依赖：该规范仍为 alpha，且需要下载，项目可自行运行官方 lint。代价是有界面的项目多维护一个文件，且本轮不提供 `DESIGN.md` 与 `styles.css` 的自动漂移检查，依赖专家按需点读与 QA 核验；架构包 `ui.md` 增补与漂移检查另列后续（TASK-ARCHPLAT-012）。无服务端、schema、权限或部署变化。回滚为 revert 本次变更，项目已建立的根 `DESIGN.md` 仍是有效的项目文件。
