# 数据字典条目模板

## 实体名称（中文/英文）
**描述**：简述该实体核心业务角色及数据边界。
**表名 / 模型名**：`xxx`
**关联模块/服务**：
**删除策略**：软删除（`deleted_at`）/ 豁免（原因、保留与清理规则）

### 字段表
字段首列必须为数据库列名（snake_case），`tdd sync` 据此检查新增表与字段是否已登记。

| 字段 | 类型 | 必填 | 默认值 | 说明 | 约束 / 索引 |
|------|------|------|--------|------|-------------|
| id | UUID | 是 |  | 主键 | PK |
| field_name | String | 否 | `""` | 业务字段说明（含单位、来源） | INDEX |
| status | String | 是 | `pending_payment` | 状态，取值见下方枚举 | CHECK |
| created_at | Timestamp | 是 | 当前时间 | 创建时间 | INDEX |
| updated_at | Timestamp | 是 | 当前时间 | 最后修改时间 | INDEX |
| created_by | String | 是 |  | 创建人主体标识或 `system:<job>` |  |
| updated_by | String | 是 |  | 最后修改人主体标识 |  |
| deleted_at | Timestamp | 否 |  | 软删除时间，空表示未删除 | 部分索引条件 |
| deleted_by | String | 否 |  | 删除人主体标识 |  |

### 枚举取值
| 字段 | 值 | 含义 |
|------|----|------|
| status | `pending_payment` | 待支付 |
| status | `shipped` | 已发货 |

### 额外属性
- **主/外键及关系**：描述与其他实体的引用（如 `user_id -> User.user_id`）。
- **一致性/事务边界**：同步/异步写入、读写分离、最终一致性等。
- **容量与保留策略**：预测数据量、保留周期、清理规则。
- **安全与脱敏需求**：是否属于敏感字段、需要脱敏/审计。
- **缓存策略（如有）**：缓存层、过期策略、命中率假设。

### 同步校验清单
- 表名、字段名是否为业务语言 snake_case，且每个字段都有注释（PostgreSQL/MySQL 已写入迁移）？
- 是否包含六个审计字段与软删除，或已注明豁免原因？
- 状态是否为字符串枚举或已列出全部整数取值？
- 是否已生成新迁移并通过迁移执行器修改数据库，未改动已发布迁移？
- 字段调整是否同步更新 `/docs/data/ERD.md` 与 `/docs/ARCH.md`（“数据视图”节）？
- 是否在 `/docs/data/traceability-matrix.md` 中存在对应 Story / Test Case 标记？
- 是否评估过 ADR（如新建敏感字段需新增 `arch` ADR）？
- 是否通知相关 TEAM（TDD/QA）进行验证？

### 版本记录
- `v1` 初始模板
