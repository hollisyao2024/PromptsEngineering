"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
import {Alert,AlertDescription} from "@/components/ui/alert";
export interface IdentitySession {user:{id:string;name:string};organizationId?:string|null}
export interface IdentityPort {session:()=>Promise<IdentitySession|null>;signIn:(email:string,password:string)=>Promise<void>;signOut:()=>Promise<void>;organizations:()=>Promise<{id:string;name:string}[]>;selectOrganization:(id:string)=>Promise<void>}
export function IdentityPanel({client,onSessionChange}:{client:IdentityPort;onSessionChange?:(session:IdentitySession|null)=>void}){
 const [session,setSession]=useState<IdentitySession|null>(null),[organizations,setOrganizations]=useState<{id:string;name:string}[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState("");
 const generation=useRef(0),pending=useRef(false);
 const refresh=async(version:number)=>{const value=await client.session(),orgs=value?await client.organizations():[];if(version!==generation.current)return;setSession(value);setOrganizations(orgs);onSessionChange?.(value);};
 useEffect(()=>{const version=++generation.current;setBusy(true);setError("");void refresh(version).catch(()=>{if(version===generation.current)setError("身份信息加载失败");}).finally(()=>{if(version===generation.current)setBusy(false);});return()=>{generation.current++;};},[client]);
 const run=async(action:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;const version=generation.current;setBusy(true);setError("");try{await action();await refresh(version);}catch{if(version===generation.current)setError("操作失败，请检查输入或重试");}finally{pending.current=false;if(version===generation.current){setBusy(false);setPassword("");}}};
 return <section className="space-y-3" aria-label="用户身份" aria-busy={busy}>
  {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  {session?<><p>当前用户：{session.user.name}</p>{organizations.length>0&&<Select value={session.organizationId||""} disabled={busy} onValueChange={id=>void run(()=>client.selectOrganization(id))}><SelectTrigger aria-label="当前组织"><SelectValue placeholder="选择组织"/></SelectTrigger><SelectContent>{organizations.map(o=><SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select>}<Button disabled={busy} variant="outline" onClick={()=>void run(()=>client.signOut())}>退出登录</Button></>:
  <form className="space-y-3" onSubmit={event=>{event.preventDefault();void run(()=>client.signIn(email,password));}}><Label>邮箱<Input aria-label="登录邮箱" autoComplete="username" type="email" required disabled={busy} value={email} onChange={event=>setEmail(event.target.value)}/></Label><Label>密码<Input aria-label="登录密码" autoComplete="current-password" type="password" required disabled={busy} value={password} onChange={event=>setPassword(event.target.value)}/></Label><Button type="submit" disabled={busy}>登录</Button></form>}
 </section>;
}
