import type {NextConfig} from 'next';
import {resolve} from 'node:path';
const previewBuild=process.env.BATYEO_PREVIEW_BUILD==='1';
const nextConfig:NextConfig={
 webpack(config){
  if(!previewBuild){
   config.resolve.alias['batyeo-runtime']=resolve(process.cwd(),'infrastructure/runtime.ts');
  }
  return config;
 },
};
export default nextConfig;
