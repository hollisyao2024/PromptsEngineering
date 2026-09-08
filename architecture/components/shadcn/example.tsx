"use client";
import { useState } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import type { ColumnDef } from '@tanstack/react-table';
type Row = { id: string; name: string; status: string; count: number };
const columns: ColumnDef<Row>[] = [
 { accessorKey: 'name', header: '名称' },
 { accessorKey: 'status', header: '状态', meta: { filterVariant: 'select', filterOptions: [{ value: 'active', label: '启用' }, { value: 'paused', label: '暂停' }] } },
 { accessorKey: 'count', header: '数量', meta: { filterVariant: 'range' } },
];
const getRowId = (row: Row) => row.id;
export function App() {
 const [rows] = useState<Row[]>(Array.from({length:24},(_,index)=>({id:String(index+1),name:`示例记录 ${index+1}`,status:index%3?'active':'paused',count:index*7})));
 return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8"><header><h1 className="text-2xl font-semibold">数据列表</h1><p className="mt-2 text-sm text-muted-foreground">筛选、排序、分页和选择由公共表格管理。接入项目回调后显示新增、修改和删除操作。</p></header><DataTable columns={columns} data={rows} getRowId={getRowId} /></main>;
}
