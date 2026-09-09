import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync,existsSync,mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),{loadConfig,getMainRepoRoot,resolveContainerPath}=require('../../infra/scripts/shared/config.js');
const output=path.join(resolveContainerPath(loadConfig({repoRoot:repo}),getMainRepoRoot(repo),'tmp'),'test-results/open-source-components');mkdirSync(output,{recursive:true});
const target=process.env.XIRANG_CONSUMER,tools=process.env.XIRANG_TEST_TOOLS;
if(!target||!tools)throw Error('Disposable consumer and test tools required');
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'))),store=config.datastores.find(d=>d.access==='prisma');
if(store.engine!=='sqlite'||!config.applications.some(a=>a.id==='admin'&&a.stack==='react-vite'&&a.path==='apps/admin'))throw Error('Browser fixture requires a disposable admin-api SQLite consumer');
const appRoot=path.join(target,'apps/admin');
const writeFixture=(name,content)=>{const file=path.join(appRoot,name);if(existsSync(file)&&!readFileSync(file,'utf8').includes('Xirang disposable QA fixture'))throw Error('Refusing to replace a project file: '+name);writeFileSync(file,content);};
writeFixture('src/qa-advanced.tsx',readFileSync(path.join(repo,'e2e/fixtures/open-source-advanced.tsx'),'utf8'));
writeFixture('qa.html','<!-- Xirang disposable QA fixture --><!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/qa-advanced.tsx"></script></body></html>');
writeFixture('qa.vite.config.ts',"// Xirang disposable QA fixture\nimport config from './vite.config';\nexport default {...config,build:{outDir:'dist-qa',rollupOptions:{input:'qa.html'}}};\n");
const build=spawnSync('pnpm',['exec','vite','build','--config','qa.vite.config.ts'],{cwd:appRoot,encoding:'utf8',timeout:60000});writeFileSync(path.join(output,'build.log'),build.stdout+build.stderr);assert.equal(build.status,0,build.stderr);
const url='file:'+path.join(target,'qa-components.sqlite'),dbRoot=path.join(target,store.path);
const migrate=spawnSync(process.execPath,['migrate.mjs','deploy'],{cwd:dbRoot,env:{...process.env,DATABASE_URL:url,['DATABASE_'+store.id.toUpperCase()+'_URL']:url},encoding:'utf8',timeout:60000});assert.equal(migrate.status,0,migrate.stderr);
const load=p=>import(pathToFileURL(path.join(target,p))),modulePath=id=>config.modules.find(m=>m.id===id).path;
const {createDatabase}=await load(store.path+'/dist/index.js'),db=createDatabase(url),{createAuth,toNodeHandler,fromNodeHeaders}=await load(modulePath('auth')+'/dist/index.js');
const {FileService,StorageRouter,createLocalProvider,createPrismaFileRepository,createFileHandler}=await load(config.fileStorage.path+'/dist/index.js');
const objects=mkdtempSync(path.join(target,'browser-objects-')),provider=await createLocalProvider({directory:objects}),repository=createPrismaFileRepository(db.fileObject),service=new FileService({router:new StorageRouter({files:provider},'files'),repository});
const dist=path.join(target,'apps/admin/dist-qa');let authHandler,fileHandler,browser;
const server=createServer(async(req,res)=>{try{
 if(req.url?.startsWith('/api/auth/')){await authHandler(req,res);return;}
 if(await fileHandler(req,res))return;
 const url=new URL(req.url||'/','http://localhost'),p=path.resolve(dist,'.'+decodeURIComponent(url.pathname));if(!p.startsWith(dist+path.sep)||!existsSync(p)){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');res.end(readFileSync(p));
}catch{if(!res.headersSent)res.writeHead(500);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const auth=createAuth({database:db,secret:randomBytes(32).toString('hex'),baseURL:origin,trustedOrigins:[origin],allowSignUp:true});authHandler=toNodeHandler(auth);
fileHandler=createFileHandler({service,trustedOrigins:[origin],authenticate:async req=>{const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});return session?{id:session.user.id}:undefined;}});
const email='browser-'+randomUUID()+'@example.invalid',password=randomBytes(20).toString('hex');
const signup=await auth.handler(new Request(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password,name:'Browser Fixture'})}));assert.equal(signup.status,200);const user=(await signup.json()).user;
const cookie=signup.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),org=await auth.handler(new Request(origin+'/api/auth/organization/create',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify({name:'Browser Team',slug:'browser-'+randomUUID()})}));assert.equal(org.status,200);
const {chromium,expect}=createRequire(path.join(tools,'package.json'))('@playwright/test');let page;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/qa.html');
 await page.getByLabel('登录邮箱').fill(email);await page.getByLabel('登录密码').fill('wrong-password');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'操作失败'})).toBeVisible();await expect(page.getByLabel('登录密码')).toHaveValue('');
 await page.getByLabel('登录密码').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByText('当前用户：Browser Fixture')).toBeVisible();await page.getByRole('combobox',{name:'当前组织'}).click();await page.getByRole('option',{name:'Browser Team'}).click();await expect(page.getByRole('combobox',{name:'当前组织'})).toContainText('Browser Team');
 await page.getByLabel('选择上传文件').setInputFiles({name:'too-large.txt',mimeType:'text/plain',buffer:Buffer.alloc(40)});await expect(page.getByRole('region',{name:'文件上传'}).getByRole('alert')).toBeVisible();assert.equal(await db.fileObject.count({where:{ownerId:user.id}}),0);
 await page.getByLabel('选择上传文件').setInputFiles({name:'wrong.png',mimeType:'image/png',buffer:Buffer.from('png')});await expect(page.getByRole('region',{name:'文件上传'}).getByRole('alert')).toBeVisible();assert.equal(await db.fileObject.count({where:{ownerId:user.id}}),0);
 await page.getByLabel('选择上传文件').setInputFiles({name:'browser.txt',mimeType:'text/plain',buffer:Buffer.from('browser roundtrip')});await page.getByRole('button',{name:'上传文件',exact:true}).click();await expect(page.getByText('已完成',{exact:true})).toBeVisible();const id=await page.getByLabel('已上传文件').textContent();assert.equal((await repository.get(id)).ownerId,user.id);assert.equal((await service.info(user.id,id)).state,'ready');
 const download=await service.download(user.id,id);const chunks=[];for await(const c of download.body)chunks.push(c);assert.equal(Buffer.concat(chunks).toString(),'browser roundtrip');
 await page.getByRole('textbox',{name:'正文',exact:true}).fill('Edited in Chrome');await expect(page.getByLabel('正文 JSON')).toContainText('Edited in Chrome');await page.getByRole('button',{name:'下移 alpha'}).click();await expect(page.getByLabel('排序结果')).toHaveText('beta,alpha');await page.getByRole('button',{name:'适应画布'}).click();await expect(page.getByText('周一：12')).toBeAttached();
 assert.ok(await page.getByRole('row').count()<100);await page.getByRole('textbox',{name:'搜索表格'}).fill('Row 999');await expect(page.getByRole('cell',{name:'Row 999',exact:true})).toBeVisible();await page.getByRole('button',{name:'导出筛选结果'}).click();await expect(page.getByLabel('导出数量')).toHaveText('1');
 await page.getByRole('button',{name:'重试任务'}).click();await expect(page.getByLabel('导出数量')).toHaveText('retry requested');const cookies=(await page.context().cookies(origin)).map(c=>c.name+'='+c.value).join('; ');const perf=spawn('k6',['run','--quiet','--summary-export',path.join(output,'k6.json'),path.join(repo,'perf/scenarios/open-source-components.k6.js')],{env:{...process.env,XIRANG_TEST_API:origin,XIRANG_TEST_COOKIE:cookies},stdio:['ignore','pipe','pipe']});let perfText='';perf.stdout.on('data',c=>perfText+=c);perf.stderr.on('data',c=>perfText+=c);const perfStatus=await new Promise((resolve,reject)=>{perf.on('exit',resolve);perf.on('error',reject);});writeFileSync(path.join(output,'k6.log'),perfText);assert.equal(perfStatus,0,'Local authenticated file list smoke failed');
 await page.getByRole('textbox',{name:'搜索表格'}).fill('no matching row');await expect(page.getByText('暂无数据',{exact:true})).toBeVisible();await page.getByRole('button',{name:'清除筛选'}).click();await expect(page.getByText(/共 1000 条/)).toBeVisible();
 await page.setViewportSize({width:360,height:800});await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByLabel('登录密码')).toHaveValue('');assert.equal((await page.request.get(origin+'/files/'+id)).status(),403);assert.deepEqual(errors,[]);
 await service.delete(user.id,id);writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'PASS',paths:['auth success/error-retry/organization/logout','upload bounds/type/real persistence','editor/sort/chart/flow/job-status','virtual table/filter/export/empty recovery'],browser:'Chrome',viewport:[1280,360]}));console.log('BROWSER_COMPONENTS=PASS; real Better Auth login/retry/organization/logout, Uppy->HTTP->Prisma/files, editor, sort, chart, flow, virtual-table, job status');
}catch(error){if(page)await page.screenshot({path:path.join(output,'browser-components-failure.png'),fullPage:true});throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await db.$disconnect();rmSync(objects,{recursive:true,force:true});}
