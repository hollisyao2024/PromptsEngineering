"use client";
import {type ReactNode} from "react";
import {DragDropProvider} from "@dnd-kit/react";
import {useSortable} from "@dnd-kit/react/sortable";
import {move} from "@dnd-kit/helpers";
import {Button} from "@/components/ui/button";
import {GripVertical,ArrowUp,ArrowDown} from "lucide-react";
export function SortableList<T>({items,getId,renderItem,onChange,disabled=false}:{items:T[];getId:(item:T)=>string;renderItem:(item:T)=>ReactNode;onChange:(items:T[])=>void;disabled?:boolean}){
 const ids=items.map(getId);if(new Set(ids).size!==ids.length||ids.some(id=>!id))throw new Error("SortableList requires unique IDs");
 const reorder=(from:number,to:number)=>{if(disabled||to<0||to>=items.length)return;const next=[...items];next.splice(to,0,...next.splice(from,1));onChange(next);};
 return <DragDropProvider onDragEnd={event=>{if(disabled||event.canceled)return;const next=move(ids,event);onChange(next.map(id=>items[ids.indexOf(id)]));}}>
  <ul className="space-y-2" aria-label="可排序列表">{items.map((item,index)=><SortableItem key={ids[index]} id={ids[index]} index={index} disabled={disabled}><div className="min-w-0 flex-1">{renderItem(item)}</div><Button size="icon-sm" variant="ghost" aria-label={"上移 "+ids[index]} disabled={disabled||index===0} onClick={()=>reorder(index,index-1)}><ArrowUp/></Button><Button size="icon-sm" variant="ghost" aria-label={"下移 "+ids[index]} disabled={disabled||index===items.length-1} onClick={()=>reorder(index,index+1)}><ArrowDown/></Button></SortableItem>)}</ul>
 </DragDropProvider>;
}
function SortableItem({id,index,children,disabled}:{id:string;index:number;children:ReactNode;disabled:boolean}){
 const {ref,handleRef,isDragging}=useSortable({id,index,disabled});return <li ref={ref} className="flex items-center gap-2 rounded-md border p-2" style={{opacity:isDragging?0.5:1}}><Button ref={handleRef} size="icon-sm" variant="ghost" aria-label={"拖动 "+id} disabled={disabled}><GripVertical/></Button>{children}</li>;
}
