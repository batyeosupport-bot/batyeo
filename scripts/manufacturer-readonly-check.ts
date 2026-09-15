import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {ManufacturerBatteryStationProvider,ManufacturerHttpClient,resolveManufacturerConfig,type ManufacturerTransport} from '../core/manufacturer';

const env=process.env,config=resolveManufacturerConfig(env);if(!config){console.log(JSON.stringify({status:'NOT_CONFIGURED',reason:'Bajie credentials/configuration are absent'},null,2));process.exit(0);}
const deviceId=env.MANUFACTURER_CHECK_DEVICE_ID?.trim();if(!deviceId){console.log(JSON.stringify({status:'NOT_CONFIGURED',reason:'MANUFACTURER_CHECK_DEVICE_ID is absent'},null,2));process.exit(0);}
const fixturePath=env.MANUFACTURER_FIXTURE_PATH?.trim();const capture=env.MANUFACTURER_CAPTURE_FIXTURE==='true';if(capture&&!fixturePath)throw new Error('MANUFACTURER_FIXTURE_PATH (directory) is required when capture is enabled.');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,12);
function anonymize(value:unknown,key=''):unknown{if(typeof value==='string'){if(/password|secret|token|authorization/i.test(key))return '[REDACTED]';if(/id|qr|ip|address|name|mobile|remark/i.test(key))return `anon-${hash(value)}`;return value;}if(Array.isArray(value))return value.map(item=>anonymize(item,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,anonymize(v,k)]));return value;}
const transport:ManufacturerTransport=async(url,init)=>{const response=await fetch(url,init);if(capture&&fixturePath){const raw=await response.clone().json().catch(()=>({}));await mkdir(fixturePath,{recursive:true});const name=new URL(url).pathname.endsWith('/query')?'cabinet-query.json':'cabinet-list.json';await writeFile(`${fixturePath}/${name}`,JSON.stringify(anonymize(raw),null,2)+'\n','utf8');}return response;};
const provider=new ManufacturerBatteryStationProvider(new ManufacturerHttpClient(config,transport));
try { const started=Date.now();const snapshot=await provider.getDeviceInfo(deviceId);const search=await provider.listDevices({coordType:env.MANUFACTURER_COORD_TYPE??'GCJ-02',zoomLevel:Number(env.MANUFACTURER_ZOOM_LEVEL??5),lat:Number(env.MANUFACTURER_LATITUDE??0),lng:Number(env.MANUFACTURER_LONGITUDE??0),showPrice:false});
 console.log(JSON.stringify({status:'READ_ONLY_OK',latencyMs:Date.now()-started,device:{online:snapshot.online,totalSlots:snapshot.totalSlots,batteries:snapshot.batteries.length,availability:snapshot.availability,hasCoordinates:snapshot.latitude!==null&&snapshot.longitude!==null},list:{count:search.length},capturedFixture:capture},null,2));
} catch(error) { console.log(JSON.stringify({status:'READ_ONLY_FAILED',error:error instanceof Error?error.message:'provider unavailable'},null,2)); process.exitCode=1; }
