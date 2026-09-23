/**
 * Built-in wording for the promotional poster. Unlike the kiosk strings (French built in, other
 * languages typed by an admin), every language here ships complete: a venue gets a multilingual
 * poster without anyone translating anything. Only the headlines and tagline can be overridden
 * per venue and per language.
 */
export const POSTER_LOCALES=[
 {code:'FR',label:'Français',locale:'fr-FR'},
 {code:'EN',label:'English',locale:'en-GB'},
 {code:'ES',label:'Español',locale:'es-ES'},
 {code:'IT',label:'Italiano',locale:'it-IT'},
 {code:'DE',label:'Deutsch',locale:'de-DE'},
 {code:'PT',label:'Português',locale:'pt-PT'},
 {code:'中文',label:'中文',locale:'zh-CN'},
] as const;
export type PosterLocale=typeof POSTER_LOCALES[number]['locale'];

export const POSTER_STRING_KEYS=['perHour','capDay','deposit','scan','availableOne','availableMany','allRented','offline','charging','charged','step1','step2','step3','step4','headline1','headline2','headline3','tagline','accept'] as const;
export type PosterStringKey=typeof POSTER_STRING_KEYS[number];

export const POSTER_STRINGS:Readonly<Record<PosterLocale,Readonly<Record<PosterStringKey,string>>>>={
 'fr-FR':{
  perHour:'l’heure',capDay:'maximum\nla journée',deposit:'de caution\nremboursée',scan:'Scanne pour louer',
  availableOne:'{count} batterie disponible',availableMany:'{count} batteries disponibles',
  allRented:'Toutes les batteries sont en location. Reviens dans un instant.',offline:'Borne momentanément indisponible.',
  charging:'Recharge en cours…',charged:'Rechargé. Profite de la soirée.',
  step1:'Scanne le QR',step2:'Paie sur ton téléphone',step3:'Prends une batterie',step4:'Rends-la dans n’importe quelle borne',
  headline1:'Batterie à plat ?',headline2:'Reste encore un peu.',headline3:'La soirée continue.',tagline:'Recharge ton téléphone sans quitter ta table.',
  accept:'Paiement accepté',
 },
 'en-GB':{
  perHour:'per hour',capDay:'max\nper day',deposit:'refundable\ndeposit',scan:'Scan to rent',
  availableOne:'{count} battery available',availableMany:'{count} batteries available',
  allRented:'All batteries are out right now. Check back soon.',offline:'Station temporarily unavailable.',
  charging:'Charging…',charged:'Fully charged. Enjoy your night.',
  step1:'Scan the QR code',step2:'Pay on your phone',step3:'Grab a battery',step4:'Return it to any station',
  headline1:'Dead phone?',headline2:'Don’t leave yet.',headline3:'Keep the night going.',tagline:'Charge your phone without leaving your table.',
  accept:'We accept',
 },
 'es-ES':{
  perHour:'la hora',capDay:'máximo\nal día',deposit:'de fianza\nreembolsable',scan:'Escanea para alquilar',
  availableOne:'{count} batería disponible',availableMany:'{count} baterías disponibles',
  allRented:'Todas las baterías están alquiladas. Vuelve en un momento.',offline:'Estación no disponible temporalmente.',
  charging:'Cargando…',charged:'Carga completa. Disfruta de la noche.',
  step1:'Escanea el QR',step2:'Paga con tu móvil',step3:'Coge una batería',step4:'Devuélvela en cualquier estación',
  headline1:'¿Sin batería?',headline2:'No te vayas todavía.',headline3:'Que siga la noche.',tagline:'Carga tu móvil sin levantarte de la mesa.',
  accept:'Aceptamos',
 },
 'it-IT':{
  perHour:'all’ora',capDay:'massimo\nal giorno',deposit:'di cauzione\nrimborsabile',scan:'Scansiona per noleggiare',
  availableOne:'{count} batteria disponibile',availableMany:'{count} batterie disponibili',
  allRented:'Tutte le batterie sono a noleggio. Torna tra poco.',offline:'Stazione momentaneamente non disponibile.',
  charging:'In carica…',charged:'Carica completa. Goditi la serata.',
  step1:'Scansiona il QR',step2:'Paga dal telefono',step3:'Prendi una batteria',step4:'Restituiscila in qualsiasi stazione',
  headline1:'Telefono scarico?',headline2:'Non andartene ancora.',headline3:'La serata continua.',tagline:'Ricarica il telefono senza lasciare il tavolo.',
  accept:'Accettiamo',
 },
 'de-DE':{
  perHour:'pro Stunde',capDay:'maximal\npro Tag',deposit:'Kaution,\nwird erstattet',scan:'Scannen & ausleihen',
  availableOne:'{count} Powerbank verfügbar',availableMany:'{count} Powerbanks verfügbar',
  allRented:'Alle Powerbanks sind gerade verliehen. Schau gleich wieder vorbei.',offline:'Station vorübergehend nicht verfügbar.',
  charging:'Wird geladen…',charged:'Voll geladen. Genieß den Abend.',
  step1:'QR-Code scannen',step2:'Am Handy bezahlen',step3:'Powerbank nehmen',step4:'An jeder Station zurückgeben',
  headline1:'Akku leer?',headline2:'Bleib noch ein bisschen.',headline3:'Der Abend geht weiter.',tagline:'Lade dein Handy, ohne den Tisch zu verlassen.',
  accept:'Wir akzeptieren',
 },
 'pt-PT':{
  perHour:'por hora',capDay:'máximo\npor dia',deposit:'de caução\nreembolsável',scan:'Digitaliza para alugar',
  availableOne:'{count} bateria disponível',availableMany:'{count} baterias disponíveis',
  allRented:'Todas as baterias estão alugadas. Volta daqui a pouco.',offline:'Estação temporariamente indisponível.',
  charging:'A carregar…',charged:'Carga completa. Aproveita a noite.',
  step1:'Digitaliza o QR',step2:'Paga no telemóvel',step3:'Leva uma bateria',step4:'Devolve em qualquer estação',
  headline1:'Bateria em baixo?',headline2:'Fica mais um pouco.',headline3:'A noite continua.',tagline:'Carrega o telemóvel sem sair da mesa.',
  accept:'Aceitamos',
 },
 'zh-CN':{
  perHour:'每小时',capDay:'每日\n封顶',deposit:'押金\n可退还',scan:'扫码租借',
  availableOne:'{count} 个充电宝可用',availableMany:'{count} 个充电宝可用',
  allRented:'充电宝已全部借出，请稍后再来。',offline:'本机暂时无法使用。',
  charging:'充电中…',charged:'已充满，尽情享受今晚。',
  step1:'扫描二维码',step2:'手机支付',step3:'取出充电宝',step4:'任意站点归还',
  headline1:'手机没电了？',headline2:'别急着走。',headline3:'让今晚继续。',tagline:'不离开座位，也能给手机充电。',
  accept:'支持支付',
 },
};

/** What BATYEO wrote for one venue in one language; anything left blank falls back to the built-in wording. */
export interface PosterCopy {headlines:string[];tagline:string}

export function resolvePosterText(locale:PosterLocale,copy?:Partial<PosterCopy>){
 const strings=POSTER_STRINGS[locale];
 const custom=(copy?.headlines??[]).map(h=>h.trim()).filter(Boolean);
 const headlines=custom.length?custom:[strings.headline1,strings.headline2,strings.headline3];
 const tagline=copy?.tagline?.trim()||strings.tagline;
 // French puts a space before ? ! : ; — non-breaking, so the mark never wraps alone onto the next line.
 const typeset=(text:string)=>locale==='fr-FR'?text.replace(/ ([?!:;»])/g,' $1'):text;
 return {strings,headlines:headlines.map(typeset),tagline:typeset(tagline)};
}

export function posterAvailability(locale:PosterLocale,count:number){
 const strings=POSTER_STRINGS[locale];
 return (count>1?strings.availableMany:strings.availableOne).replace('{count}',String(count));
}

export function posterPrice(locale:PosterLocale,cents:number){
 return new Intl.NumberFormat(locale,{style:'currency',currency:'EUR',maximumFractionDigits:cents%100?2:0}).format(cents/100);
}
