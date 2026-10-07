# 业务测试驱动（e2e）

息壤业务测试自动化的 Web 驱动：为每个 UI 应用启动开发服务器，运行 `tests/<应用 id>/` 下的 Playwright 用例，并输出 JUnit 报告。`pnpm agent -- qa run` 读取该报告，把结果绑定到 PRD 原子验收标准（AC）与测试用例（TC），`qa verify` 据此判定业务验收门禁。

驱动与门禁之间只有三项约定：JUnit XML 报告、测试标题里的 AC/TC 编号、套件的 `platform` 标签。换成其他测试框架，满足这三项即可。

## 目录

| 路径 | 说明 |
| --- | --- |
| `playwright.config.ts` | 每个 UI 应用一个 project 与一个开发服务器；`retries` 固定为 0；JUnit 输出到 `reports/junit.xml` |
| `src/apps.ts` | 生成器按 UI 应用列表维护（应用 id、技术栈、开发服务器命令），请勿手改 |
| `tests/<应用 id>/` | 各应用的用例；示例用例只在文件缺失时创建，之后归项目所有 |
| `reports/`、`test-results/` | 运行产物，已写入本目录 `.gitignore` |

Tauri 应用只覆盖其 Web 层（`dev:web`），不启动原生壳；iOS、Android 需要另配驱动。

## 首次使用

浏览器由项目自行获取，模板不会下载：

```bash
pnpm --filter @project/e2e exec playwright install chromium
```

也可以设置 `E2E_BROWSER_CHANNEL=chrome` 使用本机已安装的 Google Chrome，跳过下载。运行全部用例：

```bash
pnpm --filter @project/e2e run e2e
```

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `E2E_BASE_PORT` | `4310` | 第一个 UI 应用的端口，其余应用依次加一；须为不小于 1024 的整数 |
| `E2E_BROWSER_CHANNEL` | 未设置 | 例如 `chrome`、`msedge`；未设置时使用 `playwright install` 下载的 Chromium |
| `E2E_SKIP_WEBSERVER` | 未设置 | 设为 `1` 时不启动开发服务器，直接测试已在上述端口运行的应用 |

开发服务器按需编译，首次运行可能较慢；需要调整 `timeout` 或 `workers` 时直接修改 `playwright.config.ts`，模板更新会按三方合并保留你的改动。

## 接入业务验收门禁

模板不会修改 `agent.config.json`。把下面的片段合并进项目配置（已有 `qa.business.suites` 时只追加这一项）：

```json
{
  "qa": {
    "business": {
      "enabled": true,
      "suites": [
        {
          "name": "e2e",
          "platform": "web",
          "command": "pnpm --filter @project/e2e run e2e",
          "report": "{{modulePath}}/reports/junit.xml"
        }
      ]
    }
  }
}
```

随后依次运行 `pnpm agent -- qa paths`、`pnpm agent -- qa run`、`pnpm agent -- qa verify`。`report` 相对仓库根目录，`playwright.config.ts` 中的 `outputFile` 相对本目录，二者必须指向同一个文件；报告路径只在驱动配置里维护，不要再写进 `command`。

## 编写用例

- 每个 AC 对应一个 `test.describe('<AC 编号> …')`，每个用例标题以 `<TC 编号>` 开头，JUnit 用例名因此同时带有两者；示例用例里的编号只是占位符，需要替换成真实编号。
- 编号取自 PRD 原子 AC 表与 `docs/qa-modules/<功能域>/PATHS.md`，不要自行编造；缺少编号的用例只会在门禁里披露为风险，不会计入覆盖。
- 预期结果取自 PRD、数据字典、UX 规范与 ARCH 接口契约，不要抄被测代码的当前输出。
- 不要用重试、`test.fixme` 或随机数据掩盖不稳定的用例；先修复它。
