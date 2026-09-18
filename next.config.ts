import type {NextConfig} from 'next';
import {resolve} from 'node:path';
const previewBuild=process.env.BATYEO_PREVIEW_BUILD==='1';
const nextConfig:NextConfig={
 // Prisma's WASM query compiler (engineType "client") lives inside pnpm's hashed
 // .pnpm/@prisma+client@.../node_modules/.prisma/client store, not at a stable
 // node_modules/.prisma path — Next's static file tracer can't discover it via
 // require() analysis and drops it from the deployed function, which then fails
 // at runtime with ENOENT on query_compiler_bg.wasm. Marking the package external
 // makes Next copy its whole resolved directory (symlink target included) instead.
 serverExternalPackages:['@prisma/client'],
 outputFileTracingIncludes:{
  // Bracketed dynamic segments are glob character classes to picomatch, not literal
  // text — a literal '[...path]' key never matches. '**' sidesteps that entirely.
  '/api/core/**':['./node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.wasm'],
 },
 webpack(config){
  if(!previewBuild){
   config.resolve.alias['batyeo-runtime']=resolve(process.cwd(),'infrastructure/runtime.ts');
  }
  return config;
 },
};
export default nextConfig;
