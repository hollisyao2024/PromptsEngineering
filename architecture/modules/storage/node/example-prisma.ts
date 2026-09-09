import {FileService,createFileHandler,createPrismaFileRepository,type FileHTTPOptions} from '@project/storage';
import {createConfiguredStorage} from '@project/storage/configured';
import type {PrismaClient} from '@project/database-{{datastore}}';
// Project owns database connection lifecycle; this adapter does not create or disconnect it.
export async function createProjectFiles(options:Pick<FileHTTPOptions,'authenticate'|'trustedOrigins'|'allowCredentials'>&{database:PrismaClient}){
 const router=await createConfiguredStorage(),repository=createPrismaFileRepository(options.database.fileObject);
 const service=new FileService({router,repository});
 return {service,handler:createFileHandler({...options,service})};
}
