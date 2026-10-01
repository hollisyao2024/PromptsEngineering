BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Task] (
    [id] NVARCHAR(255) NOT NULL,
    [title] NVARCHAR(255) NOT NULL,
    [status] NVARCHAR(255) NOT NULL CONSTRAINT [Task_status_df] DEFAULT 'todo',
    [version] INT NOT NULL CONSTRAINT [Task_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Task_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Task_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Task_createdAt_id_idx] ON [dbo].[Task]([createdAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Task_status_idx] ON [dbo].[Task]([status]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

