import {spawnSync} from 'node:child_process';
const configured=(key:string)=>Boolean(process.env[key]?.trim());
const steps:Array<[string,string,()=>boolean]>=[
  ['staging:doctor','pnpm staging:doctor',()=>true],
  ['db:doctor','pnpm db:doctor',()=>true],
  ['db:migrate','pnpm db:migrate',()=>configured('DATABASE_URL')],
  ['manufacturer:check','pnpm manufacturer:check',()=>process.env.MANUFACTURER_PROVIDER==='bajie'&&configured('MANUFACTURER_API_BASE_URL')&&configured('MANUFACTURER_USERNAME')&&configured('MANUFACTURER_PASSWORD')],
  ['hardware:doctor','pnpm hardware:doctor',()=>true],
  ['staging:golden-flow','pnpm staging:golden-flow',()=>true],
  ['staging:failure-matrix','pnpm staging:failure-matrix',()=>true],
];
for(const [label,command,ready] of steps){
  console.log(`\n== ${label} ==`);
  if(!ready()){console.log(`NOT_CONFIGURED ${label} (required environment is absent)`);continue;}
  const result=spawnSync(command,{shell:true,stdio:'inherit',env:process.env});
  if(result.status!==0) console.log(`NOT_VERIFIED ${label} (blocked or unavailable; no guard bypassed)`);
}
console.log('\nSTAGING BOOTSTRAP COMPLETE: inspect each status before enabling scheduler or hardware.');
