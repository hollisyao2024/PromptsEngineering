# 本机 GitHub 代理

GitHub 工具每次操作解析代理，不写入全局 Git 配置、shell 配置或系统网络设置。
适用于调用本仓库入口的本机客户端；不影响远端连接器、云端执行器或绕过入口的裸命令。

## 选择顺序

1. 已显式设置的 `http_proxy` / `https_proxy` / `all_proxy`（支持大写）；小写优先，包括空值。发现任意显式代理变量即停止系统探测，不混入另一套系统代理。`ALL_PROXY` 补齐未设置的协议变量。
2. Git 的 `http.proxy` / URL 专属代理配置（包括空值表示直连）。Git 子进程仍保留 Git 原生配置优先级；API 查询 `https://api.github.com/`，Git 包装器查询 `https://github.com/`。
3. macOS `scutil --proxy` 中已启用的 HTTP/HTTPS 配置。每次读取，不猜测客户端名称、端口，也不缓存上一次端口。
4. 没有启用的代理则直连。Windows/Linux 不探测 macOS 配置，继续使用显式配置或直连。

设置 `XIRANG_SYSTEM_PROXY=0` 仅关闭系统自动探测，保留显式环境变量和 Git 配置。
要明确直连，可在该命令环境中设置空 `https_proxy`，并核对 Git 自身没有另外配置代理。
已选择的代理失败时不自动切换直连；修正配置或关闭系统代理后再次运行。

## 入口与约束

- `github-auth-run.js`：向子进程传递代理；Git/GitHub CLI 使用环境变量，支持的 Node 子进程启动时默认启用 `NODE_USE_ENV_PROXY=1`（已有该变量时保留）。
- `buildGitHubGitEnv`：覆盖 worktree、TDD、QA 的 Git 网络调用，公共仓库没有令牌也会解析代理。
- `github-api.js`：使用每次请求独立的 HTTPS agent，代理无需在当前 Node 进程启动时已存在，不改全局 agent；有代理时要求 Node 24.5+ 或 22.21+。仅支持 HTTP(S) 代理 URL。
- TDD/QA 的 `gh` 分支使用同一解析器。
- 整体 build/deploy 命令仅复用鉴权，不继承自动发现的代理；其中 GitHub 工具在各自入口解析，避免改变非 GitHub 部署流量。
- 官方模板和架构匿名拉取：先清除令牌、认证头和 Git 配置，再解析系统/环境代理，继续禁用凭据配置；不从个人 Git 配置导入代理或项目令牌。

Git HTTPS 与 API 均支持此功能；SSH remote 的网络路由由 SSH 自身配置管理，不自动改写 `ProxyCommand`。
自动探测暂不执行 PAC/WPAD，也不把仅 SOCKS 的系统配置误当作无代理：此时明确报错，需提供 HTTP(S) 代理或关闭自动探测。

显式 `NO_PROXY` / `no_proxy` 优先（包括空值）。系统例外中的 `*.domain` 转为 `.domain`；CIDR 保留供 Git/curl 使用。`<local>` 仅指不带点的主机名，不适用于固定的 GitHub 公网主机。Node 对 CIDR 的支持不作保证，API 使用 DNS 主机名；这不是任意内部服务的通用系统代理适配器。
错误日志不输出代理凭据。代理设置已启用不代表端口可达，实际访问错误会终止操作，无自动直连重试。

## 验证

`infra/scripts/shared/__tests__/github-system-proxy.test.js` 覆盖动态系统配置、显式优先级、禁用探测、直连例外、匿名认证隔离，并用本机 HTTP CONNECT 服务验证 Git 和 API 的真实路由及失败行为。
