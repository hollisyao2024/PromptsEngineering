#!/usr/bin/env node
/**
 * 自定义架构漂移检测脚本
 *
 * 目的: 解决 Prisma migrate diff 对 @map 指令的误报问题
 * 方法: 使用 prisma db pull 生成临时 schema,然后对比关键差异
 *
 * 使用:
 *   node check-schema-drift.js [--env production|staging|dev]
 *
 * 退出码:
 *   0 - 无架构漂移
 *   1 - 检测到架构漂移
 *   2 - 检测失败(脚本错误)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const targetEnv = envIndex >= 0 && args[envIndex + 1] ? args[envIndex + 1] : 'dev';

// 配置（本地 monorepo 和远端部署使用相同的目录结构）
// 脚本位置: infra/scripts/server/check-schema-drift.js
// 相对路径: ../../../apps/web, ../../../packages/database
const FRONTEND_DIR = path.join(__dirname, '../../../apps/web');
const DATABASE_DIR = path.join(__dirname, '../../../packages/database');
const ORIGINAL_SCHEMA = path.join(DATABASE_DIR, 'prisma/schema.prisma');
const TEMP_SCHEMA = path.join(DATABASE_DIR, 'prisma/schema.pulled.prisma');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 执行命令并返回输出
 */
function runCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      cwd: FRONTEND_DIR,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || error.stderr || error.message,
      error
    };
  }
}

/**
 * 解析 Prisma schema 文件,提取模型定义
 */
function parseSchema(schemaPath) {
  const content = fs.readFileSync(schemaPath, 'utf8');
  const models = {};

  // 逐行解析,正确处理嵌套的大括号
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // 检测 model 定义开始
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      const modelName = modelMatch[1];
      i++;

      // 提取模型体(处理嵌套大括号)
      const modelLines = [];
      let braceDepth = 1;
      let inString = false;
      let escapeNext = false;

      while (i < lines.length && braceDepth > 0) {
        const currentLine = lines[i];
        modelLines.push(currentLine);

        // 逐字符检查大括号深度
        for (let j = 0; j < currentLine.length; j++) {
          const char = currentLine[j];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') braceDepth++;
            if (char === '}') braceDepth--;
          }
        }

        i++;
      }

      // 解析模型体
      const fields = {};
      let dbTableName = modelName; // 默认使用模型名作为表名

      for (const modelLine of modelLines) {
        const trimmed = modelLine.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed === '}') {
          continue;
        }

        // 检查 @@map 指令获取数据库表名
        const mapMatch = trimmed.match(/@@map\("([^"]+)"\)/);
        if (mapMatch) {
          dbTableName = mapMatch[1];
          continue;
        }

        // 跳过其他 @@ 指令
        if (trimmed.startsWith('@@')) {
          continue;
        }

        // 跳过显式关系字段（有 @relation 指令）
        if (trimmed.includes('@relation')) {
          continue;
        }

        // 匹配字段定义: fieldName Type? @map("db_name")
        const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?([\?\!])?(?:.*@map\("([^"]+)"\))?/);
        if (fieldMatch) {
          const [, fieldName, fieldType, isArray, modifier, dbName] = fieldMatch;

          // 跳过关系字段：只保留 Prisma 标量类型
          // 标量类型: String, Int, BigInt, Float, Decimal, Boolean, DateTime, Json, Bytes, Unsupported
          const scalarTypes = ['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported'];
          const isScalarType = scalarTypes.includes(fieldType);

          // 如果不是标量类型且不是数组，跳过（这是关系字段）
          if (!isScalarType && !isArray) {
            continue;
          }

          // 如果是数组，检查元素类型是否为标量类型（非标量数组是关系字段）
          if (isArray && !isScalarType) {
            continue;
          }

          const actualDbName = dbName || fieldName;

          fields[actualDbName] = {
            fieldName,
            type: fieldType + (isArray || '') + (modifier || ''),
            dbName: actualDbName,
            isArray: !!isArray,
            isOptional: modifier === '?',
            isRequired: modifier === '!',
          };
        }
      }

      // 使用数据库表名作为 key
      models[dbTableName] = { name: modelName, dbTableName, fields };
    } else {
      i++;
    }
  }

  return models;
}

/**
 * 对比两个 schema 的差异
 */
function compareSchemas(originalModels, pulledModels) {
  const differences = [];

  // 检查每个原始模型 (key 是数据库表名)
  for (const [dbTableName, originalModel] of Object.entries(originalModels)) {
    const pulledModel = pulledModels[dbTableName];

    if (!pulledModel) {
      differences.push({
        type: 'MODEL_MISSING',
        model: originalModel.name,
        dbTable: dbTableName,
        message: `模型 ${originalModel.name} (表: ${dbTableName}) 在数据库中不存在`,
      });
      continue;
    }

    // 检查字段差异
    for (const [dbName, originalField] of Object.entries(originalModel.fields)) {
      const pulledField = pulledModel.fields[dbName];

      if (!pulledField) {
        differences.push({
          type: 'FIELD_MISSING',
          model: originalModel.name,
          dbTable: dbTableName,
          field: dbName,
          message: `字段 ${originalModel.name}.${originalField.fieldName} (列: ${dbName}) 在数据库中不存在`,
          expected: originalField,
        });
        continue;
      }

      // 检查类型差异(忽略大小写,因为 Prisma 可能会规范化类型名)
      if (originalField.type.toLowerCase() !== pulledField.type.toLowerCase()) {
        differences.push({
          type: 'FIELD_TYPE_MISMATCH',
          model: originalModel.name,
          dbTable: dbTableName,
          field: dbName,
          message: `字段 ${originalModel.name}.${originalField.fieldName} (列: ${dbName}) 类型不匹配`,
          expected: originalField.type,
          actual: pulledField.type,
        });
      }
    }

    // 检查数据库中是否有额外字段
    for (const [dbName, pulledField] of Object.entries(pulledModel.fields)) {
      if (!originalModel.fields[dbName]) {
        differences.push({
          type: 'FIELD_EXTRA',
          model: originalModel.name,
          dbTable: dbTableName,
          field: dbName,
          message: `数据库表 ${dbTableName} 中存在额外列 ${dbName}`,
          actual: pulledField,
        });
      }
    }
  }

  // 检查数据库中是否有额外表 (key 是数据库表名)
  for (const [dbTableName, pulledModel] of Object.entries(pulledModels)) {
    if (!originalModels[dbTableName]) {
      differences.push({
        type: 'MODEL_EXTRA',
        model: pulledModel.name,
        dbTable: dbTableName,
        message: `数据库中存在额外表 ${dbTableName} (模型: ${pulledModel.name})`,
      });
    }
  }

  return differences;
}

/**
 * 主函数
 */
async function main() {
  log('\n=== Prisma 架构漂移检测 (自定义实现) ===\n', 'blue');
  log(`目标环境: ${targetEnv}`, 'blue');
  log(`Schema 路径: ${ORIGINAL_SCHEMA}`, 'blue');

  // 步骤 1: 从数据库拉取当前 schema
  log('\n[1/3] 从数据库拉取 schema...', 'yellow');

  // 先复制原始 schema 到临时位置(db pull 需要一个基础 schema 文件)
  fs.copyFileSync(ORIGINAL_SCHEMA, TEMP_SCHEMA);
  log('已复制 schema.prisma 到临时位置', 'blue');

  const pullResult = runCommand(
    `npx prisma db pull --schema=${TEMP_SCHEMA} --force`,
    { silent: false }
  );

  if (!pullResult.success) {
    log('\n[ERROR] 无法从数据库拉取 schema', 'red');
    log(pullResult.output, 'red');

    // 清理临时文件
    if (fs.existsSync(TEMP_SCHEMA)) {
      fs.unlinkSync(TEMP_SCHEMA);
    }

    process.exit(2);
  }

  // 检查临时文件是否生成
  if (!fs.existsSync(TEMP_SCHEMA)) {
    log('\n[ERROR] db pull 未生成临时 schema 文件', 'red');
    process.exit(2);
  }

  log('[SUCCESS] Schema 拉取完成', 'green');

  // 步骤 2: 解析并对比 schema
  log('\n[2/3] 解析并对比 schema...', 'yellow');

  try {
    const originalModels = parseSchema(ORIGINAL_SCHEMA);
    const pulledModels = parseSchema(TEMP_SCHEMA);

    log(`原始 schema: ${Object.keys(originalModels).length} 个模型`, 'blue');
    log(`数据库 schema: ${Object.keys(pulledModels).length} 个模型`, 'blue');

    const differences = compareSchemas(originalModels, pulledModels);

    // 步骤 3: 报告结果
    log('\n[3/3] 漂移检测结果:', 'yellow');

    if (differences.length === 0) {
      log('\n✅ 未检测到架构漂移', 'green');
      log('数据库 schema 与 schema.prisma 完全匹配\n', 'green');

      // 清理临时文件
      fs.unlinkSync(TEMP_SCHEMA);
      process.exit(0);
    } else {
      log(`\n⚠️  检测到 ${differences.length} 个架构差异:\n`, 'red');

      for (const diff of differences) {
        log(`[${diff.type}] ${diff.message}`, 'red');
        if (diff.expected) {
          log(`  期望: ${JSON.stringify(diff.expected)}`, 'yellow');
        }
        if (diff.actual) {
          log(`  实际: ${JSON.stringify(diff.actual)}`, 'yellow');
        }
        log('');
      }

      if (targetEnv === 'production') {
        log('❌ 生产环境不允许架构漂移!', 'red');
        log('请先在开发/预发环境执行 prisma migrate 修复问题\n', 'red');

        // 清理临时文件
        fs.unlinkSync(TEMP_SCHEMA);
        process.exit(1);
      } else {
        log('ℹ️  请在开发环境创建新的迁移来修复架构漂移\n', 'yellow');

        // 清理临时文件
        fs.unlinkSync(TEMP_SCHEMA);
        process.exit(1);
      }
    }
  } catch (error) {
    log('\n[ERROR] Schema 解析失败', 'red');
    log(error.message, 'red');
    console.error(error.stack);

    // 清理临时文件
    if (fs.existsSync(TEMP_SCHEMA)) {
      fs.unlinkSync(TEMP_SCHEMA);
    }

    process.exit(2);
  }
}

// 运行
main().catch(error => {
  log('\n[ERROR] 脚本执行失败', 'red');
  log(error.message, 'red');
  console.error(error.stack);

  // 清理临时文件
  if (fs.existsSync(TEMP_SCHEMA)) {
    fs.unlinkSync(TEMP_SCHEMA);
  }

  process.exit(2);
});
