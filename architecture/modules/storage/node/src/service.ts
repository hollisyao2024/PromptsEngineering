import { randomUUID } from 'node:crypto';
import { StorageError,validSize,validContentType,ttl } from './contracts.ts';
import type {PutInput,ObjectDownload} from './contracts.ts';
import type {FileInfo,UploadInput,UploadSession} from './client.ts';
import type {FileRecord,FileRepository} from './repository.ts';
import {StorageRouter} from './router.ts';
import {readable,sizeGuard} from './streams.ts';
import {pipeline} from 'node:stream/promises';
import {PassThrough} from 'node:stream';

const visible=(r:FileRecord):FileInfo=>({id:r.id,name:r.name,size:r.size,contentType:r.contentType,state:r.state,createdAt:r.createdAt,updatedAt:r.updatedAt});
export class FileService {
  readonly router:StorageRouter;readonly repository:FileRepository;readonly maxSize:number;readonly lifetime:number;readonly clock:()=>number;
  constructor(options:{router:StorageRouter;repository:FileRepository;maxSize?:number;expiresIn?:number;clock?:()=>number}){
    this.router=options.router;this.repository=options.repository;this.maxSize=validSize(options.maxSize??32*1024*1024);this.lifetime=ttl(options.expiresIn??900);this.clock=options.clock||Date.now;
  }
  private async own(ownerId:string,id:string):Promise<FileRecord>{
    if(!ownerId||ownerId.length>255)throw new StorageError('FORBIDDEN');
    const r=await this.repository.get(id);if(!r||r.ownerId!==ownerId)throw new StorageError('NOT_FOUND');return r;
  }
  private async move(record:FileRecord,fields:Partial<FileRecord>):Promise<FileRecord>{
    const next={...record,...fields,version:record.version+1,updatedAt:new Date(this.clock()).toISOString()};
    if(!await this.repository.compareAndSwap(record.id,record.version,next))throw new StorageError('CONFLICT','File changed; read its state before retry');return next;
  }
  private active(r:FileRecord){if(Date.parse(r.expiresAt)<=this.clock())throw new StorageError('EXPIRED');}
  async createUpload(ownerId:string,input:UploadInput):Promise<UploadSession>{
    if(!ownerId||ownerId.length>255)throw new StorageError('FORBIDDEN');
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>255||/[\x00-\x1f\x7f]/.test(input.name))throw new StorageError('INVALID_INPUT','Invalid file name');
    validSize(input.size,this.maxSize);validContentType(input.contentType);const storeId=input.storeId||this.router.defaultStore,provider=this.router.get(storeId);
    const id=randomUUID(),now=new Date(this.clock()).toISOString(),expiresAt=new Date(this.clock()+this.lifetime*1000).toISOString();
    const record:FileRecord={schemaVersion:1,id,ownerId,storeId,objectKey:'files/'+id+'/'+randomUUID(),tempKey:'uploads/'+id+'/'+randomUUID(),name:input.name,size:input.size,contentType:input.contentType,state:'pending',version:1,createdAt:now,updatedAt:now,expiresAt};
    const signed=provider.signUpload?await provider.signUpload(record.tempKey,{size:record.size,contentType:record.contentType,expiresIn:this.lifetime}):undefined;
    await this.repository.create(record);
    return {file:visible(record),expiresAt,transport:signed?{...signed,method:'PUT',kind:'signed'}:{kind:'proxy',method:'PUT',path:'/uploads/'+id+'/content'}};
  }
  async upload(ownerId:string,id:string,body:PutInput['body'],signal?:AbortSignal):Promise<void>{
    let r=await this.own(ownerId,id);this.active(r);if(r.state!=='pending')throw new StorageError('CONFLICT');
    r=await this.move(r,{state:'uploading',leaseUntil:this.clock()+300000});
    const operation=AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])]);
    try{await this.router.get(r.storeId).put(r.tempKey,{body,size:r.size,contentType:r.contentType,signal:operation});await this.move(r,{state:'pending',leaseUntil:undefined});}catch(e){await this.move(r,{state:'pending',leaseUntil:undefined}).catch(()=>{});throw e;}
  }
  async complete(ownerId:string,id:string,signal?:AbortSignal):Promise<FileInfo>{
    let r=await this.own(ownerId,id);if(r.state==='ready')return visible(r);this.active(r);if(r.state!=='pending')throw new StorageError('CONFLICT');
    r=await this.move(r,{state:'completing',leaseUntil:this.clock()+300000});const provider=this.router.get(r.storeId),operation=AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])]);
    try{
      const download=await provider.get(r.tempKey,{signal:operation});if(download.info.size!==r.size||download.info.contentType!==r.contentType){download.body.destroy();throw new StorageError('INVALID_INPUT','Uploaded metadata differs from session');}
      const bridge=new PassThrough(),guard=sizeGuard(r.size);
      const sending=provider.put(r.objectKey,{body:bridge,size:r.size,contentType:r.contentType,signal:operation});
      const copying=pipeline(download.body,guard.stream,bridge,{signal:operation});
      try{await Promise.all([copying,sending]);}catch(e){bridge.destroy();download.body.destroy();await Promise.allSettled([copying,sending]);throw e;}
      r=await this.move(r,{state:'ready',leaseUntil:undefined});
      // Temporary URL can still be replayed; only the separate final object is downloadable.
      await provider.delete(r.tempKey).catch(()=>{});
      return visible(r);
    }catch(e){
      // Leave completing for explicit recovery; an uncertain DB write must never delete a ready object.
      throw e;
    }
  }
  async recover(ownerId:string,id:string):Promise<FileInfo>{
    let r=await this.own(ownerId,id);
    if(['completing','uploading'].includes(r.state)){
      if((r.leaseUntil||0)>this.clock())throw new StorageError('CONFLICT','Operation lease is still active');
      const previousState=r.state;
      r=await this.move(r,{leaseUntil:this.clock()+300000});
      if(previousState==='completing')await this.router.get(r.storeId).delete(r.objectKey);
      r=await this.move(r,{state:'pending',objectKey:'files/'+r.id+'/'+randomUUID(),leaseUntil:undefined});
    }else if(r.state==='deleting'){await this.removeObjects(r);r=await this.move(r,{state:'deleted'});}
    return visible(r);
  }
  async cancel(ownerId:string,id:string):Promise<void>{
    let r=await this.own(ownerId,id);if(r.state==='cancelled'){await this.router.get(r.storeId).delete(r.tempKey);return;}if(r.state!=='pending')throw new StorageError('CONFLICT');
    r=await this.move(r,{state:'cancelled'});await this.router.get(r.storeId).delete(r.tempKey);
  }
  async info(ownerId:string,id:string):Promise<FileInfo>{return visible(await this.own(ownerId,id));}
  async download(ownerId:string,id:string,signal?:AbortSignal):Promise<ObjectDownload>{const r=await this.own(ownerId,id);if(r.state!=='ready')throw new StorageError('NOT_FOUND');return this.router.get(r.storeId).get(r.objectKey,{signal});}
  async downloadLocation(ownerId:string,id:string):Promise<{url?:string;headers?:Record<string,string>;expiresAt?:string;path?:string}>{
    const r=await this.own(ownerId,id);if(r.state!=='ready')throw new StorageError('NOT_FOUND');const p=this.router.get(r.storeId);
    if(p.signDownload){const s=await p.signDownload(r.objectKey,{expiresIn:Math.min(this.lifetime,300)});return {url:s.url,headers:s.headers,expiresAt:s.expiresAt};}return {path:'/'+id+'/content'};
  }
  private async removeObjects(r:FileRecord){const p=this.router.get(r.storeId);await p.delete(r.objectKey);await p.delete(r.tempKey);}
  async delete(ownerId:string,id:string):Promise<void>{
    let r=await this.own(ownerId,id);if(r.state==='deleted')return;if(r.state==='ready')r=await this.move(r,{state:'deleting'});else if(r.state!=='deleting')throw new StorageError('CONFLICT');
    await this.removeObjects(r);await this.move(r,{state:'deleted'});
  }
  async list(ownerId:string,input:{cursor?:string;limit?:number}={}){if(!ownerId)throw new StorageError('FORBIDDEN');const page=await this.repository.list(ownerId,input);return {...page,items:page.items.map(visible)};}
}
