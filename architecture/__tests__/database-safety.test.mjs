import test from 'node:test';
import assert from 'node:assert/strict';
import {mssqlConfig} from '../stacks/data-access/prisma-sqlserver/mssql-config.ts';
import {postgresConfiguration} from '../stacks/data-access/drizzle/src/connection.mjs';
test('TC-DRIZZLE-001 SQL Server URL parses escaped values and refuses implicit/ambiguous targets',()=>{
 const c=mssqlConfig('sqlserver://127.0.0.1:1433;database=xirang_test_offline;user=sa;password={x;y}}z};trustServerCertificate=true');
 assert.equal(c.database,'xirang_test_offline');assert.equal(c.password,'x;y}z');assert.equal(c.options.encrypt,true);assert.equal(c.options.trustServerCertificate,true);
 for(const url of ['sqlserver://localhost;user=sa','sqlserver://localhost;database=a;database=b','sqlserver://localhost;database=a;schema=other','sqlserver://localhost;database=a;encrypt=invalid','sqlserver://localhost;database=a;integratedSecurity=true','sqlserver://localhost;database=a;user=a;username=b'])assert.throws(()=>mssqlConfig(url));
});
test('TC-DRIZZLE-002 PostgreSQL Kit public foreign keys require dedicated database isolation',()=>{
 assert.equal(postgresConfiguration('postgresql://localhost/private_database').schema,'public');
 assert.throws(()=>postgresConfiguration('postgresql://localhost/private_database?schema=another'),/dedicated PostgreSQL/);
});
