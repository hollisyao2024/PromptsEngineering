import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DataTable, type TableQuery } from '@/components/data-table/data-table';
import type { ColumnDef } from '@tanstack/react-table';
type Item = { id: string; name: string; value: number };
const data: Item[] = Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1), name: `Row ${String(index + 1).padStart(2,'0')}`, value: index + 1 }));
const getRowId = (row: Item) => row.id;
const columns: ColumnDef<Item>[] = [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'value', header: 'Value', meta: { filterVariant: 'range' } }];
describe('TC-ARCHPLAT-005 common table', () => {
  it('paginates first/last, filters raw values, and sorts numerically', async () => {
    const user=userEvent.setup();render(<DataTable data={data} columns={columns} getRowId={getRowId} />);
    expect(screen.getByText('Row 01')).toBeVisible();expect(screen.queryByText('Row 12')).toBeNull();
    await user.click(screen.getByRole('button',{name:'末页'}));expect(screen.getByText('Row 12')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'首页'}));
    await user.type(screen.getByRole('spinbutton',{name:'Value 最小值'}),'11');
    expect(screen.queryByText('Row 01')).toBeNull();expect(screen.getByText('Row 11')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'清除筛选'}));
    await user.click(screen.getByRole('button',{name:'排序 Value'}));
    expect(within(screen.getAllByRole('row')[1]).getByText('Row 12')).toBeVisible();
  });
  it('keeps stable selections across pages and clears them explicitly', async () => {
    const user=userEvent.setup(), change=vi.fn();render(<DataTable data={data} columns={columns} getRowId={getRowId} onSelectionChange={change} />);
    await user.click(screen.getByRole('checkbox',{name:'选择行 1'}));await user.click(screen.getByRole('button',{name:'下一页'}));
    await user.click(screen.getByRole('checkbox',{name:'选择行 11'}));expect(change.mock.lastCall?.[0]).toEqual({'1':true,'11':true});
    await user.click(screen.getByRole('button',{name:'清空选择'}));expect(change.mock.lastCall?.[0]).toEqual({});
  });
  it('only shows real actions, confirms deletes, handles async failure and prevents duplicate submission', async () => {
    const user=userEvent.setup(), create=vi.fn(), edit=vi.fn();let reject!: (error: Error) => void;
    const remove=vi.fn(()=>new Promise<void>((_,r)=>{reject=r;}));
    render(<DataTable data={data.slice(0,1)} columns={columns} getRowId={getRowId} onCreate={create} onEdit={edit} onDelete={remove} />);
    await user.click(screen.getByRole('button',{name:'新增'}));expect(create).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button',{name:'修改 1'}));expect(edit).toHaveBeenCalledWith(data[0]);
    await user.click(screen.getByRole('button',{name:'删除 1'}));expect(remove).not.toHaveBeenCalled();
    await user.dblClick(screen.getByRole('button',{name:'确认删除'}));expect(remove).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledWith(['1']);
    reject(new Error('Cannot delete'));await waitFor(()=>expect(screen.getAllByRole('alert').some(e=>e.textContent==='Cannot delete')).toBe(true));
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });
  it('exports raw values safely and respects column visibility', async () => {
    const user=userEvent.setup(), onExport=vi.fn();render(<DataTable data={[{id:'1',name:'=SUM(A1)',value:3}]} columns={columns} getRowId={getRowId} onExport={onExport} />);
    await user.click(screen.getByRole('button',{name:'导出筛选结果'}));expect(onExport.mock.lastCall?.[0].csv).toContain("'=SUM(A1)");
    await user.click(screen.getByRole('button',{name:'显示列'}));await user.click(screen.getByRole('menuitemcheckbox',{name:'Value'}));await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button',{name:'导出筛选结果'}));expect(onExport.mock.lastCall?.[0].csv).not.toContain('Value');
  });
  it('renders loading, empty and failure states without fake mutation controls', () => {
    const {rerender}=render(<DataTable data={[]} columns={columns} getRowId={getRowId} loading />);expect(screen.getByText('加载中…')).toBeVisible();
    rerender(<DataTable data={[]} columns={columns} getRowId={getRowId} />);expect(screen.getByText('暂无数据')).toBeVisible();expect(screen.queryByRole('button',{name:'新增'})).toBeNull();
    rerender(<DataTable data={[]} columns={columns} getRowId={getRowId} error="offline" />);expect(screen.getByRole('alert')).toHaveTextContent('offline');
  });
  it('supports controlled server pages while preserving selected IDs', async () => {
    const user=userEvent.setup(), changed=vi.fn();
    function Server() {const [query,setQuery]=useState<TableQuery>({pagination:{pageIndex:0,pageSize:10},sorting:[],filters:[],search:''});return <DataTable data={query.pagination.pageIndex===0?data.slice(0,10):data.slice(10)} columns={columns} getRowId={getRowId} mode="server" rowCount={12} query={query} onQueryChange={q=>{setQuery(q);changed(q);}} />;}
    render(<Server />);await user.click(screen.getByRole('checkbox',{name:'选择行 1'}));await user.click(screen.getByRole('button',{name:'下一页'}));
    expect(screen.getByText('Row 12')).toBeVisible();expect(screen.getByText(/已选 1 条/)).toBeVisible();expect(changed.mock.lastCall?.[0].pagination.pageIndex).toBe(1);
  });
  it('supports grouped column filters with one page selection control', async () => {
    const user=userEvent.setup();render(<DataTable data={data} columns={[{header:'Metrics',columns}]} getRowId={getRowId} />);
    expect(screen.getAllByRole('checkbox',{name:'选择当前页'})).toHaveLength(1);
    await user.type(screen.getByRole('spinbutton',{name:'Value 最小值'}),'11');
    expect(screen.queryByText('Row 01')).toBeNull();expect(screen.getByText('Row 11')).toBeVisible();
  });
  it('rejects duplicate IDs and incomplete server contracts', () => {
    expect(()=>render(<DataTable data={[data[0],data[0]]} columns={columns} getRowId={getRowId} />)).toThrow(/unique stable/);
    expect(()=>render(<DataTable data={data} columns={columns} getRowId={getRowId} mode="server" />)).toThrow(/Server DataTable/);
  });
});
