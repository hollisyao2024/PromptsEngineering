"use client";
import {useId} from "react";
import {Bar,BarChart,CartesianGrid,XAxis} from "recharts";
import {ChartContainer,ChartTooltip,ChartTooltipContent} from "@/components/ui/chart";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
export function MetricChart({title,data,label="数量"}:{title:string;data:{label:string;value:number}[];label?:string}){
 const id=useId();if(data.some(d=>!Number.isFinite(d.value)))throw new Error("Chart values must be finite");
 return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>
  {data.length?<><ChartContainer className="h-64 w-full" config={{value:{label,color:"var(--chart-1)"}}} aria-describedby={id}><BarChart data={data} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="label"/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="value" fill="var(--color-value)" radius={4}/></BarChart></ChartContainer><ul id={id} className="sr-only">{data.map((d,i)=><li key={i}>{d.label}：{d.value}</li>)}</ul></>:<p className="p-6 text-muted-foreground">暂无图表数据</p>}
 </CardContent></Card>;
}
