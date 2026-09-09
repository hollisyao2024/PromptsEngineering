import {createAuthClient} from 'better-auth/react';
import {organizationClient} from 'better-auth/client/plugins';
// Keep this package separate from the UI test package: Better Auth's optional Vitest peer is <=4.
export function createProjectAuthClient(baseURL:string){
 const url=new URL(baseURL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid auth URL');
 return createAuthClient({baseURL:url.href,plugins:[organizationClient()]});
}
export function createIdentityPort(client:ReturnType<typeof createProjectAuthClient>){
 return {
  async session(){const r=await client.getSession();if(r.error)throw new Error(r.error.code);return r.data?{user:{id:r.data.user.id,name:r.data.user.name},organizationId:r.data.session.activeOrganizationId}:null;},
  async signIn(email:string,password:string){const r=await client.signIn.email({email,password});if(r.error)throw new Error(r.error.code);},
  async signOut(){const r=await client.signOut();if(r.error)throw new Error(r.error.code);},
  async organizations(){const r=await client.organization.list();if(r.error)throw new Error(r.error.code);return (r.data||[]).map(o=>({id:o.id,name:o.name}));},
  async selectOrganization(id:string){const r=await client.organization.setActive({organizationId:id});if(r.error)throw new Error(r.error.code);}
 };
}
