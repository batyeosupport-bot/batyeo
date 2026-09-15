'use client';
import {WebMcp} from './webmcp';
import {PublicShell,Home,Stations,InfoPage} from './public';
import {RentalFlow} from './rental';
import {Portal,Login} from './portal';
export function BatyeoApp({path}: {path:string}){
 if(path.startsWith('/rent/'))return <RentalFlow publicId={path.split('/')[2]}/>;
 if(path==='/admin/login'||path==='/partner/login')return <Login partner={path.startsWith('/partner')}/>;
 if(path==='/admin'||path.startsWith('/admin/')||path==='/partner'||path.startsWith('/partner/'))return <Portal path={path}/>;
 return <PublicShell path={path}><WebMcp/>{path==='/'?<Home/>:path==='/stations'?<Stations/>:<InfoPage path={path}/>}</PublicShell>;
}
