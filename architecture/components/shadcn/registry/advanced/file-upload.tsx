"use client";
import {useEffect,useRef,useState} from "react";
import Uppy from "@uppy/core";
import {useUppyState} from "@uppy/react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Progress} from "@/components/ui/progress";
import {Alert,AlertDescription} from "@/components/ui/alert";
export interface UploadedFile {id:string;name:string;size:number;contentType:string;state:string;createdAt:string;updatedAt:string}
interface Session {file:UploadedFile;expiresAt:string;transport:{kind:"proxy";method:"PUT";path:string}|{kind:"signed";method:"PUT";url:string;headers:Record<string,string>;expiresAt:string}}
export interface UploadPort {
 createUpload(input:{name:string;size:number;contentType:string},signal?:AbortSignal):Promise<Session>;
 upload(session:Session,file:Blob,options?:{signal?:AbortSignal;onProgress?:(fraction:number)=>void}):Promise<void>;
 complete(id:string,signal?:AbortSignal):Promise<UploadedFile>;
 cancel(id:string):Promise<unknown>;
}
export interface FileUploadProps {client:UploadPort;onUploaded:(file:UploadedFile)=>void;maxFiles?:number;maxSize?:number;accept?:string[];disabled?:boolean}
export function FileUpload({client,onUploaded,maxFiles=10,maxSize=32*1024*1024,accept,disabled=false}:FileUploadProps){
 const [uppy]=useState(()=>new Uppy<Record<string,unknown>,Record<string,unknown>>({autoProceed:false,restrictions:{maxNumberOfFiles:maxFiles,maxFileSize:maxSize,allowedFileTypes:accept}}));
 const current=useRef({client,onUploaded});current.current={client,onUploaded};
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const files=useUppyState(uppy,s=>s.files),running=useRef(new Map<string,AbortController>());
 useEffect(()=>{uppy.setOptions({restrictions:{maxNumberOfFiles:maxFiles,maxFileSize:maxSize,allowedFileTypes:accept}});},[uppy,maxFiles,maxSize,accept]);
 useEffect(()=>{
  let disposed=false;
  const upload=async(ids:string[])=>{
   for(const id of ids){if(disposed)break;const file=uppy.getFile(id);if(!file)continue;const controller=new AbortController();running.current.set(id,controller);let session:Session|undefined,completed=false;
    try{
     if(!(file.data instanceof Blob))throw new Error("Only local browser files are supported");
     uppy.emit("upload-start",[file]);
     session=await current.current.client.createUpload({name:file.name||"file",size:file.size||0,contentType:file.type||"application/octet-stream"},controller.signal);
     await current.current.client.upload(session,file.data,{signal:controller.signal,onProgress:fraction=>{if(uppy.getFile(id))uppy.emit("upload-progress",file,{uploadStarted:Date.now(),bytesUploaded:fraction*(file.size||0),bytesTotal:file.size||0});}});
     const result=await current.current.client.complete(session.file.id,controller.signal);completed=true;
     if(uppy.getFile(id))uppy.emit("upload-success",file,{status:200,body:{...result}});
     if(!disposed)current.current.onUploaded(result);
    }catch(caught){if(session&&!completed)await current.current.client.cancel(session.file.id).catch(()=>undefined);const failure=new Error(controller.signal.aborted?"上传已取消":"上传失败，请重试");if(uppy.getFile(id))uppy.emit("upload-error",file,failure);if(!disposed)setError(failure.message);}
    finally{running.current.delete(id);}
   }
  };
  const remove=(file:{id:string})=>running.current.get(file.id)?.abort();
  uppy.addUploader(upload);uppy.on("file-removed",remove);
  return ()=>{disposed=true;for(const controller of running.current.values())controller.abort();uppy.removeUploader(upload);uppy.off("file-removed",remove);};
 },[uppy]);
 const choose=(items:FileList|null)=>{setError("");for(const file of Array.from(items||[]))try{uppy.addFile({name:file.name,type:file.type||"application/octet-stream",data:file});}catch{setError("文件类型、数量或大小不符合限制");}};
 return <section className="space-y-3" aria-label="文件上传" aria-busy={busy}>
  <Label>选择文件<Input aria-label="选择上传文件" type="file" multiple accept={accept?.join(",")} disabled={disabled||busy} onChange={event=>{choose(event.target.files);event.target.value="";}}/></Label>
  {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  <ul className="space-y-2">{Object.values(files).map(file=><li key={file.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{file.name}</span><Progress className="w-24" aria-label={file.name+" 上传进度"} value={file.progress.percentage||0}/><span>{file.progress.uploadComplete?"已完成":file.error?"失败":(file.progress.percentage||0)+"%"}</span><Button variant="ghost" size="sm" disabled={disabled} onClick={()=>uppy.removeFile(file.id)}>{busy?"取消":"移除"}</Button></li>)}</ul>
  <Button disabled={disabled||busy||!Object.values(files).some(f=>!f.progress.uploadComplete)} onClick={async()=>{setBusy(true);setError("");try{await uppy.upload();}catch{setError("上传失败，请重试");}finally{setBusy(false);}}}>上传文件</Button>
 </section>;
}
