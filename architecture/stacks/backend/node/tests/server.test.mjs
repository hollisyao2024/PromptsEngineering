import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../{{sourceDir}}/server.mjs';
test('health and unknown routes', async t => {
 const server=createApp().listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>server.close());
 const root=`http://127.0.0.1:${server.address().port}`;
 assert.deepEqual(await (await fetch(root+'/health')).json(),{status:'ok'});
 assert.equal((await fetch(root+'/missing')).status,404);
});
