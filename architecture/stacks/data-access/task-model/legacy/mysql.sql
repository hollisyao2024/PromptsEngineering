CREATE TABLE `Task` (`id` VARCHAR(191) NOT NULL PRIMARY KEY,`title` VARCHAR(255) NOT NULL,`status` VARCHAR(191) NOT NULL DEFAULT 'todo',`version` INTEGER NOT NULL DEFAULT 1,`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),`updatedAt` DATETIME(3) NOT NULL);
CREATE INDEX `Task_createdAt_id_idx` ON `Task`(`createdAt`,`id`);
CREATE INDEX `Task_status_idx` ON `Task`(`status`);
