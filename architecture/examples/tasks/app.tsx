"use client";
import {useEffect,useMemo,useState} from 'react';
import {createApiClient,type Task,type TaskQuery} from '@project/api-client';
import {QueryClient,QueryClientProvider,useTasks,useTaskMutations} from '@project/query';
import {createPlatform,type Platform} from '@project/platform';
import {AppShell} from '@project/ui/app-shell';
import {DataTable,type TableQuery} from '@project/ui/data-table/data-table';
import {FormDialog} from '@project/ui/forms/form-panel';
import {FormField} from '@project/ui/forms/form-field';
import {Input} from '@project/ui/ui/input';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@project/ui/ui/select';
import {Badge} from '@project/ui/ui/badge';
import type {ColumnDef} from '@tanstack/react-table';
const labels={todo:'待处理',doing:'进行中',done:'已完成'};
const columns:ColumnDef<Task>[]=[
  {accessorKey:'title',header:'标题',meta:{label:'标题'}},
  {accessorKey:'status',header:'状态',cell:({row})=><Badge variant="secondary">{labels[row.original.status]}</Badge>,meta:{label:'状态',filterVariant:'select',filterOptions:Object.entries(labels).map(([value,label])=>({value,label}))}},
  {accessorKey:'version',header:'版本',enableSorting:false,enableColumnFilter:false},
  {accessorKey:'createdAt',header:'创建时间',enableColumnFilter:false,cell:({row})=>new Date(row.original.createdAt).toLocaleString()},
];
const rowId=(row:Task)=>row.id;
const initial:TableQuery={pagination:{pageIndex:0,pageSize:10},sorting:[],filters:[],search:''};
export function App() {
  const [cache]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}));
  return <QueryClientProvider client={cache}><TasksPage/></QueryClientProvider>;
}
function TasksPage() {
  const [token,setToken]=useState(''),[query,setQuery]=useState<TableQuery>(initial),[scope,setScope]=useState<'page'|'filtered'|'selected'>('filtered');
  const [platform,setPlatform]=useState<Platform|null>(null),[platformError,setPlatformError]=useState('');
  useEffect(()=>{let active=true;void createPlatform().then(p=>{if(active)setPlatform(p);}).catch(()=>{if(active)setPlatformError('当前宿主文件能力不可用');});return()=>{active=false;};},[]);
  const client=useMemo(()=>createApiClient({baseUrl:import.meta.env.VITE_API_URL||'http://127.0.0.1:3000',token:()=>token||undefined}),[token]);
  const apiQuery=useMemo<TaskQuery>(()=>({page:query.pagination.pageIndex,pageSize:query.pagination.pageSize,search:query.search,sorts:query.sorting.length?query.sorting.map(s=>s.id+':'+(s.desc?'desc':'asc')).join(','):undefined,...Object.fromEntries(query.filters.filter(f=>['title','status'].includes(f.id)).map(f=>[f.id,String(f.value)]))}),[query]);
  const list=useTasks(client,apiQuery),mutations=useTaskMutations(client);
  const [editing,setEditing]=useState<Task|null>(null),[open,setOpen]=useState(false),[title,setTitle]=useState(''),[status,setStatus]=useState<Task['status']>('todo');
  const begin=(row:Task|null)=>{setEditing(row);setTitle(row?.title||'');setStatus(row?.status||'todo');setOpen(true);};
  return <AppShell title="任务管理" items={[{id:'tasks',label:'任务管理',href:'#tasks'}]} current="tasks">
    <section id="tasks" className="min-w-0 space-y-5">
      <div className="max-w-sm"><FormField label="访问令牌" description="仅保存在当前页面内存，用于新增、修改、删除和导出。"><Input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></FormField></div>
      {platformError&&<p role="alert">{platformError}</p>}
      <DataTable data={list.data?.items||[]} columns={columns} getRowId={rowId} mode="server" rowCount={list.data?.total||0} query={query} onQueryChange={setQuery}
        loading={list.isFetching} error={list.error?.message} onRetry={()=>void list.refetch()}
        onCreate={()=>begin(null)} onEdit={begin} onDelete={async ids=>{await mutations.remove.mutateAsync(ids);}}
        exportScope={scope} onExport={async request=>{if(!platform)throw new Error('文件能力尚未准备好');const data=await client.export(apiQuery,request.scope,request.rowIds);const saved=await platform.saveTextFile(data.filename,'\uFEFF'+data.csv);if(!saved.ok)throw new Error(saved.reason==='cancelled'?'已取消导出':'当前宿主无法保存文件');}}
        toolbar={<Select value={scope} onValueChange={v=>setScope(v as typeof scope)}><SelectTrigger aria-label="导出范围"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="page">当前页</SelectItem><SelectItem value="filtered">筛选结果</SelectItem><SelectItem value="selected">选中记录</SelectItem></SelectContent></Select>}/>
      <FormDialog open={open} onOpenChange={setOpen} title={editing?'修改任务':'新增任务'} description="填写标题和状态，保存后刷新任务列表。" dirty={title!==(editing?.title||'')||status!==(editing?.status||'todo')} onSubmit={async()=>{
        if(!title.trim()||title.length>200)throw new Error('标题应为 1 至 200 个字符');
        if(editing)await mutations.update.mutateAsync({id:editing.id,title,status,version:editing.version});
        else await mutations.create.mutateAsync({title,status});
      }}>
        <FormField label="任务标题"><Input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></FormField>
        <FormField label="任务状态">{props=><Select value={status} onValueChange={v=>setStatus(v as Task['status'])}><SelectTrigger {...props}><SelectValue/></SelectTrigger><SelectContent>{Object.entries(labels).map(([value,label])=><SelectItem value={value} key={value}>{label}</SelectItem>)}</SelectContent></Select>}</FormField>
      </FormDialog>
    </section>
  </AppShell>;
}
