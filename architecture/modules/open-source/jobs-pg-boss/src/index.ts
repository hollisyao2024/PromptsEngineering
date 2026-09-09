import {PgBoss,fromPrisma} from 'pg-boss';
import {validateJob,jobID,queueSchema,type JobDefinition} from './contracts.ts';
export type {JobDefinition} from './contracts.ts';
export interface QueueConfiguration {connectionString:string;schema?:string;onError:(error:Error)=>void}
export async function prepareJobs(options:QueueConfiguration){
 const boss=new PgBoss({connectionString:options.connectionString,schema:queueSchema(options.schema||'pgboss'),migrate:true});boss.on('error',options.onError);try{await boss.start();}finally{await boss.stop();}
}
export async function createJobs(options:QueueConfiguration){
 const boss=new PgBoss({connectionString:options.connectionString,schema:queueSchema(options.schema||'pgboss'),migrate:false});boss.on('error',options.onError);await boss.start();
 const sendOptions={retryLimit:3,retryDelay:1,retryBackoff:true,expireInSeconds:300};
 return {
  async define<T>(definition:JobDefinition<T>){validateJobName(definition.name);await boss.createQueue(definition.name,sendOptions);},
  async enqueue<T>(definition:JobDefinition<T>,payload:unknown,id:string){return boss.send(definition.name,validateJob(definition,payload) as object,{...sendOptions,id:pgJobID(id)});},
  // Transaction must use the same PostgreSQL database as this queue.
  async enqueueInTransaction<T>(transaction:Parameters<typeof fromPrisma>[0],definition:JobDefinition<T>,payload:unknown,id:string){return boss.send(definition.name,validateJob(definition,payload) as object,{...sendOptions,id:pgJobID(id),db:fromPrisma(transaction)});},
  async work<T>(definition:JobDefinition<T>,handler:(data:T,job:{id:string})=>Promise<void>){return boss.work(definition.name,{batchSize:1},async jobs=>{for(const job of jobs)await handler(validateJob(definition,job.data),{id:job.id});});},
  async cancel(name:string,id:string){validateJobName(name);return boss.cancel(name,pgJobID(id));},
  close:()=>boss.stop({graceful:true,timeout:30000})
 };
}
function validateJobName(name:string){if(!/^[a-z][a-z0-9-]{0,62}$/.test(name))throw new Error('Invalid job name');}
function pgJobID(id:string){jobID(id);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('pg-boss requires a UUID job id');return id;}
