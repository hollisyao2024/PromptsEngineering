import {StorageError} from './contracts.ts';
import type {CloudOptions,CloudCredentials} from './cloud.ts';
export function readCloudEnvironment(prefix:string,env:NodeJS.ProcessEnv=process.env):CloudOptions{
  const required=(key:string)=>{const value=env[prefix+'_'+key];if(!value)throw new StorageError('CONFIGURATION','Missing '+prefix+'_'+key);return value;};
  return {bucket:required('BUCKET'),region:required('REGION'),endpoint:env[prefix+'_ENDPOINT']||undefined,publicEndpoint:env[prefix+'_PUBLIC_ENDPOINT']||undefined,forcePathStyle:env[prefix+'_FORCE_PATH_STYLE']==='true',credentials:async():Promise<CloudCredentials>=>({accessKeyId:required('ACCESS_KEY_ID'),secretAccessKey:required('SECRET_ACCESS_KEY'),sessionToken:env[prefix+'_SESSION_TOKEN']||undefined,...(env[prefix+'_CREDENTIAL_EXPIRATION']?{expiration:new Date(env[prefix+'_CREDENTIAL_EXPIRATION']!)}:{})})};
}
