import {StorageError,call,type StorageProvider} from './contracts.ts';
// Server-side extension port. A project adapter must implement and explicitly advertise its operation.
export function runStorageExtension<T=unknown>(provider:StorageProvider,name:string,input:unknown):Promise<T>{
 if(!/^[a-z][a-z0-9.-]{1,63}$/.test(name)||Buffer.byteLength(JSON.stringify(input)??'')>65536)throw new StorageError('INVALID_INPUT');
 if(!provider.capabilities.extensions.includes(name)||!provider.extension)throw new StorageError('UNSUPPORTED');
 return call(()=>provider.extension!<T>(name,input));
}
