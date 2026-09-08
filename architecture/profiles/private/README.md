# Private 交付 Profile

在 profile.json 中填写 edition/environment、应用和非空 denyPatterns。
构建后运行 `node scan.mjs <产物目录>`；空目录或未定义禁用地址策略会阻断。
当前生成物是项目可编辑的部署起点，不能把一次扫描等同于全部供应链安全验证。

发布使用 `node release.mjs <release-dir> <current-link> <health-url>`。三个参数都必须显式提供。
脚本只接受 current-link 是符号链接或不存在，release-dir 必须为真实目录且与 current-link 位于同一父目录下。
切换受独占发布锁保护并轮询健康检查；失败时只有链接仍指向本次版本才恢复旧链接并非零退出。外部已切换链接时保留现场并阻断回退；遗留发布锁需核对 PID 和链接后恢复。应用服务重载应由项目在健康检查链路中配置，数据库迁移另行执行。
