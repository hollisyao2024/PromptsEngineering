# 可观测性标准

统一事件包含时间、事件名、级别、应用/环境和关联 ID；错误具有稳定分类。写入 sink 前脱敏，不能记录密码、token、Authorization、Cookie 或完整个人数据。sink、采样、保留时间、告警阈值由项目声明；默认模块不发送网络请求。

observability 模块提供 JSON 事件、递归脱敏、采样和可注入 sink，可替换为项目日志/遥测实现。不得把自定义事件模型宣称为完整 OpenTelemetry 实现。
