import {createServer,type IncomingMessage} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {getDatabase,disconnectDatabase,type PrismaClient} from '@project/database-main';
import {assertContract,ContractError} from '@project/contracts';
import type {components} from '@project/contracts/types';
import {readServerConfig,type ServerConfig} from '@project/config';
import {createLogger,requestId} from '@project/observability';
import {taskService,queryFrom,ServiceError} from './tasks.ts';
let appRoot=dirname(fileURLToPath(import.meta.url));
while(!existsSync(join(appRoot,'package.json'))){const parent=dirname(appRoot);if(parent===appRoot)throw new Error('Application package root missing');appRoot=parent;}
const envFile=join(appRoot,'.env');if(existsSync(envFile))process.loadEnvFile(envFile);
const logger=createLogger();
async function body(req:IncomingMessage):Promise<unknown> {
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new ServiceError(400,'INVALID_CONTENT_TYPE','请使用 JSON 请求');
  return new Promise((resolve,reject)=>{
    let size=0,tooLarge=false;const chunks:Buffer[]=[];
    req.on('data',(chunk:Buffer)=>{
      if(tooLarge)return;
      size+=chunk.length;
      if(size>65536){tooLarge=true;chunks.length=0;reject(new ServiceError(413,'BODY_TOO_LARGE','请求过大'));return;}
      chunks.push(chunk);
    });
    req.once('error',reject);
    req.once('end',()=>{if(tooLarge)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new ServiceError(400,'INVALID_JSON','JSON 格式错误'));}});
  });
}
function authorize(req:IncomingMessage,config:ServerConfig) {
  if(!config.writeToken)throw new ServiceError(403,'WRITES_DISABLED','写入尚未配置');
  const supplied=req.headers.authorization;
  if(!supplied)throw new ServiceError(401,'UNAUTHORIZED','请提供访问令牌');
  const actual=Buffer.from(supplied),expected=Buffer.from('Bearer '+config.writeToken);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new ServiceError(403,'FORBIDDEN','没有操作权限');
}
export function createApp({db=getDatabase(),config=readServerConfig()}:{db?:PrismaClient;config?:ServerConfig}={}) {
  const service=taskService(db);
  const server=createServer(async(req,res)=>{
    const rid=requestId(req.headers['x-request-id']);res.setHeader('x-request-id',rid);res.setHeader('content-type','application/json;charset=utf-8');
    const send=(name:Parameters<typeof assertContract>[0],data:unknown)=>{try{assertContract(name,data);}catch{throw new ServiceError(500,'RESPONSE_CONTRACT','响应校验失败');}res.end(JSON.stringify(data));};
    const origin=req.headers.origin;
    try {
      if(origin){if(!config.corsOrigins.has(origin))throw new ServiceError(403,'ORIGIN_DENIED','来源不被允许');res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');}
      if(req.method==='OPTIONS'){res.setHeader('access-control-allow-methods','GET,POST,PATCH,DELETE,OPTIONS');res.setHeader('access-control-allow-headers','content-type,authorization,x-request-id');res.statusCode=204;res.end();return;}
      const url=new URL(req.url||'/','http://localhost');
      if(req.method==='GET'&&url.pathname==='/health'){res.end(JSON.stringify({status:'ok'}));return;}
      if(config.profile==='production'&&url.pathname.startsWith('/tasks'))authorize(req,config);
      if(url.pathname==='/tasks'&&req.method==='GET'){send('TaskList',await service.list(queryFrom(url.searchParams)));return;}
      if(url.pathname==='/tasks/export'&&req.method==='GET'){authorize(req,config);send('Export',await service.export(queryFrom(url.searchParams),url.searchParams.get('scope')||'',(url.searchParams.get('ids')||'').split(',').filter(Boolean)));return;}
      if(url.pathname==='/tasks'&&req.method==='POST'){authorize(req,config);const input=await body(req);assertContract('CreateTask',input);send('Task',await service.create(input as components['schemas']['CreateTask']));return;}
      if(url.pathname==='/tasks'&&req.method==='DELETE'){authorize(req,config);const input=await body(req);assertContract('DeleteTasks',input);send('Deleted',await service.remove((input as components['schemas']['DeleteTasks']).ids));return;}
      const match=url.pathname.match(/^\/tasks\/([0-9a-f-]{36})$/);
      if(match&&req.method==='PATCH'){authorize(req,config);assertContract('DeleteTasks',{ids:[match[1]]});const input=await body(req);assertContract('UpdateTask',input);send('Task',await service.update(match[1],input as components['schemas']['UpdateTask']));return;}
      throw new ServiceError(404,'NOT_FOUND','接口不存在');
    } catch(error) {
      const status=error instanceof ServiceError?error.status:error instanceof ContractError?400:500;
      const code=error instanceof ServiceError?error.code:error instanceof ContractError?'INVALID_INPUT':'INTERNAL_ERROR';
      const message=error instanceof ServiceError?error.message:error instanceof ContractError?'请求不符合接口规范':'服务暂时不可用';
      logger.emit('request.failed',{requestId:rid,status,code},status>=500?'error':'warn');
      if(!res.headersSent){res.statusCode=status;res.end(JSON.stringify({code,message,requestId:rid}));}else res.destroy();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const config=readServerConfig(),server=createApp({config});server.listen(config.port,config.host,()=>logger.emit('server.ready',{port:config.port,host:config.host}));
  const stop=()=>server.close(()=>{void disconnectDatabase().finally(()=>process.exit(0));});process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
