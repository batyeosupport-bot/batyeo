import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync,readdirSync} from 'node:fs';
let r=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.test.json'],{stdio:'inherit'});if(r.status)process.exit(r.status);
mkdirSync('.test-build',{recursive:true});writeFileSync('.test-build/package.json','{"type":"commonjs"}');
r=spawnSync(process.execPath,['--test',...readdirSync('.test-build/tests').filter(f=>f.endsWith('.test.js')).map(f=>'.test-build/tests/'+f)],{stdio:'inherit'});process.exit(r.status??1);
