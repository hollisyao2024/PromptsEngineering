# /qa auto — 自动测试闭环

用户调用本命令即授权在既定需求内生成测试、执行、修复实现并重新验证。当前编码代理必须连续推进，不能只给计划或停在角色切换。不得新增 `/test`。

## 用法

```text
/qa auto                         当前任务的完整影响范围
/qa auto --project               整个项目
/qa auto --module accounts       指定模块及受影响消费者
/qa auto --template xirang       当前息壤源码仓库
```

稳定入口为 `pnpm agent -- qa auto`，原样转发上述范围参数。`--plan` 只读输出代理协议。`qa automate` 仍只检查建设进度，`qa run` 仍只运行已登记业务套件。

## 当前代理执行协议

1. 完整加载基础规则。需要修改时创建/恢复 mutation task，明确验收并进入任务 linked worktree；当前任务不明且多候选时不猜选。不要把本次“测试整个项目”缩成仅测试当前diff。
2. 明确scope。裸命令读取当前task目标、胶囊、改动及调用关系；模块匹配模块规格与消费者；project发现所有应用/工作区及测试入口；template只在身份匹配的源执行，不在消费项目伪称已测试上游。跨目录先Discovery manifest，核对遗漏；不得把未覆盖范围默默排除。
3. 先依据规格建立/补齐QA规则、反例和PATHS（适用）。期望值只取AC、契约、数据字典、UX、命令协议；已有测试用于复用与覆盖分析。规格缺失或冲突时说明缺口，独立部分继续，依赖部分等待必要决策；不得按当前实现猜测预期。
4. 逐项登记unit、integration、e2e、contract、recovery层级。每层有具体用例/命令或具备依据的不适用理由；应用流程必须真实启动应用，验证状态与数据结果。另按风险补安全/性能/迁移测试。由TDD补单元、模块集成与契约，QA补黑盒/E2E；同一时刻只激活一位专家。
5. 生成测试代码并实际执行；保留已有用例。记录TEST_SCOPE_DECISION，长命令用task exec。`--project` 是所选项目全量测试的显式范围要求，记录explicit_requirement及具体测试类型；没有该范围要求时继续遵循最小充分回归规则。
6. 分析失败。实现错误回TDD；测试自身错误先查规格并由QA修订设计、登记amend后修改。补遗漏用例，不重新生成替换原测试。默认最多3轮修复（qa.auto.maxRepairs可设0–10）；每轮task checkpoint记录计数、根因、文件和日志。新调用接续同一未完成闭环时沿用已耗轮次，不重置预算。相同失败重复、环境/权限/规格阻塞不盲修，超时或中断先核实副作用，不自动重放。
7. 每轮重跑失败用例和受影响范围；收尾运行所选完整范围，不能只跑修复用例。禁止降低断言、改预期迎合实现、删除测试、减少断言、新增skip/only或模拟真实验收成功。
8. 依次tdd sync → tdd push → qa plan；对最终HEAD绑定TEST_SCOPE_RESULT日志摘要，适用时运行qa paths、qa run、qa repro、qa mutate，再qa verify。改变提交或配置后补跑受影响测试并刷新结果。qa verify成功签发回执才算QA完成；TESTS_PASSED仅为测试执行阶段结果。
9. 本命令不隐式执行qa merge或部署。测试过程中新增代码仍须满足仓库交付门禁；若上级任务已授权合并，按该任务继续qa merge与finish。真实平台写操作只在具体授权的账号、目标、内容和范围内运行；无人值守批量写不因测试命令而获授权。

最终报告范围、各层级生成/复用/执行情况、修复轮数、失败与未覆盖项、当前提交、日志及QA回执；未运行/人工验收不得记通过。

## 独立终端驱动

终端无法自行推理生成测试。项目可在稀疏agent.config.json登记可信driver（argv数组）；缺驱动返回STATUS=PENDING、MODE=AGENT、AUTO_CONTINUE=true，当前编码代理按上节继续，独立终端用户则配置驱动。不会偷偷调用其他模型或读取额外凭据。

```json
{
  "qa": {
    "auto": {
      "driver": ["node", "scripts/qa-agent-driver.cjs"],
      "maxRepairs": 3,
      "timeoutSeconds": 900,
      "targets": {
        "module:accounts": {
          "specs": ["docs/prd-modules/accounts/PRD.md"],
          "tests": [
            { "name": "accounts-unit", "layer": "unit", "command": ["node", "--test", "tests/accounts.test.js"] }
          ],
          "notApplicable": {
            "integration": "示例：纯函数模块，无协作依赖",
            "e2e": "示例：无应用界面",
            "contract": "示例：无对外接口",
            "recovery": "示例：无持久状态"
          }
        }
      }
    }
  }
}
```

这只是配置形状示例，不能将示例理由照搬到实际业务。scope键为task、project、module:<name>、template:<name>，必须精确匹配，不自动回退到project。测试command为argv，不经过shell；pnpm等Windows shim由共享工具链处理。specs须为worktree内非空文件。所有层级必须有测试或不适用理由，缺失即阻断。

```bash
pnpm agent -- qa auto --module accounts --task <id> --step <verify-first-step>
```

driver通过环境变量读取 `XIRANG_QA_AUTO_STAGE=generate|repair` 和 `XIRANG_QA_AUTO_CONTEXT` JSON（范围、轮次、规格文件、历史日志、约束）；自行使用项目已授权的编码代理能力。规格、权限或环境问题以非零退出，不吞错；测试命令用124–127表示环境/启动失败，普通断言失败用1。超时/中断记verify_required。

CLI在task evidence独占创建日志，每个命令前后checkpoint，记录退出码、SHA256、HEAD、scope和配置摘要；同worktree互斥。生成→全部套件→失败修复→全部重跑，达到上限停止。通过输出 `TEST_RESULT=TESTS_PASSED`、`STATUS=PENDING`，提示当前代理继续最终HEAD QA；不会伪造qa run结果或QA回执。无驱动时不创建任务、不写日志、不运行命令；代理开始生成前仍须完成task/worktree门禁。
