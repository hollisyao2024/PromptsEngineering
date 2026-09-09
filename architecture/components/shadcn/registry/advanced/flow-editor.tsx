"use client";
import {ReactFlow,ReactFlowProvider,Background,applyNodeChanges,applyEdgeChanges,addEdge,useReactFlow,type Node,type Edge} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {Button} from "@/components/ui/button";
export type {Node,Edge} from "@xyflow/react";
export function FlowEditor({nodes,edges,onChange,readOnly=false,label="流程画布"}:{nodes:Node[];edges:Edge[];onChange:(value:{nodes:Node[];edges:Edge[]})=>void;readOnly?:boolean;label?:string}){
 return <ReactFlowProvider><section className="relative h-96 rounded-lg border" aria-label={label}>
  <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={!readOnly} deleteKeyCode={readOnly?null:["Backspace","Delete"]} onNodesChange={changes=>{if(!readOnly)onChange({nodes:applyNodeChanges(changes,nodes),edges});}} onEdgesChange={changes=>{if(!readOnly)onChange({nodes,edges:applyEdgeChanges(changes,edges)});}} onConnect={connection=>{if(!readOnly)onChange({nodes,edges:addEdge(connection,edges)});}}><Background/><FlowTools/></ReactFlow>
 </section></ReactFlowProvider>;
}
function FlowTools(){const flow=useReactFlow();return <div className="absolute bottom-2 left-2 z-10 flex gap-1 rounded-md bg-background p-1" role="toolbar" aria-label="画布视图"><Button size="sm" variant="outline" onClick={()=>void flow.zoomIn()}>放大</Button><Button size="sm" variant="outline" onClick={()=>void flow.zoomOut()}>缩小</Button><Button size="sm" variant="outline" onClick={()=>void flow.fitView()}>适应画布</Button></div>;}
