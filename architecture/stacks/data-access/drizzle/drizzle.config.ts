import {defineConfig} from 'drizzle-kit';
// Offline generation deliberately has no connection credentials. Deploy uses the guarded migrator.
export default defineConfig({dialect:'{{dialect}}',schema:'./src/schema/*.ts',out:'./drizzle',strict:true});
