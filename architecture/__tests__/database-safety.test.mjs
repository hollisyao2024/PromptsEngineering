import test from 'node:test';
import assert from 'node:assert/strict';
import {postgresConfiguration} from '../stacks/data-access/drizzle/src/connection.mjs';
test('TC-DRIZZLE-002 PostgreSQL Kit public foreign keys require dedicated database isolation',()=>{
 assert.equal(postgresConfiguration('postgresql://localhost/private_database').schema,'public');
 assert.throws(()=>postgresConfiguration('postgresql://localhost/private_database?schema=another'),/dedicated PostgreSQL/);
});
