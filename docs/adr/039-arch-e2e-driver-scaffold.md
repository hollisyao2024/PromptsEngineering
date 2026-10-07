# ADR-039：业务测试驱动脚手架作为 architecture 包的可选 `e2e` 模块

- 日期：2026-10-07
- 状态：Accepted
- 关联：US-OSSKIT-009（AC-OSSKIT-009-01～04）；承接 [ADR-038](038-arch-business-test-automation.md)（US-BIZTEST-001～006）

## 背景

ADR-038 把业务测试拆成“创作期推导、脚本期判定”，只约定驱动无关接口，并明确把“驱动脚手架”留给 architecture 包后续提供。3.9.0 起 `qa run` 能运行任意驱动、`qa verify` 能按 AC 判定，但项目仍要自己写 Playwright 配置、开发服务器启动、报告路径与用例命名，容易触碰既有约束：报告未被 git 忽略（R-BIZ-008）、报告路径写成命令内联环境变量（R-BIZ-009）、重试把失败变成通过、AC/TC 标识没有进入用例名而被当作“无标识”只披露不判定。

## 决策

1. **形态**：架构开源能力包新增可选模块 `e2e`，默认路径 `packages/e2e`，包名 `@project/e2e`，所有权 `architecture:module:e2e`。它不是应用，不进入任何应用的 `modules`，也不被应用依赖。
2. **前置**：v2 workspace 且至少一个 UI 应用（manifest 中 `stacks.<stack>.ui` 非空，即 react-vite、react-next、tauri）。无 UI 应用、应用声明 `e2e`、`options` 非空，一律在写任何文件前报错，不降级为占位。
3. **只对接三项契约**：JUnit XML 报告、用例名携带 AC/TC 标识、套件 `platform` 标签。模块不写 `agent.config.json`；README 提供可粘贴的 `qa.business.suites` 片段（`platform` 为 `web`，`command` 为 `pnpm --filter @project/e2e run e2e`，`report` 为 `<模块路径>/reports/junit.xml`）。`qa paths`、`qa run`、`qa verify` 及报告解析器不变。
4. **生成物与所有权策略**：
   - `playwright.config.ts`（`update`）：每个 UI 应用一个 project（`testDir` 为 `tests/<应用 id>`）与一个 `webServer`；`retries` 为 0；reporter 为 list 加 junit，`outputFile` 为 `reports/junit.xml`，相对配置文件目录解析而与 cwd 无关；`reuseExistingServer` 为 `false`。
   - `src/apps.ts`（`update`）：由 `architecture.config.json` 的应用列表生成 `{id, stack, command}`，是唯一随项目配置变化的生成物。
   - `tests/<应用 id>/sample.spec.ts`（`init-if-missing`）：示例用例，`describe` 标题以占位 AC 标识开头、`test` 标题以占位 TC 标识开头，项目改成 PRD 的真实标识后归项目所有。
   - `README.md`（`update`）；`package.json`、`tsconfig.json`（`merge-json`）；`.gitignore`（`append-lines`，含 `node_modules/`、`reports/`、`test-results/`、`playwright-report/`）。
5. **启动与端口**：每个应用使用独立 e2e 端口，等于 `E2E_BASE_PORT`（默认 4310）加应用序号，避开 5173、3000、1420 等开发端口。启动命令按栈固定：react-vite 为 `pnpm --filter @project/<id> run dev --port {port} --strictPort`，react-next 为 `pnpm --filter @project/<id> run dev -p {port}`，tauri 为 `pnpm --filter @project/<id> run dev:web --port {port} --strictPort`（只启动 Web 层，不启动 Rust 与原生窗口）。端口被占用时 Playwright 以 `reuseExistingServer: false` 明确报错，不静默测到其他服务。
6. **环境变量**：`E2E_BASE_PORT`、`E2E_BROWSER_CHANNEL`（例如 `chrome`，使用系统浏览器）、`E2E_SKIP_WEBSERVER=1`（针对已手工启动的服务运行）。浏览器由项目显式获取（`playwright install` 或系统 Chrome），模板与 `architecture init` 都不下载。
7. **依赖**：`@playwright/test` 精确固定 1.62.1，作为 devDependencies，运行时依赖为空；同步登记于 `dependencies.json`、`dependency-audit.json` 与 `open-source-catalog.json`。
8. **包边界**：`package.json` 不含 `exports`；脚本只有 `type-check`（`tsc --noEmit`）与 `e2e`（`playwright test`），不定义 `test`、`build`、`generate`，避免根目录 `test:workspace`、`build`、`generate` 聚合命令误启动浏览器与开发服务器。`workspace-check` 把 `e2e` 列入私有根包，应用或共享代码导入它即失败。
9. **用例命名约定**：AC 标识写入 `describe` 标题，TC 标识写入 `test` 标题。已用真实 Playwright 验证其 JUnit 形态：describe 标题并入 testcase 的 `name`，project 名写在 testsuite 的 `hostname`，所以标识不能只放在 project 名或文件名中。

## 取舍与后果

- 拒绝把 Playwright 内置进 `qa run`：会让脚本引入依赖与浏览器，破坏 ADR-038 的零依赖、确定性与驱动无关；脚手架留在 architecture 包，按项目选择生成。
- 拒绝改写项目的 `agent.config.json`：它由项目所有，模板更新不得改写；以可粘贴片段代替，项目评审后自行加入。
- 拒绝把驱动放进应用包：应用会依赖测试工具，且多应用需要共享同一份报告与 project 配置。
- 拒绝自动执行 `playwright install`：下载浏览器需要网络与显式许可，`architecture init` 也不应因此无法离线运行；README 给出手动步骤，也可用系统 Chrome。
- 拒绝默认重试：重试会把不稳定用例变成“通过”，使 P0 验收判定失真；flaky 策略留作后续立项。
- 版本固定 1.62.1，而非 npm 最新 1.63.0：1.62.1 是唯一在本机实际运行过的版本，1.63.0 未运行；差异记入审计与 QA，升级时必须重新跑真实驱动证据。
- 范围限制：仅 Web 与 Tauri 的 Web 层；iOS、Android 与原生桌面驱动仍由项目按 ADR-038 契约自选。
- 未验证项：模板源不安装应用依赖，所以真实 react-vite、react-next 开发服务器对 `--port`、`--strictPort`、`-p` 的处理，以及 tauri 的 vite 配置端口 1420 与 `--port` 的覆盖关系都没有用真实依赖验证；已实测的只有 pnpm 会把附加参数追加到脚本命令之后，以及端口被占用时 Playwright 以退出码 1 与明确信息报错。项目首次接入时应以一次真实运行确认，QA 如实披露。
- 端口取决于应用声明顺序：增删应用会使后续端口整体位移，不影响正确性，只影响手工启动服务时的端口约定。
- `src/apps.ts` 采用 `update`：项目自定义启动命令后，若模板因新增应用而更新同一区域，按既有 `update` 契约冲突即阻断，不静默覆盖。
