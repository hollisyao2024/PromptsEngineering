export interface FileInfo {id:string;name:string;size:number;contentType:string;state:string;createdAt:string;updatedAt:string}
export interface UploadInput {name:string;size:number;contentType:string;storeId?:string}
export interface UploadSession {file:FileInfo;expiresAt:string;transport:{kind:'proxy';method:'PUT';path:string}|{kind:'signed';method:'PUT';url:string;headers:Record<string,string>;expiresAt:string}}
export interface FilePage {items:FileInfo[];cursor?:string}
export class FileClientError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
export function createFileClient(options:{baseURL:string;headers?:()=>HeadersInit;fetch?:typeof fetch;credentials?:RequestCredentials}) {
  const outerCredentials=options.credentials;
  const base=options.baseURL.replace(/\/$/,'');if(!base.startsWith('/')&&!/^https?:\/\//.test(base))throw new FileClientError('CONFIGURATION');const fetcher=options.fetch||fetch;
  async function request<T>(route:string,init:RequestInit={}):Promise<T>{
    const headers=new Headers(options.headers?.());if(typeof init.body==='string')headers.set('content-type','application/json');
    const response=await fetcher(base+route,{...init,headers,credentials:options.credentials||'same-origin'});
    if(!response.ok){const data=await response.json().catch(()=>({code:'UNAVAILABLE'}));throw new FileClientError(data.code||'UNAVAILABLE');}
    return response.status===204?undefined as T:response.json();
  }
  return {
    createUpload:(input:UploadInput,signal?:AbortSignal)=>request<UploadSession>('/uploads',{method:'POST',body:JSON.stringify(input),signal}),
    complete:(id:string,signal?:AbortSignal)=>request<FileInfo>('/uploads/'+encodeURIComponent(id)+'/complete',{method:'POST',signal}),
    info:(id:string)=>request<FileInfo>('/'+encodeURIComponent(id)),
    recover:(id:string)=>request<FileInfo>('/uploads/'+encodeURIComponent(id)+'/recover',{method:'POST'}),
    cancel:(id:string)=>request<void>('/uploads/'+encodeURIComponent(id),{method:'DELETE'}),
    delete:(id:string)=>request<void>('/'+encodeURIComponent(id),{method:'DELETE'}),
    list:(cursor?:string)=>request<FilePage>('?'+new URLSearchParams(cursor?{cursor}:{})),
    async upload(session:UploadSession,file:Blob,options:{signal?:AbortSignal;onProgress?:(fraction:number)=>void}={}):Promise<void>{
      options.signal?.throwIfAborted();if(file.size!==session.file.size)throw new FileClientError('INVALID_INPUT');
      const transport=session.transport;const url=transport.kind==='signed'?transport.url:base+transport.path;
      await new Promise<void>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();const abort=()=>xhr.abort();options.signal?.addEventListener('abort',abort,{once:true});
        const cleanup=()=>options.signal?.removeEventListener('abort',abort);
        xhr.open('PUT',url);xhr.withCredentials=transport.kind==='proxy'&&outerCredentials==='include';const headers=new Headers(transport.kind==='signed'?transport.headers:optionsHeaders());headers.forEach((value,key)=>xhr.setRequestHeader(key,value));
        xhr.upload.onprogress=e=>{if(e.lengthComputable)options.onProgress?.(e.loaded/e.total);};
        xhr.onload=()=>{cleanup();xhr.status>=200&&xhr.status<300?resolve():reject(new FileClientError('UPLOAD_FAILED'));};
        xhr.onerror=()=>{cleanup();reject(new FileClientError('UNAVAILABLE'));};xhr.onabort=()=>{cleanup();reject(new DOMException('Upload cancelled','AbortError'));};
        if(options.signal?.aborted){cleanup();reject(new DOMException('Upload cancelled','AbortError'));return;}
        try{xhr.send(file);}catch(error){cleanup();reject(error);}
      });
      function optionsHeaders(){const headers=new Headers(optionsOuterHeaders());headers.set('content-type',session.file.contentType);return headers;}
    },
    downloadURL:async(id:string)=>request<{url?:string;path?:string;expiresAt?:string}>('/'+encodeURIComponent(id)+'/download'),
  };
  function optionsOuterHeaders(){return options.headers?.();}
}
