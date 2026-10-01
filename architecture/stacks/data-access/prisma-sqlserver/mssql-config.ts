// JDBC-style Prisma SQL Server URL, including brace-escaped values. Unknown options fail closed.
export function mssqlConfig(url:string){
 const match=/^sqlserver:\/\/([^;]+)(.*)$/.exec(url);if(!match)throw Error('SQL Server URL required');
 const host=new URL('http://'+match[1]),fields:Record<string,string>={};let rest=match[2];
 while(rest){const m=/^;\s*([^=;]+)=(?:\{((?:[^}]|}})*)\}|([^;]*))/.exec(rest);if(!m)throw Error('Invalid SQL Server URL options');const key=m[1].trim().toLowerCase();if(key in fields)throw Error('Duplicate SQL Server URL option');fields[key]=m[2]===undefined?m[3]:m[2].replaceAll('}}','}');rest=rest.slice(m[0].length);}
 const allowed=['database','user','username','password','encrypt','trustservercertificate','schema'];if(Object.keys(fields).some(k=>!allowed.includes(k)))throw Error('Unsupported SQL Server URL option; configure a project adapter for advanced authentication');
 const bool=(k:string,defaultValue:boolean)=>{if(fields[k]===undefined)return defaultValue;if(!['true','false'].includes(fields[k]))throw Error('Invalid SQL Server boolean option');return fields[k]==='true';};
 if(!fields.database)throw Error('Explicit SQL Server database required');
 if(host.username||host.password||host.pathname!=='/'||host.search||host.hash)throw Error('Invalid SQL Server host');
 if(fields.user&&fields.username&&fields.user!==fields.username)throw Error('Conflicting SQL Server usernames');
 if(fields.schema&&fields.schema!=='dbo')throw Error('SQL Server template schema must be dbo');
 return {server:host.hostname,port:Number(host.port)||1433,database:fields.database,user:fields.user||fields.username,password:fields.password,options:{encrypt:bool('encrypt',true),trustServerCertificate:bool('trustservercertificate',false)},pool:{max:10,min:0,idleTimeoutMillis:30000}};
}
