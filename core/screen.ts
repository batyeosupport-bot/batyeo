import {DomainError} from './providers';
import {POSTER_LOCALES,type PosterCopy,type PosterLocale} from './poster-i18n';
import type {Data,Venue} from './types';

export const POSTER_THEMES={
 sport:{label:'Bar sportif',primary:'#0f1f14',accent:'#b6ff3b'},
 lounge:{label:'Lounge',primary:'#140f0a',accent:'#f3c969'},
 hotel:{label:'Hôtel',primary:'#0d1a2e',accent:'#f4ead6'},
 batyeo:{label:'BATYEO',primary:'#19382c',accent:'#d8ed98'},
} as const;
export type PosterTheme=keyof typeof POSTER_THEMES;
export const POSTER_THEME_KEYS=Object.keys(POSTER_THEMES) as PosterTheme[];
export const ALL_POSTER_LOCALES=POSTER_LOCALES.map(l=>l.locale) as PosterLocale[];

/** How BATYEO dresses one venue's screens. Written by BATYEO staff only — never by the venue. */
export interface VenueBranding {theme:PosterTheme;logoUrl:string|null;backgroundUrl:string|null;locales:PosterLocale[];copy:Partial<Record<PosterLocale,PosterCopy>>;updatedAt:number}
export const DEFAULT_BRANDING:Omit<VenueBranding,'updatedAt'>={theme:'batyeo',logoUrl:null,backgroundUrl:null,locales:ALL_POSTER_LOCALES,copy:{}};

/** 0 = dimanche … 6 = samedi, as Date#getDay. */
export type Weekday=0|1|2|3|4|5|6;
/** A venue's own offer (happy hour, match night…), designed by BATYEO and shown between posters. */
export interface VenuePromo {id:string;venueId:string;title:string;subtitle:string;highlight:string;imageUrl:string|null;days:Weekday[];startMinute:number;endMinute:number;startsAt:number|null;endsAt:number|null;durationMs:number;status:'DRAFT'|'PUBLISHED'|'ARCHIVED';createdAt:number;updatedAt:number}
export interface PromoInput {venueId:string;title:string;subtitle:string;highlight:string;imageUrl:string|null;days:Weekday[];startMinute:number;endMinute:number;startsAt:number|null;endsAt:number|null;durationMs:number}

export function setVenueBranding(d:Data,venueId:string,input:Omit<VenueBranding,'updatedAt'>,now=Date.now()):Venue{
 const venue=d.venues.find(v=>v.id===venueId);if(!venue)throw new DomainError('Établissement introuvable.',404);
 if(!input.locales.length)throw new DomainError('Choisissez au moins une langue.',400);
 // French stays first: it is the screen's resting language, the one it comes back to after a tourist walks away.
 const locales=ALL_POSTER_LOCALES.filter(l=>input.locales.includes(l));
 const copy:VenueBranding['copy']={};
 for(const locale of ALL_POSTER_LOCALES){const entry=input.copy[locale];if(!entry)continue;const headlines=entry.headlines.map(h=>h.trim()).filter(Boolean);const tagline=entry.tagline.trim();if(headlines.length||tagline)copy[locale]={headlines,tagline};}
 venue.branding={theme:input.theme,logoUrl:input.logoUrl,backgroundUrl:input.backgroundUrl,locales,copy,updatedAt:Math.max(now,(venue.branding?.updatedAt??0)+1)};
 return venue;
}

function checkPromo(input:PromoInput){
 if(!input.title.trim())throw new DomainError('Titre de la promo requis.',400);
 if(!input.days.length)throw new DomainError('Choisissez au moins un jour.',400);
 if(input.startMinute===input.endMinute)throw new DomainError('Le créneau horaire est vide.',400);
 if(input.startsAt!=null&&input.endsAt!=null&&input.endsAt<=input.startsAt)throw new DomainError('La date de fin doit suivre la date de début.',400);
}
export function savePromo(d:Data,input:PromoInput,id?:string,now=Date.now()):VenuePromo{
 checkPromo(input);
 if(!d.venues.some(v=>v.id===input.venueId))throw new DomainError('Établissement introuvable.',404);
 const fields={venueId:input.venueId,title:input.title.trim(),subtitle:input.subtitle.trim(),highlight:input.highlight.trim(),imageUrl:input.imageUrl,days:[...new Set(input.days)].sort() as Weekday[],startMinute:input.startMinute,endMinute:input.endMinute,startsAt:input.startsAt,endsAt:input.endsAt,durationMs:input.durationMs};
 if(id){
  const existing=d.promos.find(p=>p.id===id);if(!existing)throw new DomainError('Promo introuvable.',404);
  if(existing.venueId!==input.venueId)throw new DomainError('Une promo ne change pas d’établissement.',400);
  Object.assign(existing,fields,{updatedAt:now});return existing;
 }
 const promo:VenuePromo={id:crypto.randomUUID(),...fields,status:'DRAFT',createdAt:now,updatedAt:now};
 d.promos.push(promo);return promo;
}
export function setPromoStatus(d:Data,id:string,status:VenuePromo['status'],now=Date.now()):VenuePromo{
 const promo=d.promos.find(p=>p.id===id);if(!promo)throw new DomainError('Promo introuvable.',404);
 promo.status=status;promo.updatedAt=now;return promo;
}

const PARIS=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const WEEKDAYS:Record<string,Weekday>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
/** The stations are in France and the server runs in UTC: a « 18h-20h » happy hour means Paris time, summer and winter alike. */
export function parisClock(now:number):{day:Weekday;minute:number}{
 const parts=Object.fromEntries(PARIS.formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 return {day:WEEKDAYS[parts.weekday],minute:Number(parts.hour)*60+Number(parts.minute)};
}
/** A window may cross midnight (22h-2h): its after-midnight part belongs to the day it started on. */
export function promoLiveAt(promo:VenuePromo,now:number):boolean{
 if(promo.status!=='PUBLISHED')return false;
 if(promo.startsAt!=null&&now<promo.startsAt)return false;
 if(promo.endsAt!=null&&now>=promo.endsAt)return false;
 const {day,minute}=parisClock(now);
 if(promo.startMinute<promo.endMinute)return promo.days.includes(day)&&minute>=promo.startMinute&&minute<promo.endMinute;
 const yesterday=((day+6)%7) as Weekday;
 return (promo.days.includes(day)&&minute>=promo.startMinute)||(promo.days.includes(yesterday)&&minute<promo.endMinute);
}

const DAY_SHORT=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const hhmm=(minute:number)=>{const h=Math.floor(minute/60)%24,m=minute%60;return m?`${h}h${String(m).padStart(2,'0')}`:`${h}h`;};
/** « Lun–Ven · 18h–20h » — written for the screen, so it reads at a glance from across a bar. */
export function promoScheduleLabel(promo:Pick<VenuePromo,'days'|'startMinute'|'endMinute'>):string{
 const order=[1,2,3,4,5,6,0].filter(d=>promo.days.includes(d as Weekday));
 const ranges:string[]=[];
 for(let i=0;i<order.length;){let j=i;while(j+1<order.length&&[1,2,3,4,5,6,0].indexOf(order[j+1])===[1,2,3,4,5,6,0].indexOf(order[j])+1)j++;ranges.push(j-i>=2?`${DAY_SHORT[order[i]]}–${DAY_SHORT[order[j]]}`:order.slice(i,j+1).map(d=>DAY_SHORT[d]).join(', '));i=j+1;}
 const days=order.length===7?'Tous les jours':ranges.join(', ');
 return `${days} · ${hhmm(promo.startMinute)}–${hhmm(promo.endMinute)}`;
}

/** What a station's screen needs to dress itself — public by nature, it is shown to anyone in the bar. */
export function posterFor(d:Data,publicId:string,now=Date.now()){
 const station=d.stations.find(s=>s.publicId===publicId&&!s.archivedAt);if(!station)return null;
 const venue=d.venues.find(v=>v.id===station.venueId);if(!venue)return null;
 const branding=venue.branding??{...DEFAULT_BRANDING,updatedAt:0};
 const theme=POSTER_THEMES[branding.theme]??POSTER_THEMES.batyeo;
 const promos=d.promos.filter(p=>p.venueId===venue.id&&promoLiveAt(p,now)).sort((a,b)=>a.createdAt-b.createdAt)
  .map(p=>({id:p.id,title:p.title,subtitle:p.subtitle,highlight:p.highlight,imageUrl:p.imageUrl,durationMs:p.durationMs,schedule:promoScheduleLabel(p)}));
 return {venueName:venue.name,branding:{logoUrl:branding.logoUrl,backgroundUrl:branding.backgroundUrl,primary:theme.primary,accent:theme.accent,locales:branding.locales.length?branding.locales:ALL_POSTER_LOCALES,copy:branding.copy},promos};
}
export type PosterPayload=NonNullable<ReturnType<typeof posterFor>>;
