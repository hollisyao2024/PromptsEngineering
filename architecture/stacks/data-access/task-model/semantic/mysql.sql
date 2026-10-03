-- 任务示例表：示范数据语义约定（业务命名、全量注释、审计字段、软删除、字符串状态）
CREATE TABLE `task` (
  `id` VARCHAR(191) NOT NULL PRIMARY KEY COMMENT '任务 ID（UUID）',
  `title` VARCHAR(255) NOT NULL COMMENT '任务标题',
  `status` VARCHAR(191) NOT NULL DEFAULT 'todo' COMMENT '任务状态：todo=待处理 doing=进行中 done=已完成',
  `version` INTEGER NOT NULL DEFAULT 1 COMMENT '乐观锁版本号，每次更新加 1',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '最后修改时间',
  `created_by` VARCHAR(191) NOT NULL DEFAULT 'system' COMMENT '创建人标识，无登录主体时为 system',
  `updated_by` VARCHAR(191) NOT NULL DEFAULT 'system' COMMENT '最后修改人标识，无登录主体时为 system',
  `deleted_at` DATETIME(3) NULL COMMENT '软删除时间，为空表示未删除',
  `deleted_by` VARCHAR(191) NULL COMMENT '软删除操作人标识',
  CONSTRAINT `task_status_check` CHECK (`status` IN ('todo', 'doing', 'done'))
) COMMENT='任务：示例业务表，删除为软删除';
CREATE INDEX `task_created_at_id_idx` ON `task`(`created_at`,`id`);
CREATE INDEX `task_status_updated_at_idx` ON `task`(`status`,`updated_at`);
