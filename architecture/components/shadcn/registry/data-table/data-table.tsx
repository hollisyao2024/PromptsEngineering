"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type ColumnFiltersState, type PaginationState, type RowData, type RowSelectionState,
  type SortingState, type VisibilityState, type Row,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { LoadingState, EmptyState, ErrorState } from "@/components/feedback/states";
import { MultiSelect } from "@/components/selectors/search-select";
import { DateRangePicker } from "@/components/selectors/date-picker";
import { validDateValue, validDateRange, type DateRangeValue } from "@/components/selectors/date-value";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ExportValue = string | number | boolean | null | undefined | Date;
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
    filterVariant?: "text" | "select" | "range" | "multi-select" | "date-range";
    filterOptions?: Array<{ value: string; label: string }>;
    exportValue?: (row: TData) => ExportValue;
    disableExport?: boolean;
  }
}
export interface TableQuery {
  pagination: PaginationState;
  sorting: SortingState;
  filters: ColumnFiltersState;
  search: string;
}
export interface ExportRequest<T> { scope: "page" | "filtered" | "selected"; rows: T[]; rowIds: string[]; query: TableQuery; csv: string; }
export interface DataTableRowsProps<T> {rows:Row<T>[]; renderRow:(row:Row<T>,index?:number,ref?:(element:HTMLTableRowElement|null)=>void)=>ReactNode; columnCount:number;getScrollElement:()=>HTMLElement|null;}
export interface DataTableProps<T> {
  rowRenderer?: (props:DataTableRowsProps<T>)=>ReactNode;
  viewportHeight?:number;
  data: T[];
  columns: ColumnDef<T, any>[];
  getRowId: (row: T) => string;
  mode?: "client" | "server";
  rowCount?: number;
  query?: TableQuery;
  onQueryChange?: (query: TableQuery) => void;
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  initialPageSize?: number;
  pageSizes?: number[];
  selectable?: boolean | ((row: T) => boolean);
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  onCreate?: () => void | Promise<void>;
  onEdit?: (row: T) => void | Promise<void>;
  onDelete?: (ids: string[]) => void | Promise<void>;
  canEdit?: (row: T) => boolean;
  canDelete?: (row: T) => boolean;
  onExport?: (request: ExportRequest<T>) => void | Promise<void>;
  exportScope?: "page" | "filtered" | "selected";
  exportFileName?: string;
  exportEnabled?: boolean;
  toolbar?: ReactNode;
  bulkActions?: Array<{ id: string; label: string; onClick: (ids: string[]) => void | Promise<void> }>;
}
const defaultQuery = (size: number): TableQuery => ({ pagination: { pageIndex: 0, pageSize: size }, sorting: [], filters: [], search: "" });
const csvCell = (value: ExportValue) => {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  // Treat formula-like text as literal, including leading whitespace/control characters.
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export function DataTable<T>({ data, columns, getRowId, mode = "client", rowCount, query: controlledQuery, onQueryChange,
  selection: controlledSelection, onSelectionChange, initialPageSize = 10, pageSizes = [10, 20, 50, 100], selectable = true,
  loading = false, error, onRetry, emptyMessage = "暂无数据", onCreate, onEdit, onDelete, canEdit, canDelete,
  onExport, exportScope = mode === "server" ? "page" : "filtered", exportFileName = "data.csv", exportEnabled = true, toolbar, bulkActions = [],
  rowRenderer:RowRenderer,viewportHeight,
}: DataTableProps<T>) {
  const viewport=useRef<HTMLDivElement>(null);
  if(viewportHeight!==undefined&&(!Number.isFinite(viewportHeight)||viewportHeight<100))throw new Error("Invalid table viewport height");
  if (mode === "server" && (!controlledQuery || !onQueryChange || !Number.isInteger(rowCount) || rowCount! < 0)) throw new Error("Server DataTable requires query, onQueryChange and non-negative rowCount");
  if (controlledQuery && !onQueryChange) throw new Error("Controlled query requires onQueryChange");
  if (controlledSelection && !onSelectionChange) throw new Error("Controlled selection requires onSelectionChange");
  if (!Number.isInteger(initialPageSize) || initialPageSize < 1) throw new Error("Invalid page size");
  if (mode === "server" && exportScope !== "page" && !onExport) throw new Error("Server filtered/selected export requires onExport");
  const [localQuery, setLocalQuery] = useState(() => defaultQuery(initialPageSize));
  const [localSelection, setLocalSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const [actionError, setActionError] = useState("");
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const query = controlledQuery || localQuery, selection = controlledSelection || localSelection;
  if (!Number.isInteger(query.pagination.pageIndex) || query.pagination.pageIndex < 0 || !Number.isInteger(query.pagination.pageSize) || query.pagination.pageSize < 1) throw new Error("Invalid pagination query");
  const changeQuery = (patch: Partial<TableQuery>, resetPage = false) => {
    const next = { ...query, ...patch };
    if (resetPage) next.pagination = { ...next.pagination, pageIndex: 0 };
    setLocalQuery(next); onQueryChange?.(next);
  };
  const changeSelection = (next: RowSelectionState) => { setLocalSelection(next); onSelectionChange?.(next); };
  const ids = useMemo(() => {
    const seen = new Set<string>();
    for (const row of data) { const id = getRowId(row); if (typeof id !== "string" || !id || seen.has(id)) throw new Error("DataTable requires unique stable row IDs"); seen.add(id); }
    return seen;
  }, [data, getRowId]);
  useEffect(() => {
    if (mode === "server") return;
    const next = Object.fromEntries(Object.entries(selection).filter(([id, checked]) => checked && ids.has(id)));
    if (Object.keys(next).length !== Object.keys(selection).length) changeSelection(next);
  }, [ids, mode, selection]);
  const table = useReactTable({ data, columns, getRowId,
    state: { pagination: query.pagination, sorting: query.sorting, columnFilters: query.filters, globalFilter: query.search, rowSelection: selection, columnVisibility: visibility },
    onPaginationChange: updater => changeQuery({ pagination: typeof updater === "function" ? updater(query.pagination) : updater }),
    onSortingChange: updater => changeQuery({ sorting: typeof updater === "function" ? updater(query.sorting) : updater }, true),
    onColumnFiltersChange: updater => changeQuery({ filters: typeof updater === "function" ? updater(query.filters) : updater }, true),
    onGlobalFilterChange: value => changeQuery({ search: value }, true),
    onRowSelectionChange: updater => changeSelection(typeof updater === "function" ? updater(selection) : updater),
    onColumnVisibilityChange: setVisibility,
    enableRowSelection: row => typeof selectable === "function" ? selectable(row.original) : selectable,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    manualPagination: mode === "server", manualSorting: mode === "server", manualFiltering: mode === "server", rowCount,
    autoResetPageIndex: false,
    defaultColumn: { filterFn: (row, columnId, value) => {
      const cell = row.getValue(columnId), variant = row.getAllCells().find(cell => cell.column.id === columnId)?.column.columnDef.meta?.filterVariant;
      if (variant === "range") { const [min, max] = value as [string, string]; const n = Number(cell); return cell != null && Number.isFinite(n) && (!min || n >= Number(min)) && (!max || n <= Number(max)); }
      if (variant === "multi-select") return !value?.length || value.includes(String(cell));
      if (variant === "date-range") return !value || (validDateRange(value) && validDateValue(String(cell), value.from, value.to));
      if (variant === "select") return !value || String(cell) === value;
      return String(cell ?? "").toLocaleLowerCase().includes(String(value ?? "").toLocaleLowerCase());
    } },
  });
  const total = mode === "server" ? rowCount! : table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(1, Math.ceil(total / query.pagination.pageSize));
  useEffect(() => { if (query.pagination.pageIndex >= pageCount && !loading) table.setPageIndex(pageCount - 1); }, [pageCount, query.pagination.pageIndex, loading]);
  const selectedIds = Object.keys(selection).filter(id => selection[id]);
  const selectedDeletableIds = canDelete ? table.getSelectedRowModel().rows.filter(row => canDelete(row.original)).map(row => row.id) : selectedIds;
  const run = async (action: () => void | Promise<void>) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setActionError("");
    try { await action(); return true; } catch (caught) { setActionError(caught instanceof Error ? caught.message : "操作失败，请重试"); return false; }
    finally { pending.current = false; setBusy(false); }
  };
  const exportData = () => run(async () => {
    const rows = exportScope === "page" ? table.getRowModel().rows : exportScope === "selected" ? table.getSelectedRowModel().rows : table.getSortedRowModel().rows;
    const visible = table.getVisibleLeafColumns().filter(column => column.accessorFn && !column.columnDef.meta?.disableExport);
    const csv = [visible.map(column => csvCell(column.columnDef.meta?.label || (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id))).join(","),
      ...rows.map(row => visible.map(column => csvCell(column.columnDef.meta?.exportValue ? column.columnDef.meta.exportValue(row.original) : row.getValue(column.id) as ExportValue)).join(","))].join("\r\n");
    const request = { scope: exportScope, rows: rows.map(row => row.original), rowIds: exportScope === "selected" ? selectedIds : rows.map(row => row.id), query, csv };
    if (onExport) { await onExport(request); return; }
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = exportFileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  const active = !loading && !busy && !error;
  const title = (column: ReturnType<typeof table.getAllLeafColumns>[number]) => column.columnDef.meta?.label || (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id);
  const renderRow=(row:Row<T>,index?:number,ref?:(element:HTMLTableRowElement|null)=>void)=><TableRow key={row.id} data-index={index} ref={ref} data-state={row.getIsSelected() ? "selected" : undefined}>
        {selectable && <TableCell><Checkbox aria-label={`选择行 ${row.id}`} checked={row.getIsSelected()} disabled={!active || !row.getCanSelect()} onCheckedChange={value => row.toggleSelected(!!value)} /></TableCell>}
        {row.getVisibleCells().map(cell => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
        {(onEdit || onDelete) && <TableCell><div className="flex gap-1">{onEdit && (!canEdit || canEdit(row.original)) && <Button variant="ghost" size="sm" disabled={!active} aria-label={`修改 ${row.id}`} onClick={() => void run(() => onEdit(row.original))}><Pencil />修改</Button>}{onDelete && (!canDelete || canDelete(row.original)) && <Button variant="ghost" size="sm" disabled={!active} aria-label={`删除 ${row.id}`} onClick={() => setDeleteIds([row.id])}><Trash2 />删除</Button>}</div></TableCell>}
      </TableRow>;
  return <div className="space-y-3" aria-busy={loading || busy}>
    <div className="flex flex-wrap items-center gap-2">
      <Input className="w-full sm:max-w-xs" aria-label="搜索表格" placeholder="搜索…" value={query.search} onChange={event => changeQuery({ search: event.target.value }, true)} />
      {onCreate && <Button disabled={!active} onClick={() => void run(onCreate)}><Plus />新增</Button>}
      {onDelete && selectedDeletableIds.length > 0 && <Button variant="destructive" disabled={!active} onClick={() => setDeleteIds(selectedDeletableIds)}><Trash2 />删除所选（{selectedDeletableIds.length}）</Button>}
      {bulkActions.map(action => <Button key={action.id} variant="outline" disabled={!active || !selectedIds.length} onClick={() => void run(() => action.onClick(selectedIds))}>{action.label}</Button>)}
      {exportEnabled && <Button variant="outline" disabled={!active} onClick={() => void exportData()}><Download />导出{exportScope === "page" ? "当前页" : exportScope === "selected" ? "所选" : "筛选结果"}</Button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><Columns3 />显示列</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        {table.getAllLeafColumns().filter(column => column.getCanHide()).map(column => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={value => column.toggleVisibility(!!value)}>{title(column)}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent></DropdownMenu>
      {toolbar}
    </div>
    <div className="flex flex-wrap gap-2" aria-label="列筛选">
      {table.getAllLeafColumns().filter(column => column.getCanFilter()).map(column => {
        const meta = column.columnDef.meta, label = title(column);
        if (meta?.filterVariant === "multi-select") return <MultiSelect key={column.id} label={`筛选 ${label}`} placeholder={`全部 ${label}`} options={meta.filterOptions || []} value={column.getFilterValue() as string[] || []} onChange={value => column.setFilterValue(value.length ? value : undefined)}/>;
        if (meta?.filterVariant === "date-range") return <DateRangePicker key={column.id} label={`筛选 ${label}`} value={column.getFilterValue() as DateRangeValue | undefined} onChange={value => column.setFilterValue(value)}/>;
        if (meta?.filterVariant === "select") return <Select key={column.id} value={column.getFilterValue() === undefined ? "__all__" : `value:${String(column.getFilterValue())}`} onValueChange={value => column.setFilterValue(value === "__all__" ? undefined : value.slice(6))}><SelectTrigger aria-label={`筛选 ${label}`}><SelectValue placeholder={label} /></SelectTrigger><SelectContent><SelectItem value="__all__">全部 {label}</SelectItem>{meta.filterOptions?.map(option => <SelectItem key={option.value} value={`value:${option.value}`}>{option.label}</SelectItem>)}</SelectContent></Select>;
        if (meta?.filterVariant === "range") { const range = column.getFilterValue() as [string,string] || ["",""]; return <div key={column.id} className="flex gap-1"><Input className="w-28" type="number" aria-label={`${label} 最小值`} placeholder={`${label} 最小`} value={range[0]} onChange={e => column.setFilterValue([e.target.value, range[1]])} /><Input className="w-28" type="number" aria-label={`${label} 最大值`} placeholder="最大" value={range[1]} onChange={e => column.setFilterValue([range[0], e.target.value])} /></div>; }
        return <Input key={column.id} className="w-40" aria-label={`筛选 ${label}`} placeholder={`筛选 ${label}`} value={String(column.getFilterValue() ?? "")} onChange={event => column.setFilterValue(event.target.value)} />;
      })}
      {(query.filters.length > 0 || query.search) && <Button variant="ghost" onClick={() => changeQuery({ filters: [], search: "" }, true)}>清除筛选</Button>}
    </div>
    {(error || (actionError && !deleteIds)) && <ErrorState error={error || actionError} onRetry={error ? onRetry : undefined}/>}
    <div ref={viewport} className="overflow-auto rounded-lg border" style={{maxHeight:viewportHeight}}><Table>
      <TableHeader>{table.getHeaderGroups().map((group, groupIndex) => <TableRow key={group.id}>
        {selectable && groupIndex === 0 && <TableHead className="w-10" rowSpan={table.getHeaderGroups().length}><Checkbox aria-label="选择当前页" disabled={!active} checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() ? "indeterminate" : false)} onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)} /></TableHead>}
        {group.headers.map(header => <TableHead key={header.id} colSpan={header.colSpan} aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"}>{header.isPlaceholder ? null : header.column.getCanSort() ? <Button variant="ghost" size="sm" aria-label={`排序 ${title(header.column)}`} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === "asc" ? <ArrowUp /> : header.column.getIsSorted() === "desc" ? <ArrowDown /> : <ArrowUpDown />}</Button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}
        {(onEdit || onDelete) && groupIndex === 0 && <TableHead rowSpan={table.getHeaderGroups().length}>操作</TableHead>}
      </TableRow>)}</TableHeader>
      <TableBody>{loading || error || table.getRowModel().rows.length === 0 ? <TableRow><TableCell colSpan={Math.max(1,table.getVisibleLeafColumns().length + (selectable ? 1 : 0) + (onEdit || onDelete ? 1 : 0))} className="h-24 text-center text-muted-foreground">{loading ? <LoadingState/> : <EmptyState title={error ? "数据加载失败" : emptyMessage}/>}</TableCell></TableRow> : (RowRenderer ? <RowRenderer rows={table.getRowModel().rows} renderRow={renderRow} columnCount={table.getVisibleLeafColumns().length+(selectable?1:0)+(onEdit||onDelete?1:0)} getScrollElement={()=>viewport.current}/> : table.getRowModel().rows.map(row=>renderRow(row)))}</TableBody>
    </Table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <div aria-live="polite">共 {total} 条 · 已选 {selectedIds.length} 条{mode === "server" && selectedIds.length > 0 && "（按 ID 跨页保留）"}{selectedIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => changeSelection({})}>清空选择</Button>}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(query.pagination.pageSize)} onValueChange={size => changeQuery({ pagination: { pageIndex: 0, pageSize: Number(size) } })}><SelectTrigger aria-label="每页条数"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([...pageSizes.filter(n => Number.isInteger(n) && n > 0),query.pagination.pageSize])].sort((a,b)=>a-b).map(size => <SelectItem key={size} value={String(size)}>{size} 条 / 页</SelectItem>)}</SelectContent></Select>
        <span>第 {query.pagination.pageIndex + 1} / {pageCount} 页</span>
        <Button variant="outline" size="icon-sm" aria-label="首页" disabled={!active || !table.getCanPreviousPage()} onClick={() => table.firstPage()}><ChevronsLeft /></Button>
        <Button variant="outline" size="icon-sm" aria-label="上一页" disabled={!active || !table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft /></Button>
        <Button variant="outline" size="icon-sm" aria-label="下一页" disabled={!active || query.pagination.pageIndex + 1 >= pageCount} onClick={() => table.nextPage()}><ChevronRight /></Button>
        <Button variant="outline" size="icon-sm" aria-label="末页" disabled={!active || query.pagination.pageIndex + 1 >= pageCount} onClick={() => table.setPageIndex(pageCount - 1)}><ChevronsRight /></Button>
      </div>
    </div>
    <ConfirmDialog open={deleteIds !== null} onOpenChange={open => { if (!open && !pending.current) setDeleteIds(null); }} title={`确认删除 ${deleteIds?.length || 0} 条记录？`} description="确认后将调用项目提供的删除操作，请核对选中范围。" confirmLabel="确认删除" pending={busy} error={actionError} onConfirm={() => run(async () => { const ids = deleteIds || []; await onDelete?.(ids); changeSelection(Object.fromEntries(Object.entries(selection).filter(([id]) => !ids.includes(id)))); })}/>

  </div>;
}
