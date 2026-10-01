import {FileService,createFileHandler,createDrizzleFileRepository,type FileHTTPOptions} from '@project/storage';
import {createConfiguredStorage} from '@project/storage/configured';
import type {Database} from '@project/database-{{datastore}}';
export async function createProjectFiles(options:Pick<FileHTTPOptions,'authenticate'|'trustedOrigins'|'allowCredentials'>&{database:Database}){
 const router=await createConfiguredStorage(),repository=createDrizzleFileRepository(options.database),service=new FileService({router,repository});
 return {service,handler:createFileHandler({...options,service})};
}
