import {NodeSDK} from '@opentelemetry/sdk-node';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {BatchSpanProcessor,type SpanExporter} from '@opentelemetry/sdk-trace-base';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {trace,SpanStatusCode} from '@opentelemetry/api';
let active:NodeSDK|undefined;
let started=false;
export interface TelemetryOptions {serviceName:string;endpoint?:string;exporter?:SpanExporter}
// No import-time registration, exporter, endpoint discovery or automatic request/body capture.
export function startTelemetry(options:TelemetryOptions){
 if(started||active)throw new Error('Telemetry has one lifecycle per process');if(!options.serviceName)throw new Error('serviceName is required');
 if(!options.exporter&&!options.endpoint)throw new Error('Choose an explicit telemetry exporter/endpoint');
 if(options.endpoint){const u=new URL(options.endpoint);if(u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Invalid telemetry endpoint');}
 const sdk=new NodeSDK({autoDetectResources:false,resource:resourceFromAttributes({'service.name':options.serviceName}),spanProcessors:[new BatchSpanProcessor(options.exporter||new OTLPTraceExporter({url:options.endpoint}))],instrumentations:[]});sdk.start();active=sdk;started=true;
 let closed=false;return {async shutdown(){if(closed)return;closed=true;try{await sdk.shutdown();}finally{if(active===sdk)active=undefined;}}};
}
export async function traced<T>(name:string,operation:()=>Promise<T>):Promise<T>{
 return trace.getTracer('project').startActiveSpan(name,async span=>{try{return await operation();}catch(error){span.setStatus({code:SpanStatusCode.ERROR});throw error;}finally{span.end();}});
}
