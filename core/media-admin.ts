import type {Data} from './types';
import {DomainError} from './providers';
import {validatePlaylist, type MediaKind, type StationMedia} from './media';
/**
 * Not cryptographic — just a cheap, deterministic fingerprint so two rows created from the same
 * URI don't get an unrelated random value. A real content hash (the Blob upload's own ETag) is
 * used instead whenever one is available; see CreateMediaInput.checksum.
 */
function hashUri(uri:string):string{let h=0;for(let i=0;i<uri.length;i++)h=(h*31+uri.charCodeAt(i))|0;return (h>>>0).toString(16);}
export interface CreateMediaInput {name:string;kind:MediaKind;uri:string;durationMs:number;startsAt?:number|null;endsAt?:number|null;targetStationIds?:readonly string[];checksum?:string;}
export function createMedia(d:Data,input:CreateMediaInput):StationMedia {
 if(!input.name.trim()||input.name.length>120)throw new DomainError('Nom de média invalide.',400);
 if(!/^https:\/\//.test(input.uri))throw new DomainError('L’URI du média doit être en HTTPS.',400);
 if(input.durationMs<1000||input.durationMs>86_400_000)throw new DomainError('Durée de média invalide.',400);
 if(input.startsAt!=null&&input.endsAt!=null&&input.startsAt>=input.endsAt)throw new DomainError('La date de fin doit être après la date de début.',400);
 for(const stationId of input.targetStationIds??[])if(!d.stations.some(s=>s.id===stationId))throw new DomainError('Station cible introuvable.',404);
 const media:StationMedia={id:crypto.randomUUID(),name:input.name.trim(),kind:input.kind,uri:input.uri,checksum:input.checksum?.trim()||hashUri(input.uri),durationMs:input.durationMs,status:'DRAFT',startsAt:input.startsAt??null,endsAt:input.endsAt??null,targetStationIds:input.targetStationIds??[],createdAt:Date.now(),updatedAt:Date.now()};
 d.media.push(media);return media;
}
export function setMediaStatus(d:Data,id:string,status:'PUBLISHED'|'ARCHIVED'):StationMedia {
 const item=d.media.find(m=>m.id===id);if(!item)throw new DomainError('Média introuvable.',404);
 item.status=status;item.updatedAt=Date.now();
 validatePlaylist({version:1,items:d.media.filter(m=>m.status==='PUBLISHED'),issuedAt:Date.now(),checksum:crypto.randomUUID()});
 return item;
}
