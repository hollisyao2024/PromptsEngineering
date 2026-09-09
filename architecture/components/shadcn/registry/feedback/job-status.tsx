"use client";
import {Badge} from "@/components/ui/badge";
import {Progress} from "@/components/ui/progress";
import {AsyncActionButton} from "@/components/feedback/async-action-button";
const labels={waiting:"等待执行",active:"执行中",completed:"已完成",failed:"执行失败",cancelled:"已取消"};
export interface JobStatusValue {id:string;state:keyof typeof labels;progress?:number}
// Project API must authorize job ownership before returning status or accepting cancel/retry.
export function JobStatus({job,onCancel,onRetry}:{job:JobStatusValue;onCancel?:()=>Promise<void>;onRetry?:()=>Promise<void>}){
 return <section className="flex flex-wrap items-center gap-2" aria-label={"任务 "+job.id}><Badge aria-live="polite">{labels[job.state]}</Badge>{job.progress!==undefined&&<Progress className="w-32" aria-label="任务进度" value={Math.max(0,Math.min(100,job.progress))}/>} {job.state==="waiting"&&onCancel&&<AsyncActionButton variant="outline" onAction={onCancel}>取消任务</AsyncActionButton>}{job.state==="failed"&&onRetry&&<AsyncActionButton onAction={onRetry}>重试任务</AsyncActionButton>}</section>;
}
