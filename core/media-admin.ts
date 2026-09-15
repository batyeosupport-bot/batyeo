import type {Data} from './types';
import {DomainError} from './providers';
import {validatePlaylist, type MediaKind, type StationMedia} from './media';
export interface CreateMediaInput {name:string;kind:MediaKind;uri:string;durationMs:number;startsAt?:number|null;endsAt?:number|null;targetStationIds?:readonly string[];}
export function createMedia(d:Data,input:CreateMediaInput):StationMedia {
 if(!input.name.trim()||input.name.length>120)throw new DomainError('Nom de média invalide.',400);
 if(!/^https:\/\//.test(input.uri))throw new DomainError('L’URI du média doit être en HTTPS.',400);
 if(input.durationMs<1000||input.durationMs>86_400_000)throw new DomainError('Durée de média invalide.',400);
 for(const stationId of input.targetStationIds??[])if(!d.stations.some(s=>s.id===stationId))throw new DomainError('Station cible introuvable.',404);
 const media:StationMedia={id:crypto.randomUUID(),name:input.name.trim(),kind:input.kind,uri:input.uri,checksum:crypto.randomUUID().replace(/-/g,''),durationMs:input.durationMs,status:'DRAFT',startsAt:input.startsAt??null,endsAt:input.endsAt??null,targetStationIds:input.targetStationIds??[],createdAt:Date.now()};
 d.media.push(media);return media;
}
export function setMediaStatus(d:Data,id:string,status:'PUBLISHED'|'ARCHIVED'):StationMedia {
 const item=d.media.find(m=>m.id===id);if(!item)throw new DomainError('Média introuvable.',404);
 item.status=status;
 validatePlaylist({version:1,items:d.media.filter(m=>m.status==='PUBLISHED'),issuedAt:Date.now(),checksum:crypto.randomUUID()});
 return item;
}
