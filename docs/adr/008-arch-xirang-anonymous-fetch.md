# ADR-008：息壤官方公开模板匿名 HTTPS 获取

- 状态：Accepted
- 日期：2026-09-06
- 关联：US-CMDSURF-009 / AC-CMDSURF-009-06，CR-20260906-002
- 取代：ADR-007 中官方源使用项目 token 的鉴权部分，其余 SHA/收敛/所有权设计保持有效。

## 决策

固定官方 URL 的传输使用同步脚本内的独立匿名 Git 环境。初始化、fetch、解析和检出快照均使用该环境，移除项目 token、askpass、继承 Git 配置及仓库定位变量；屏蔽 system/global 配置与 init templates，禁用 credential helper、交互和 URL 重写。通过空 Authorization/Cookie 请求头禁止 libcurl 自动认证值进入请求，只允许 HTTPS、验证 TLS 且拒绝重定向。保留代理环境变量和显式 CA 路径以支持网络环境。

不改变进程全局环境或用户 Git 配置。显式非官方 source override 保留原有鉴权行为以兼容测试/受控 fork。项目 origin 的 fetch/push 与 PR 生命周期继续使用既有 github-auth 封装。官方 URL 即使通过 source override 显式指定，也仍走匿名路径。

官方 fetch 成功后固定 FETCH_HEAD commit SHA；fetch 失败不重试项目 token、不降级缓存，目标 tracked 文件零修改。新增 TEMPLATE_AUTH_MODE 审计字段，官方为 ANONYMOUS，非官方显式 override 为 PROJECT_DEFAULT。不记录 header、token 或敏感原始网络错误。

## 取舍

官方仓库必须保持公开。全局 Git 配置中的代理/CA 不自动继承，可使用 HTTPS_PROXY、GIT_SSL_CAINFO/GIT_SSL_CAPATH 等传输环境变量；不支持关闭 TLS 校验。无需新增 token 配置或私有官方源降级模式。

## 验证

环境构造单元测试覆盖 token、Git 配置、URL 重写、helper、askpass、TLS 与父进程不变；本地 HTTP Git 服务捕获请求验证 Authorization/Cookie 不存在，401 拒绝无凭据重试。官方 URL 路由测试与真实公开 GitHub 匿名 shallow fetch 补充验证。既有最新 SHA、自举、失败零写入、项目所有权与项目鉴权测试必须保持通过。
