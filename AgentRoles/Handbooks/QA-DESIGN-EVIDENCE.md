# 人工证据与历史复核回执

本协议依据用户授权的 QA 门禁修复验收 AC2。回执只证明具名复核声明及证据完整性；证据是否支持结论仍须 QA 审查。

| 合同 | 可观察验收 |
| --- | --- |
| E1 | `qa design attest --kind manual --id <RUL/ADV> --outcome passed/failed/skipped --reviewer <人> --environment <环境> --reason <结论> --evidence <文件>` 只登记人工规则或仅关联人工规则的反例。每行单独证明，不替代自动用例或其他反例。 |
| E2 | `qa design pending` 只读列出待评审记录及精确 `change` 摘要。`attest --kind review --id <行> --change <摘要>` 加上 E1 的证据参数，为该记录追加复核回执；只有 passed 解除该记录的待评审风险。原表行不得改写。 |
| E3 | 登记必须在干净工作区；回执绑定完整 HEAD、工作目录、规格材料包与设计配置摘要，复制非空普通证据文件并保存 SHA-256。回执与证据放容器 tmp，不写业务规格。 |
| E4 | 回执只追加。按登记序号取最新结论，failed/skipped 不得回退旧 passed。缺失、过期、损坏、未知结构、证据篡改、路径逃逸或链接均不能通过。读写失败明确拒绝。 |
| E5 | 无回执保留既有风险；有效人工 passed 可计入 RULES_VERIFIED，独立人工反例 passed 可计入覆盖。出处、优先级、未定义行为、缺陷、设计时序及自动 TC 门禁保持。 |

```text
pnpm agent -- qa design pending
pnpm agent -- qa design attest --kind manual --id RUL-DEMO-001 --outcome skipped --reviewer reviewer --environment macOS --reason 未执行真实Windows验收 --evidence /absolute/evidence.txt
pnpm agent -- qa design attest --kind review --id RUL-DEMO-001 --change <pending输出摘要> --outcome passed --reviewer reviewer --environment macOS --reason 已核对规格及变更依据 --evidence /absolute/review.txt
```

最终提交之后登记。新提交、规格或配置变化后重新验收。跳过是未验证，不是通过。
