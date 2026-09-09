import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {startFixture} from '../fixtures/monorepo-platform.mjs';
const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'../..');
const {loadConfig,getMainRepoRoot,resolveContainerPath}=require('../../infra/scripts/shared/config.js');
const output=path.join(resolveContainerPath(loadConfig({repoRoot:repo}),getMainRepoRoot(repo),'tmp'),'test-results/monorepo-platform');mkdirSync(output,{recursive:true});
if(!process.env.XIRANG_TEST_TOOLS)throw new Error('Explicit XIRANG_TEST_TOOLS directory with @playwright/test required');
const {chromium,expect}=createRequire(path.join(process.env.XIRANG_TEST_TOOLS,'package.json'))('@playwright/test');
let fixture,browser;
before(async()=>{fixture=await startFixture();browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();await fixture?.close();});
class TasksPage {
  constructor(page){this.page=page;}
  async open(){await this.page.goto(fixture.webUrl);await this.page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await this.ready();}
  async ready(){await expect(this.page.getByRole('button',{name:'新增',exact:true})).toBeEnabled();}
  row(title){return this.page.getByRole('row').filter({has:this.page.getByRole('cell',{name:title,exact:true})});}
  async save(title){await this.page.getByLabel('任务标题',{exact:true}).fill(title);await this.page.getByRole('button',{name:'保存',exact:true}).click();await expect(this.page.getByRole('dialog')).toHaveCount(0);await this.ready();}
}
function journey(name,run){test(name,async()=>{
  await fixture.db.task.deleteMany();const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  try{await run(new TasksPage(page),page);}
  catch(error){await page.screenshot({path:path.join(output,name.replaceAll(/[^a-zA-Z0-9-]/g,'_')+'.png'),fullPage:true});throw error;}
  finally{await context.close();}
});}
journey('MONOPLAT-005-happy-crud-selection-export',async(ui,page)=>{
  await ui.open();await page.getByRole('button',{name:'新增',exact:true}).click();await ui.save('Created in browser');
  await expect(ui.row('Created in browser')).toBeVisible();assert.equal(await fixture.db.task.count(),1);
  await ui.row('Created in browser').getByRole('button',{name:/修改 /}).click();await ui.save('Edited in browser');
  assert.equal((await fixture.db.task.findFirst()).version,2);await ui.row('Edited in browser').getByRole('checkbox').click();
  await page.getByRole('combobox',{name:'导出范围'}).click();await page.getByRole('option',{name:'选中记录',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出所选',exact:true}).click();
  const csv=await (await download).path();assert.match(readFileSync(csv,'utf8'),/Edited in browser/);
  await page.getByRole('button',{name:'删除所选（1）',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(ui.row('Edited in browser')).toHaveCount(0);assert.equal(await fixture.db.task.count(),0);
});
journey('MONOPLAT-005-error-auth-retains-form-and-retries',async(ui,page)=>{
  await ui.open();await page.getByRole('button',{name:'新增',exact:true}).click();await page.getByLabel('任务标题',{exact:true}).fill('Retained input');
  const url=fixture.apiUrl+'/tasks';
  await page.route(url,async route=>{if(route.request().method()==='POST'){const headers=route.request().headers();delete headers.authorization;await route.continue({headers});}else await route.continue();});
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'请提供访问令牌'})).toBeVisible();
  await expect(page.getByLabel('任务标题',{exact:true})).toHaveValue('Retained input');assert.equal(await fixture.db.task.count(),0);
  await page.unroute(url);await ui.save('Retained input');await expect(ui.row('Retained input')).toBeVisible();assert.equal(await fixture.db.task.count(),1);
});
journey('MONOPLAT-004-boundary-auth-scope-and-late-query',async(ui,page)=>{
  await fixture.db.task.createMany({data:[{title:'alpha'},{title:'omega'}]});await ui.open();
  await page.getByLabel('访问令牌',{exact:true}).fill('incorrect');await expect(page.getByText('数据加载失败',{exact:true})).toBeVisible();await expect(ui.row('alpha')).toHaveCount(0);
  await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await ui.ready();await expect(ui.row('alpha')).toBeVisible();
  let release,started;const held=new Promise(resolve=>{release=resolve;}),oldStarted=new Promise(resolve=>{started=resolve;});
  await page.route(fixture.apiUrl+'/tasks?**',async route=>{if(new URL(route.request().url()).searchParams.get('search')==='alpha'){started();await held;}try{await route.continue();}catch{/* Cancelled old query. */}});
  await page.getByLabel('搜索表格').fill('alpha');await oldStarted;await page.getByLabel('搜索表格').fill('omega');await expect(ui.row('omega')).toBeVisible();release();
  await expect(ui.row('alpha')).toHaveCount(0);await expect(page.locator('tbody tr')).toHaveCount(1);
});
journey('MONOPLAT-005-boundary-page-sort-filter-and-empty',async(ui,page)=>{
  await fixture.db.task.createMany({data:Array.from({length:17},(_,i)=>({title:'Row '+String(i).padStart(2,'0'),status:i%2?'doing':'todo'}))});await ui.open();
  await page.getByRole('button',{name:'排序 标题',exact:true}).click();await ui.ready();await expect(page.locator('tbody tr').first()).toContainText('Row 00');
  await page.getByRole('button',{name:'下一页',exact:true}).click();await ui.ready();await expect(page.locator('tbody tr')).toHaveCount(7);await expect(page.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'筛选 状态'}).click();await page.getByRole('option',{name:'进行中',exact:true}).click();await ui.ready();await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.getByRole('button',{name:'显示列',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'版本',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('columnheader',{name:'版本',exact:true})).toHaveCount(0);
  await page.getByLabel('搜索表格').fill('no matches');await ui.ready();await expect(page.getByText('暂无数据',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();await ui.ready();await expect(page.locator('tbody tr')).toHaveCount(10);
});
journey('MONOPLAT-006-narrow-theme-navigation-and-keyboard',async(ui,page)=>{
  await page.setViewportSize({width:320,height:800});await ui.open();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const before=await page.locator('html').getAttribute('class');await page.getByRole('button',{name:'切换主题'}).click();await expect(page.locator('html')).not.toHaveAttribute('class',before);
  await page.getByRole('button',{name:'导航',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('应用导航');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'导航',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'新增',exact:true}).click();await expect(page.getByLabel('任务标题',{exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'新增',exact:true})).toBeFocused();
});
journey('MONOPLAT-006-wide-navigation-and-shared-theme',async(ui,page)=>{
  await fixture.db.task.create({data:{title:'Wide layout'}});await ui.open();
  await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();await expect(page.getByRole('button',{name:'导航',exact:true})).toBeHidden();
  await page.getByRole('link',{name:'任务管理',exact:true}).click();await expect(page).toHaveURL(/#tasks$/);await expect(ui.row('Wide layout')).toBeVisible();
  const before=await page.locator('html').getAttribute('class');await page.getByRole('button',{name:'切换主题'}).click();await expect(page.locator('html')).not.toHaveAttribute('class',before);assert.equal(await fixture.db.task.count(),1);
});
journey('MONOPLAT-006-error-state-recovers-after-api-restored',async(ui,page)=>{
  await fixture.db.task.create({data:{title:'Recovered after outage'}});await ui.open();
  const url=fixture.apiUrl+'/tasks?**';await page.route(url,route=>route.abort('connectionfailed'));await page.getByLabel('搜索表格').fill('Recovered');
  await expect(page.getByText('数据加载失败',{exact:true})).toBeVisible();await expect(ui.row('Recovered after outage')).toHaveCount(0);
  await page.unroute(url);await page.getByRole('button',{name:'重试',exact:true}).click();await ui.ready();await expect(ui.row('Recovered after outage')).toBeVisible();assert.equal(await fixture.db.task.count(),1);
});
journey('MONOPLAT-005-error-concurrent-edit-is-preserved',async(ui,page)=>{
  const task=await fixture.db.task.create({data:{title:'Concurrent'}});await ui.open();await ui.row('Concurrent').getByRole('button',{name:/修改 /}).click();
  await page.getByLabel('任务标题',{exact:true}).fill('My pending edit');await fixture.db.task.update({where:{id:task.id},data:{title:'Changed elsewhere',version:{increment:1}}});
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'记录已被修改'})).toBeVisible();await expect(page.getByLabel('任务标题',{exact:true})).toHaveValue('My pending edit');assert.equal((await fixture.db.task.findUnique({where:{id:task.id}})).title,'Changed elsewhere');
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await ui.ready();await expect(ui.row('Changed elsewhere')).toBeVisible();
});
test('MONOPLAT-004 local HTTP performance smoke',async()=>{
  await fixture.db.task.deleteMany();await fixture.db.task.createMany({data:Array.from({length:1000},(_,i)=>({title:'smoke-'+i}))});
  // Async spawn keeps the in-process HTTP server responsive.
  const {spawn}=await import('node:child_process');
  const child=spawn('k6',['run','--quiet','--summary-export',path.join(output,'k6.json'),path.join(repo,'perf/scenarios/monorepo-platform.k6.js')],{env:{...process.env,XIRANG_TEST_API:fixture.apiUrl,XIRANG_TEST_TOKEN:fixture.token},stdio:['ignore','pipe','pipe']});
  let text='';child.stdout.on('data',c=>{text+=c;});child.stderr.on('data',c=>{text+=c;});const result=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});assert.equal(result,0,text);
});
