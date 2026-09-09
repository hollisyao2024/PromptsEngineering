export type CapabilityResult<T>={ok:true;value:T}|{ok:false;reason:'unsupported'|'denied'|'cancelled'|'failed'};
export interface Platform {
  readTextFile():Promise<CapabilityResult<{name:string;text:string}>>;
  saveTextFile(name:string,text:string):Promise<CapabilityResult<void>>;
  readClipboard():Promise<CapabilityResult<string>>;
  writeClipboard(text:string):Promise<CapabilityResult<void>>;
  notify(title:string,body:string):Promise<CapabilityResult<void>>;
  openExternal(url:string):Promise<CapabilityResult<void>>;
  getPreference(key:string):Promise<CapabilityResult<string|null>>;
  setPreference(key:string,value:string):Promise<CapabilityResult<void>>;
}
const ok=<T>(value:T):CapabilityResult<T>=>({ok:true,value});
const unsupported=():CapabilityResult<never>=>({ok:false,reason:'unsupported'});
async function attempt<T>(fn:()=>T|Promise<T>):Promise<CapabilityResult<T>> {
  try{return ok(await fn());}catch(e){return {ok:false,reason:e instanceof DOMException&&e.name==='AbortError'?'cancelled':e instanceof DOMException&&['NotAllowedError','SecurityError'].includes(e.name)?'denied':'failed'};}
}
export function externalUrl(value:string):string {
  const url=new URL(value);if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password)throw new Error('Unsupported external URL');
  return url.href;
}
export function createBrowserPlatform():Platform {
  return {
    async readTextFile(){
      const picker=(globalThis as unknown as {showOpenFilePicker?:()=>Promise<Array<{name:string;getFile():Promise<File>}>>}).showOpenFilePicker;
      if(!picker)return unsupported();
      return attempt(async()=>{const [handle]=await picker.call(globalThis);const file=await handle.getFile();if(file.size>5*1024*1024)throw new Error('File too large');return {name:file.name,text:await file.text()};});
    },
    async saveTextFile(name,text){
      if(typeof document==='undefined')return unsupported();
      return attempt(()=>{const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.download=name;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    },
    async readClipboard(){return globalThis.navigator?.clipboard?attempt(()=>navigator.clipboard.readText()):unsupported();},
    async writeClipboard(text){return globalThis.navigator?.clipboard?attempt(()=>navigator.clipboard.writeText(text)):unsupported();},
    async notify(title,body){
      if(typeof Notification==='undefined')return unsupported();
      return attempt(async()=>{if(await Notification.requestPermission()!=='granted')throw new DOMException('Permission denied','NotAllowedError');new Notification(title,{body});});
    },
    async openExternal(value){
      if(typeof window==='undefined')return unsupported();
      return attempt(()=>{const url=externalUrl(value);window.open(url,'_blank','noopener,noreferrer');});
    },
    async getPreference(key){return typeof window==='undefined'?unsupported():attempt(()=>window.localStorage.getItem(key));},
    async setPreference(key,value){return typeof window==='undefined'?unsupported():attempt(()=>window.localStorage.setItem(key,value));},
  };
}
export async function createTauriPlatform():Promise<Platform> {
  const {isTauri}=await import('@tauri-apps/api/core');
  if(!isTauri())throw new Error('Tauri host unavailable');
  const [dialog,fs,clipboard,notification,opener,{LazyStore}]=await Promise.all([
    import('@tauri-apps/plugin-dialog'),import('@tauri-apps/plugin-fs'),import('@tauri-apps/plugin-clipboard-manager'),import('@tauri-apps/plugin-notification'),import('@tauri-apps/plugin-opener'),import('@tauri-apps/plugin-store'),
  ]);
  const store=new LazyStore('preferences.json');
  return {
    async readTextFile(){return attempt(async()=>{const file=await dialog.open({multiple:false,directory:false,filters:[{name:'Text',extensions:['txt','csv','json']}]});if(!file)throw new DOMException('Cancelled','AbortError');if((await fs.stat(file)).size>5*1024*1024)throw new Error('File too large');return {name:file.split(/[\\/]/).pop()||'file',text:await fs.readTextFile(file)};});},
    async saveTextFile(name,text){return attempt(async()=>{const file=await dialog.save({defaultPath:name});if(!file)throw new DOMException('Cancelled','AbortError');await fs.writeTextFile(file,text);});},
    async readClipboard(){return attempt(()=>clipboard.readText());},
    async writeClipboard(text){return attempt(()=>clipboard.writeText(text));},
    async notify(title,body){return attempt(async()=>{if(!await notification.isPermissionGranted()&&await notification.requestPermission()!=='granted')throw new DOMException('Denied','NotAllowedError');notification.sendNotification({title,body});});},
    async openExternal(url){return attempt(()=>opener.openUrl(externalUrl(url)));},
    async getPreference(key){return attempt(async()=>await store.get<string>(key)??null);},
    async setPreference(key,value){return attempt(async()=>{await store.set(key,value);await store.save();});},
  };
}
export async function createPlatform():Promise<Platform> {
  const {isTauri}=await import('@tauri-apps/api/core');return isTauri()?createTauriPlatform():createBrowserPlatform();
}
