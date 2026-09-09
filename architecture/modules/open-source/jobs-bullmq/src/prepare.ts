import {prepareJobs} from './index.ts';
if(process.env.XIRANG_APPLY_QUEUE_MIGRATIONS!=='1')throw new Error('Explicit XIRANG_APPLY_QUEUE_MIGRATIONS=1 is required');
const connectionString=process.env.JOBS_DATABASE_URL;if(!connectionString)throw new Error('JOBS_DATABASE_URL is required');
await prepareJobs(connectionString,process.env.JOBS_SCHEMA);
