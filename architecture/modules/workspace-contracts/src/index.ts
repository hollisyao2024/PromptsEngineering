import {Ajv2020} from 'ajv/dist/2020.js';
import {fullFormats} from 'ajv-formats/dist/formats.js';
import {schemas} from './schemas.ts';
export type {components,paths} from './generated.ts';
export function createContractValidator(definitions:Record<string,unknown>) {
  const ajv=new Ajv2020({strict:false,allErrors:true,formats:fullFormats});
  const validators=new Map<string,ReturnType<typeof ajv.compile>>();
  return (name:string,data:unknown):boolean=>{
    if(!Object.hasOwn(definitions,name))return false;
    let validator=validators.get(name);
    if(!validator){
      const pointer=name.replaceAll('~','~0').replaceAll('/','~1');
      validator=ajv.compile({$ref:'#/components/schemas/'+pointer,components:{schemas:definitions}});
      validators.set(name,validator);
    }
    return !!validator(data);
  };
}
const check=createContractValidator(schemas);
export class ContractError extends Error {
  constructor(public readonly schemaName:string) {super('Invalid '+schemaName);}
}
export function validate(name:keyof typeof schemas,data:unknown):boolean {
  return check(name,data);
}
export function assertContract(name:keyof typeof schemas,data:unknown):void {
  if(!validate(name,data))throw new ContractError(name);
}
