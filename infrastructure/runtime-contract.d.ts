declare module 'batyeo-runtime' {
 export function getRepository():import('../core/repository').Repository;
 export const runtimeOptions:{demo:boolean;allowLegacyCredentials:boolean};
}
