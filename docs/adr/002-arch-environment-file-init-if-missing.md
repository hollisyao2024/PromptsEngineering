# ADR-002：环境文件只做首次初始化

- 状态：Accepted
- 日期：2026-08-24
- 关联：US-ENVINIT-001~003

## 背景

目标项目需要本地、staging、production 三组 example/实际环境文件。模板必须帮助首次建立文件骨架，但实际文件可能保存秘密，example 也会在初始化后由项目扩展。

## 决策

三个 example 文件由模板 manifest 以 `init-if-missing` 创建；三个实际文件在 example apply 完成后，由初始化器按固定映射从目标项目对应 example 独占创建。任一目标文件已存在时返回 unchanged，不追加、不覆盖、不迁移内容。三个 example 文件允许 Git 跟踪，三个实际文件由模板 `.gitignore` 精确忽略。

## 被拒绝方案

- 六个文件都作为模板 source 复制：实际文件不能进入 Git，因此新 clone 无可靠 source，且容易传播秘密。
- 每次同步 example 到实际文件：会覆盖目标项目凭据和环境差异。
- 创建六个纯空文件：无法提供变量契约，且可能让使用者误以为配置完成。
- 继续向已有 `.env.local` 追加 `GH_TOKEN`：违反用户确认的“后续不管理”边界。

## 后果

- 正向：首次初始化完整、后续幂等、目标项目内容安全、Git 边界明确。
- 代价：example 更新不会自动传播，项目需自行维护。
- 风险控制：目标 example 缺失时 fail closed；实际文件使用独占创建；测试验证 sentinel 内容逐字节不变。
