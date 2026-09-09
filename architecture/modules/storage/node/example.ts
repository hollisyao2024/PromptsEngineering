import {FileService,createFileHandler,createFileRepository,type FileHTTPOptions} from '@project/storage';
import {createConfiguredStorage} from '@project/storage/configured';
import {fileURLToPath} from 'node:url';
// Project owned integration. Authenticate must validate the actual project session/token.
export async function createProjectFiles(options:Pick<FileHTTPOptions,'authenticate'|'trustedOrigins'|'allowCredentials'>){
 const router=await createConfiguredStorage();
 const repository=await createFileRepository(process.env.FILES_METADATA_DIRECTORY||fileURLToPath(new URL('../.data/files-metadata',import.meta.url)));
 const service=new FileService({router,repository});
 return {service,handler:createFileHandler({...options,service})};
}
