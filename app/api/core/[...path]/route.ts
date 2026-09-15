import {createApi} from '@/server/http';
import {getRepository,runtimeOptions} from 'batyeo-runtime';
export const dynamic='force-dynamic';
const handler=(request:Request,context:{params:Promise<{path:string[]}>})=>createApi(getRepository(),runtimeOptions)[request.method==='GET'?'GET':'POST'](request,context);
export const GET=handler;
export const POST=handler;
