"use client";
import {useVirtualizer} from "@tanstack/react-virtual";
import {DataTable,type DataTableProps,type DataTableRowsProps} from "@/components/data-table/data-table";
import {TableRow,TableCell} from "@/components/ui/table";
export function VirtualDataTable<T>({height=480,...props}:Omit<DataTableProps<T>,"rowRenderer"|"viewportHeight">&{height?:number}){
 return <DataTable {...props} viewportHeight={height} rowRenderer={VirtualRows}/>;
}
function VirtualRows<T>({rows,renderRow,columnCount,getScrollElement}:DataTableRowsProps<T>){
 const virtual=useVirtualizer({count:rows.length,getScrollElement,estimateSize:()=>48,overscan:8,getItemKey:index=>rows[index].id});
 const items=virtual.getVirtualItems(),before=items[0]?.start||0,after=items.length?Math.max(0,virtual.getTotalSize()-items[items.length-1].end):0;
 return <>{before>0&&<TableRow aria-hidden="true"><TableCell colSpan={columnCount} style={{height:before,padding:0}}/></TableRow>}
  {items.map(item=>renderRow(rows[item.index],item.index,virtual.measureElement))}
  {after>0&&<TableRow aria-hidden="true"><TableCell colSpan={columnCount} style={{height:after,padding:0}}/></TableRow>}</>;
}
