import { StorageError } from './contracts.ts';
import type {StorageProvider} from './contracts.ts';
export class StorageRouter {
  readonly stores:Readonly<Record<string,StorageProvider>>;
  defaultStore:string;
  constructor(stores:Record<string,StorageProvider>,defaultStore:string){this.stores=Object.freeze({...stores});this.defaultStore=defaultStore;this.get(defaultStore);}
  get(id=this.defaultStore):StorageProvider {if(!Object.hasOwn(this.stores,id))throw new StorageError('CONFIGURATION','Unknown storage profile');return this.stores[id];}
}
