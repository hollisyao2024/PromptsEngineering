import type {IncomingMessage,ServerResponse} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import {StorageError,sdkError,pageLimit} from './contracts.ts';
import {FileService} from './service.ts';
export interface FileHTTPOptions {service:FileService;authenticate:(request:IncomingMessage)=>Promise<{id:string}|undefined>;basePath?:string;trustedOrigins?:readonly string[];allowCredentials?:boolean}
export function createFileHandler(options:FileHTTPOptions){
  const base=options.basePath||'/files';if(!/^\/[a-z0-9/-]+$/.test(base)||base.endsWith('/'))throw new StorageError('CONFIGURATION');
  return async function handle(request:IncomingMessage,response:ServerResponse):Promise<boolean>{
    const url=new URL(request.url||'/','http://localhost');if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return false;
    const requestId=randomUUID();response.setHeader('x-request-id',requestId);response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');
    const send=(value:unknown,status=200)=>{response.statusCode=status;if(status===204){response.end();return;}response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
    const controller=new AbortController();request.on('aborted',()=>controller.abort());response.on('close',()=>{if(!response.writableFinished)controller.abort();});
    try{
      const origin=request.headers.origin;
      if(origin){if(!options.trustedOrigins?.includes(origin))throw new StorageError('FORBIDDEN');response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');if(options.allowCredentials)response.setHeader('access-control-allow-credentials','true');}
      if(request.method==='OPTIONS'){response.setHeader('access-control-allow-methods','GET,POST,PUT,DELETE,OPTIONS');response.setHeader('access-control-allow-headers','authorization,content-type');send(undefined,204);return true;}
      const actor=await options.authenticate(request);if(!actor?.id)throw new StorageError('FORBIDDEN');
      const parts=url.pathname.slice(base.length).split('/').filter(Boolean).map(p=>decodeURIComponent(p)),method=request.method;
      if(method==='POST'&&parts.length===1&&parts[0]==='uploads'){
        if(request.headers['content-type']?.split(';')[0]!=='application/json')throw new StorageError('INVALID_INPUT');
        const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>16384)throw new StorageError('INVALID_INPUT');chunks.push(Buffer.from(chunk));}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new StorageError('INVALID_INPUT');}
        if(Object.keys(input||{}).some(k=>!['name','size','contentType','storeId'].includes(k)))throw new StorageError('INVALID_INPUT');
        send(await options.service.createUpload(actor.id,input),201);
      }else if(parts[0]==='uploads'&&parts.length>=2){
        const id=parts[1];
        if(method==='PUT'&&parts.length===3&&parts[2]==='content'){
          const info=await options.service.info(actor.id,id);
          if(request.headers['content-type']!==info.contentType||(request.headers['content-length']!==undefined&&Number(request.headers['content-length'])!==info.size))throw new StorageError('INVALID_INPUT');
          await options.service.upload(actor.id,id,request,controller.signal);send(undefined,204);
        }else if(method==='POST'&&parts.length===3&&parts[2]==='complete')send(await options.service.complete(actor.id,id,controller.signal));
        else if(method==='POST'&&parts.length===3&&parts[2]==='recover')send(await options.service.recover(actor.id,id));
        else if(method==='DELETE'&&parts.length===2){await options.service.cancel(actor.id,id);send(undefined,204);}
        else throw new StorageError('NOT_FOUND');
      }else if(method==='GET'&&parts.length===0)send(await options.service.list(actor.id,{cursor:url.searchParams.get('cursor')||undefined,limit:pageLimit(url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined)}));
      else if(method==='GET'&&parts.length===1)send(await options.service.info(actor.id,parts[0]));
      else if(method==='GET'&&parts.length===2&&parts[1]==='download')send(await options.service.downloadLocation(actor.id,parts[0]));
      else if(method==='GET'&&parts.length===2&&parts[1]==='content'){
        const info=await options.service.info(actor.id,parts[0]),download=await options.service.download(actor.id,parts[0],controller.signal);
        response.setHeader('content-type',download.info.contentType);response.setHeader('content-length',download.info.size);response.setHeader('content-disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(info.name));await pipeline(download.body,response,{signal:controller.signal});
      }else if(method==='DELETE'&&parts.length===1){await options.service.delete(actor.id,parts[0]);send(undefined,204);}
      else throw new StorageError('NOT_FOUND');
    }catch(error){
      const e=error instanceof URIError?new StorageError('INVALID_INPUT'):sdkError(error);
      if(response.headersSent){response.destroy();return true;}
      const status={INVALID_INPUT:400,NOT_FOUND:404,FORBIDDEN:403,CONFLICT:409,EXPIRED:410,UNSUPPORTED:501,UNAVAILABLE:503,ABORTED:499,CONFIGURATION:503}[e.code];send({code:e.code,requestId},status);
    }return true;
  };
}
