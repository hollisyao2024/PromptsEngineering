export interface JobDefinition<T>{name:string;parse:(value:unknown)=>T}
export function validateJob<T>(definition:JobDefinition<T>,value:unknown){if(!/^[a-z][a-z0-9-]{0,62}$/.test(definition.name))throw new Error('Invalid job name');const data=definition.parse(value);if(Buffer.byteLength(JSON.stringify(data))>65536)throw new Error('Job payload exceeds 64 KiB');return data;}
export function jobID(id:string){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error('Invalid stable job ID');return id;}
export function queueSchema(schema:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid queue schema');return schema;}
