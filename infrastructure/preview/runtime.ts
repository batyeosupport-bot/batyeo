import {env} from 'cloudflare:workers';
import {D1Repository} from './d1-repository';
import type {Repository} from '../../core/repository';
import {DomainError} from '../../core/providers';
let instance:Repository|undefined;
export const runtimeOptions={demo:true,allowLegacyCredentials:true};
export function getRepository():Repository {
 if(!env.DB)throw new DomainError('Base de prévisualisation indisponible.',503);
 return instance??=new D1Repository(env.DB);
}
