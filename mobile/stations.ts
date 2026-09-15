import type {MobileStation} from '../core/mobile';
import {stationsNearby} from '../core/mobile';
export async function fetchStations(coreUrl:string):Promise<MobileStation[]>{const response=await fetch(`${coreUrl}/public`);if(!response.ok)throw new Error('Stations indisponibles.');const data=await response.json() as {stations:MobileStation[]};return data.stations;}
export function returnStationOptions(stations:MobileStation[],latitude?:number,longitude?:number){const usable=stations.filter(s=>s.online&&s.freeSlots>0);return latitude==null||longitude==null?usable:stationsNearby(usable,latitude,longitude,50);}
