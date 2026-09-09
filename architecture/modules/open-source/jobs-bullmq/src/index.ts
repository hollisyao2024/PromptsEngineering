import {Queue,Worker,createPostgresBackend,runMigrations,type ConnectionOptions} from 'bullmq';
import {validateJob,jobID,queueSchema,type JobDefinition} from './contracts.ts';
import {poolForMigration} from './migration-connection.ts';
export type {JobDefinition} from './contracts.ts';
export interface QueueConfiguration {connection:ConnectionOptions;onError:(error:Error)=>void}
const postgres=String('{{backend}}')==='postgres';
export async function prepareJobs(connectionString:string,schema='bullmq'){
 if(!postgres)throw new Error('Redis queues do not require SQL migrations');
 const pool=poolForMigration(connectionString),client=await pool.connect();try{await runMigrations(client,queueSchema(schema));}finally{client.release();await pool.end();}
}
export function createJobs<T>(definition:JobDefinition<T>,options:QueueConfiguration){
 if(!/^[a-z][a-z0-9-]{0,62}$/.test(definition.name))throw new Error('Invalid job name');
 const backend=postgres?createPostgresBackend:undefined,queue=new Queue(definition.name,{connection:options.connection},backend);
 queue.on('error',options.onError);const workers:Array<{close():Promise<void>}>=[];let closed=false;
 return {
  ready:()=>queue.waitUntilReady(),
  async enqueue(payload:unknown,id:string){if(closed)throw new Error('Queue closed');return queue.add(definition.name,validateJob(definition,payload),{jobId:jobID(id),attempts:4,backoff:{type:'exponential',delay:1000}});},
  work(handler:(data:T,job:{id:string;attempt:number})=>Promise<unknown>,concurrency=1){if(closed||!Number.isInteger(concurrency)||concurrency<1||concurrency>64)throw new Error('Invalid worker state/concurrency');const worker=new Worker(definition.name,j=>handler(validateJob(definition,j.data),{id:j.id!,attempt:j.attemptsMade}),{connection:options.connection,concurrency},backend);worker.on('error',options.onError);workers.push(worker);return worker;},
  async cancel(id:string){const job=await queue.getJob(jobID(id));if(!job)return;await job.remove();},
  async close(){if(closed)return;closed=true;await Promise.all(workers.map(w=>w.close()));await queue.close();}
 };
}
