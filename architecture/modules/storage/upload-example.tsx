"use client";
import {useMemo,useState} from "react";
import {createFileClient,type FileInfo} from "../lib/file-client";
import {FileUpload} from "@/components/advanced/file-upload";
import {DataTable} from "@/components/data-table/data-table";
// Pass authenticated headers or choose credentials:'include' for a trusted cross-origin cookie API.
export function FileUploadExample({baseURL="/files",headers}:{baseURL?:string;headers?:()=>HeadersInit}){
 const client=useMemo(()=>createFileClient({baseURL,headers}),[baseURL,headers]),[files,setFiles]=useState<FileInfo[]>([]);
 return <div className="space-y-6"><FileUpload client={client} onUploaded={file=>setFiles(previous=>[...previous.filter(v=>v.id!==file.id),file])}/><DataTable data={files} getRowId={file=>file.id} columns={[{accessorKey:"name",header:"文件名"},{accessorKey:"size",header:"大小"},{accessorKey:"contentType",header:"类型"}]} onDelete={async ids=>{for(const id of ids){await client.delete(id);setFiles(previous=>previous.filter(f=>f.id!==id));}}}/></div>;
}
