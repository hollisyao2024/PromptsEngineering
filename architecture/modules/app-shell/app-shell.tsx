"use client";
import {Component,useState,type ErrorInfo,type ReactNode} from 'react';
import {ThemeProvider,useTheme} from 'next-themes';
import {Button} from '@project/ui/ui/button';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetTrigger} from '@project/ui/ui/sheet';
export interface NavigationItem {id:string;label:string;href:string;}
function ThemeToggle() {
  const {resolvedTheme,setTheme}=useTheme();
  return <Button variant="outline" className="min-h-11" onClick={()=>setTheme(resolvedTheme==='dark'?'light':'dark')}>切换主题</Button>;
}
class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(_error:Error,_info:ErrorInfo){/* Project may inject telemetry without user data. */}
  render(){return this.state.failed?<div role="alert" className="p-6"><p>页面暂时无法显示。</p><Button onClick={()=>this.setState({failed:false})}>重试</Button></div>:this.props.children;}
}
export function AppShell({title,items,current,children}:{title:string;items:NavigationItem[];current:string;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  const nav=<nav aria-label="主导航" className="flex flex-col gap-2 p-4">{items.map(item=><Button key={item.id} variant={current===item.id?'secondary':'ghost'} className="min-h-11 justify-start" asChild><a href={item.href} aria-current={current===item.id?'page':undefined} onClick={()=>setOpen(false)}>{item.label}</a></Button>)}</nav>;
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem><div className="min-h-dvh bg-background text-foreground md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
    <aside className="hidden border-r md:block">{nav}</aside><div className="min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="md:hidden"><Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button className="min-h-11" variant="outline">导航</Button></SheetTrigger><SheetContent side="left"><SheetHeader><SheetTitle>应用导航</SheetTitle></SheetHeader>{nav}</SheetContent></Sheet></div>
        <h1 className="text-xl font-semibold">{title}</h1><ThemeToggle/>
      </header><main className="min-w-0 p-4 md:p-6"><ErrorBoundary>{children}</ErrorBoundary></main>
    </div></div></ThemeProvider>;
}
