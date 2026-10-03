import {betterAuth} from 'better-auth';
import {drizzleAdapter} from '@better-auth/drizzle-adapter';
import * as schema from '@project/database-{{datastore}}';
import {organization,bearer} from 'better-auth/plugins';
import {softDeleteAdapter,xirangAudit} from './audit.ts';
export {softDeleteAdapter,xirangAudit} from './audit.ts';
export {toNodeHandler,fromNodeHeaders} from 'better-auth/node';
export interface AuthConfiguration {
 database:Parameters<typeof drizzleAdapter>[0];
 secret:string;baseURL:string;trustedOrigins:readonly string[];
 allowSignUp?:boolean;
}
// Scope choices are explicit: email/password, organization membership and signed bearer sessions.
// Identity tables follow the data semantics (ADR-035): xirangAudit() must stay after organization().
// OAuth and email delivery are project integrations, not enabled by placeholder credentials.
export function createAuth(options:AuthConfiguration){
 if(options.secret.length<32)throw new Error('AUTH_SECRET must contain at least 32 random characters');
 const base=new URL(options.baseURL);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Auth requires HTTPS outside local development');
 const origins=options.trustedOrigins.map(o=>{const u=new URL(o);if(u.origin!==o||u.username||u.password||!['http:','https:'].includes(u.protocol))throw new Error('Invalid auth trusted origin');return o;});
 return betterAuth({database:softDeleteAdapter(drizzleAdapter(options.database,{provider:'{{drizzleProvider}}',schema})),secret:options.secret,baseURL:base.href,trustedOrigins:origins,
  emailAndPassword:{enabled:true,disableSignUp:!options.allowSignUp},plugins:[organization(),bearer(),xirangAudit()],logger:{disabled:true}});
}
