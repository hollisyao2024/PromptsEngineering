import createClient from 'openapi-fetch';
import type {paths,components} from '@project/contracts/types';
export type Task=components['schemas']['Task'];
export type CreateTask=components['schemas']['CreateTask'];
export type UpdateTask=components['schemas']['UpdateTask'];
export type TaskQuery=components['schemas']['TaskQuery'];
export class ApiError extends Error {
  constructor(message:string,public readonly status:number,public readonly code:string,public readonly requestId:string) {super(message);}
}
export function createApiClient(options:{baseUrl:string;token?:()=>string|undefined;fetch?:typeof fetch}) {
  const client=createClient<paths>({baseUrl:options.baseUrl,fetch:options.fetch});
  const headers=()=>{const token=options.token?.();return token?{authorization:'Bearer '+token}:{};};
  const signal=(caller?:AbortSignal)=>caller?AbortSignal.any([caller,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
  function unwrap<T>(result:{data?:T;error?:unknown;response:Response}):T {
    if(result.response.ok && result.data!==undefined)return result.data;
    const error=result.error as Partial<components['schemas']['Error']>|undefined;
    throw new ApiError(error?.message||'请求失败',result.response.status,error?.code||'HTTP_ERROR',error?.requestId||result.response.headers.get('x-request-id')||'');
  }
  return {
    async list(query:TaskQuery={},caller?:AbortSignal){return unwrap(await client.GET('/tasks',{params:{query},headers:headers(),signal:signal(caller)}));},
    async create(body:CreateTask){return unwrap(await client.POST('/tasks',{body,headers:headers(),signal:signal()}));},
    async update(id:string,body:UpdateTask){return unwrap(await client.PATCH('/tasks/{id}',{params:{path:{id}},body,headers:headers(),signal:signal()}));},
    async remove(ids:string[]){return unwrap(await client.DELETE('/tasks',{body:{ids},headers:headers(),signal:signal()}));},
    async export(query:TaskQuery,scope:'page'|'filtered'|'selected',ids:string[]=[],caller?:AbortSignal){return unwrap(await client.GET('/tasks/export',{params:{query:{...query,scope,ids:ids.join(',')}},headers:headers(),signal:signal(caller)}));},
  };
}
export type ApiClient=ReturnType<typeof createApiClient>;
