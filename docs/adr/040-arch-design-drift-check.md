# ADR-040：`DESIGN.md` 与 `styles.css` 的漂移检查只告警

- 日期：2026-10-09
- 状态：Accepted
- 关联：承接 [ADR-037](037-arch-ui-design-contract.md)「后续补充（2026-10-08）」记下的延后触发条件与设计输入

## 背景

ADR-037 把漂移检查延后，触发条件为二者之一：出现第一个真正采用 `DESIGN.md` 的下游界面项目，或 QA 手工抓到一次取值不一致。两条现在都已满足。一个 shadcn 技术栈的下游项目已经把根 `DESIGN.md` 提交进主干，随后又在页面上发现标题字号与契约不一致，需要人工修正。那次漂移在字号上，不在本检查范围内，但它说明靠专家点读与 QA 核验并不能及时发现两处取值分叉。

ADR-037 已经给出设计输入：只覆盖 shadcn 技术栈，只比较归一化后的颜色、圆角和正文字体族，先告警不阻断，夹具测试放在架构包。它还记下了读取「实际生效取值」的规则：同名属性后者覆盖前者，`@layer` 外的声明覆盖层内声明，`var()` 先展开再比较。

## 决策

1. 架构包新增 `architecture/checks/design-drift.js`，由 `checkProject` 在应用、数据存储、模块与工作区检查之后调用。只检查技术栈 `ui` 为 `shadcn` 且目录存在的应用，读取根 `DESIGN.md` 与该应用的 `<path>/<sourceDir>/styles.css`。
2. 比较范围只有 front matter 里实际声明的三类取值。`colors.<key>` 对应 `:root` 的 `--<key>`。`rounded.<key>` 对应 `--radius-<key>`。`typography.body.fontFamily` 对应 `body` 的 `font-family`。不比较暗色、间距、字号层级和组件。
3. 取值读取规则按 ADR-037。样式表里 `:root` 与 `body` 的声明按「后者覆盖前者、未分层覆盖 `@layer` 内」取实际生效值，`!important` 按层叠规则反转层序，`@theme` 块视为分层声明。`.dark` 等其他选择器以及 `@media`、`@supports`、`@container` 内的声明都跳过，只比较亮色基线。`var()` 递归展开，带回退值，环引用视为无法解析。`DESIGN.md` 内的 `{colors.primary}` 这类引用先在 front matter 内解析。
4. 颜色统一换算为 sRGB 的 0–255 通道再比较，每个通道允许相差 1，透明度允许相差 0.01。支持十六进制、`rgb()`、`hsl()`、`oklch()` 和 `white`、`black`、`transparent`。`oklch` 先经 OKLab 换算为线性 sRGB，超出色域时按通道截断，与官方导出 `oklch(.30 .08 260)` → `#142c55` 一致。圆角统一换算为 px，`1rem` 按 16px，支持 `calc()` 四则运算，误差 0.01px。字体族按顶层逗号拆分，去引号、合并空白并转小写后逐项比较。
5. 结果只是告警。`checkProject` 返回新增的 `warnings` 字段，每条为 `{name: 'design:<应用>', code, reason}`；`status` 与 `failures` 不受影响，检查实际执行时在 `checks` 里登记 `design:<应用>`。告警代码有：
   - `DESIGN_DRIFT_COLOR`、`DESIGN_DRIFT_RADIUS`、`DESIGN_DRIFT_FONT_FAMILY`：取值不一致。
   - `DESIGN_DRIFT_TOKEN_MISSING`：`DESIGN.md` 声明了取值，样式表里没有对应变量或 `body` 字体族。
   - `DESIGN_DRIFT_UNSUPPORTED_VALUE`：任一侧的写法不支持或无法解析，例如 `color-mix()`、`em`、未定义的变量。
   - `DESIGN_DRIFT_INVALID_DESIGN`：front matter 没有闭合、不是合法 YAML 或不是映射。
   - `DESIGN_DRIFT_STYLES_MISSING`：应用的 `styles.css` 不存在。
   - `DESIGN_DRIFT_CHECK_ERROR`：意外异常；检查本身从不抛错。
6. 没有根 `DESIGN.md`、文件首行不是 `---`，或项目没有 shadcn 应用时，检查不执行，也不登记 `design:` 项，与 ADR-037 的触发条件一致。
7. 作业包的工作流门禁 `runArchitectureCheck` 在判定结果之前，把每条告警写到标准错误，格式为 `ARCHITECTURE_WARNING=<name>|<code>|<reason>`，换行替换为空格。`tdd sync` 与 `qa verify` 因此都能看到告警，门禁结果不变。架构包 CLI 的 `architecture check` 照常输出完整 JSON，其中含 `warnings`。项目固定在旧版架构包时，检查器不返回 `warnings`，门禁照常运行。
8. 夹具测试在 `architecture/__tests__/design-drift.test.js`，覆盖骨架与 `tokens.css`、下游形态样式表、各类漂移、无法解析、跳过条件、门禁输出和颜色、长度换算向量。

## 取舍

- 只告警不阻断：规则首次分发，下游样式表写法多样，误报不应阻断 `tdd sync` 或 `qa verify`。是否升级为阻断，等积累真实告警后另行决定。
- 自写解析器，不引入依赖：作业包与架构包不带运行期依赖，CSS 只读取 `:root` 与 `body` 两类规则，YAML 复用已随包分发的 `tooling/xirang/vendor/yaml`。代价是不认识 `color-mix()`、相对颜色语法和大部分颜色名，它们以 `DESIGN_DRIFT_UNSUPPORTED_VALUE` 告警，不会静默通过。
- 色域外的 `oklch` 只按通道截断，不做色域映射。这与浏览器的渲染结果可能有细微差别，只在两侧都用色域外取值时才会出现，容差也已覆盖常见的取整差。
- 不同 `@layer` 之间不按层声明顺序排序，只按源码先后。常见的 `@layer base` 单层写法不受影响。
- 字号层级、间距、组件和暗色仍不在范围内，延续 ADR-037 的设计输入。

## 影响

- 无服务端、schema、权限或部署变化，不改变任何门禁的通过条件。
- 告警只在项目有根 `DESIGN.md`、有 shadcn 应用且检查实际执行时出现；没有采用 `DESIGN.md` 的项目输出不变。
- 回滚为 revert 本次变更；项目的 `DESIGN.md` 与 `styles.css` 不受影响。
