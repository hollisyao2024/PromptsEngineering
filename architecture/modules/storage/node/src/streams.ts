import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { StorageError,validSize } from './contracts.ts';
import type { PutInput } from './contracts.ts';
export function readable(body:PutInput['body']):Readable {return body instanceof Readable?body:Readable.from([typeof body==='string'?Buffer.from(body):body]);}
export function sizeGuard(size:number) {
  validSize(size);let seen=0;const digest=createHash('sha256');
  const stream=new Transform({transform(chunk,_encoding,callback){seen+=chunk.length;if(seen>size)return callback(new StorageError('INVALID_INPUT','Uploaded size differs from session'));digest.update(chunk);callback(null,chunk);},flush(callback){callback(seen===size?null:new StorageError('INVALID_INPUT','Uploaded size differs from session'));}});
  return {stream,digest:()=>digest.digest('hex')};
}
