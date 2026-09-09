export interface ServerConfig {port:number;host:string;writeToken:string;corsOrigins:Set<string>;profile:'development'|'test'|'production';}
export function readServerConfig(env:NodeJS.ProcessEnv=process.env):ServerConfig {
  const profile=env.NODE_ENV||'development';
  if(!['development','test','production'].includes(profile))throw new Error('Unsupported NODE_ENV profile');
  const port=Number(env.PORT||3000),host=env.HOST||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const token=env.API_WRITE_TOKEN||'';
  if(token && token.length<24)throw new Error('API_WRITE_TOKEN must have at least 24 characters');
  if(profile==='production'&&!token)throw new Error('Production API_WRITE_TOKEN required; replace sample auth with project identity policy');
  const origins=(env.CORS_ORIGINS||'http://127.0.0.1:5173,http://localhost:1420,tauri://localhost,http://tauri.localhost').split(',').filter(Boolean);
  for(const origin of origins)if(origin==='*'||new URL(origin).origin!==origin && origin!=='tauri://localhost')throw new Error('CORS_ORIGINS must contain exact origins');
  return {port,host,writeToken:token,corsOrigins:new Set(origins),profile:profile as ServerConfig['profile']};
}
