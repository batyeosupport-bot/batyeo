import type {Data} from './types';
/** Persistence port. Callbacks are deterministic domain mutations with no network effects.
 * Adapters commit the complete mutation atomically or roll it back and may retry conflicts. */
export interface Repository {
 read():Promise<Data>;
 transaction<T>(mutate:(data:Data)=>T):Promise<T>;
}
