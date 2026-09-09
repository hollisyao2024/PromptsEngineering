import {setupWorker} from 'msw/browser';
import {handlers} from './handlers.ts';
import type {RequestHandler} from 'msw';
export async function startMockWorker(options:{enabled:boolean;serviceWorkerUrl:string;handlers?:RequestHandler[]}){
 if(!options.enabled)return undefined;
 const url=new URL(options.serviceWorkerUrl,location.origin);if(url.origin!==location.origin)throw new Error('Mock worker must be same-origin');
 const worker=setupWorker(...(options.handlers||[]),...handlers);await worker.start({serviceWorker:{url:url.href},onUnhandledRequest:'bypass'});return worker;
}
