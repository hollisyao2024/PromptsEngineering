# 合约标准

公共 API/IPC 的类型由一个明确的 schema/源模型生成，提交生成物并在检查中校验漂移。记录版本、错误码、幂等约定和破坏性变更。前端通过 api-client/host port 调用；共享库不反向依赖应用。

contracts 模块给出 JSON Schema 到 TypeScript 的最小对象模型生成器与 --check，项目可以替换成 OpenAPI/Protobuf/语言导出器。生成器不宣称支持未知 schema 特性；复杂 schema 必须换用完整实现。真实鉴权、限流、超时与兼容性测试由实际服务实现。
