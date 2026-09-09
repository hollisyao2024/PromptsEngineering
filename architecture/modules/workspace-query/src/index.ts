import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError} from '@project/api-client';
import type {ApiClient,TaskQuery,CreateTask,UpdateTask} from '@project/api-client';
export {QueryClient,QueryClientProvider} from '@tanstack/react-query';
// Each client represents an auth/API scope; never put credentials in cache keys.
const scopes=new WeakMap<ApiClient,number>();let nextScope=0;
export const taskKeys={all:['tasks'] as const,list:(query:TaskQuery,scope:number)=>['tasks',scope,query] as const};
export function useTasks(client:ApiClient,query:TaskQuery) {
  if(!scopes.has(client))scopes.set(client,++nextScope);
  const scope=scopes.get(client)!;
  return useQuery({queryKey:taskKeys.list(query,scope),queryFn:({signal})=>client.list(query,signal),placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===scope?previous:undefined,staleTime:15000,retry:false});
}
export function useTaskMutations(client:ApiClient) {
  const cache=useQueryClient(),onSuccess=()=>cache.invalidateQueries({queryKey:taskKeys.all});
  const onError=(error:Error)=>{if(error instanceof ApiError&&error.status===409)return onSuccess();};
  const create=useMutation({mutationFn:(body:CreateTask)=>client.create(body),onSuccess,onError,retry:false});
  const update=useMutation({mutationFn:({id,...body}:UpdateTask&{id:string})=>client.update(id,body),onSuccess,onError,retry:false});
  const remove=useMutation({mutationFn:(ids:string[])=>client.remove(ids),onSuccess,onError,retry:false});
  return {create,update,remove};
}
