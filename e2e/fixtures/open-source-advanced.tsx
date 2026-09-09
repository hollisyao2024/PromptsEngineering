// Xirang disposable QA fixture

import {useState} from 'react';import {createRoot} from 'react-dom/client';import './styles.css';
import {createProjectAuthClient,createIdentityPort} from '@project/auth-client';
import {IdentityPanel} from '@project/ui/advanced/identity-panel';import {FileUpload} from '@project/ui/advanced/file-upload';
import {RichTextEditor,type JSONContent} from '@project/ui/advanced/rich-text-editor';import {MetricChart} from '@project/ui/advanced/metric-chart';
import {SortableList} from '@project/ui/advanced/sortable-list';import {FlowEditor} from '@project/ui/advanced/flow-editor';
import {VirtualDataTable} from '@project/ui/data-table/virtual-data-table';import {JobStatus} from '@project/ui/feedback/job-status';import {createFileClient} from './lib/file-client';
const identity=createIdentityPort(createProjectAuthClient(location.origin)),files=createFileClient({baseURL:'/files'});
const rows=Array.from({length:1000},(_,i)=>({id:String(i),name:'Row '+i}));
function Demo(){const [text,setText]=useState<JSONContent>({type:'doc',content:[{type:'paragraph'}]}),[order,setOrder]=useState(['alpha','beta']),[uploaded,setUploaded]=useState(''),[exported,setExported]=useState('');
return <main className="mx-auto max-w-5xl space-y-6 p-4"><h1>开源组件浏览器验证</h1><IdentityPanel client={identity}/><FileUpload maxSize={32} accept={['text/plain']} client={files} onUploaded={file=>setUploaded(file.id)}/><output aria-label="已上传文件">{uploaded}</output><RichTextEditor value={text} onChange={setText}/><output aria-label="正文 JSON">{JSON.stringify(text)}</output><MetricChart title="访客" data={[{label:'周一',value:12},{label:'周二',value:18}]}/><SortableList items={order} getId={x=>x} renderItem={x=>x} onChange={setOrder}/><output aria-label="排序结果">{order.join(',')}</output><FlowEditor nodes={[{id:'start',position:{x:0,y:0},data:{label:'开始'}}]} edges={[]} readOnly onChange={()=>{}}/><JobStatus job={{id:'fixture',state:'failed'}} onRetry={async()=>setExported('retry requested')}/><VirtualDataTable data={rows} columns={[{accessorKey:'name',header:'名称'}]} getRowId={r=>r.id} initialPageSize={1000} onExport={async value=>setExported(String(value.rows.length))}/><output aria-label="导出数量">{exported}</output></main>;
}createRoot(document.getElementById('root')!).render(<Demo/>);
