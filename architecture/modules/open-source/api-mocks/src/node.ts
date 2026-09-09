import {setupServer} from 'msw/node';
import {handlers} from './handlers.ts';
import type {RequestHandler} from 'msw';
export function createMockServer(extra:RequestHandler[]=[]){return setupServer(...extra,...handlers);}
