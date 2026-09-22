'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,ArrowUpRight,ScanLine,BatteryCharging,Check,ShieldCheck,Clock,Download,CheckCircle2,Globe} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Brand,useApi,api,type PublicData,type RentalView,Status,ErrorBox,Loading,Busy,Cta,dateTime,duration,Eyebrow} from './shared';
import {euro} from '@/core/pricing';
import {resolveWebStrings,type RuntimeTranslations,type WebStringKey} from '@/core/i18n';
/**
 * Persists across visits on this device only — never read by the server, never shared between
 * customers. Reads localStorage/navigator only after mount (never during render, which can run
 * server-side and would crash on those browser-only globals); the pick itself is deferred a tick
 * (matching useApi's own setTimeout(…,0) below) so it lands as a reaction, not a synchronous
 * render-phase state write.
 */
function useWebLocale(translations:RuntimeTranslations|null){
 const [locale,setLocale]=useState('fr-FR');
 useEffect(()=>{
  const available=translations?.available??[];
  if(!available.length)return;
  const timer=setTimeout(()=>{
   let saved:string|null=null;try{saved=localStorage.getItem('batyeo_rental_locale');}catch{/* private mode or storage disabled: default to French below */}
   if(saved&&available.some(l=>l.locale===saved)){setLocale(saved);return;}
   const browser=(typeof navigator!=='undefined'?navigator.languages:undefined)??[];
   const match=available.find(l=>browser.some(b=>b.toLowerCase().startsWith(l.locale.slice(0,2).toLowerCase())));
   if(match)setLocale(match.locale);
  },0);
  return()=>clearTimeout(timer);
 },[translations]);
 function choose(next:string){setLocale(next);try{localStorage.setItem('batyeo_rental_locale',next);}catch{/* per-device convenience only — nothing breaks if it can't be saved */}}
 return [locale,choose] as const;
}
interface StripeElement{mount(target:HTMLElement):void;destroy():void}
interface StripeElements{create(type:'payment',options?:Record<string,unknown>):StripeElement}
interface StripeJs{elements(options:{clientSecret:string;locale?:string;appearance?:Record<string,unknown>}):StripeElements;confirmPayment(options:{elements:StripeElements;confirmParams:{return_url:string};redirect:'if_required'}):Promise<{error?:{message?:string}}>}
declare global{interface Window{Stripe?:(publishableKey:string)=>StripeJs}}
type CardSession={clientSecret:string;publishableKey:string};
let stripeScript:Promise<void>|null=null;
/** Stripe.js must come from Stripe itself — never bundled or self-hosted — so that card details go straight to Stripe and never touch BATYEO. */
function loadStripeJs():Promise<void>{
 if(typeof window==='undefined')return Promise.reject(new Error('Paiement indisponible.'));
 if(window.Stripe)return Promise.resolve();
 stripeScript??=new Promise<void>((resolve,reject)=>{const tag=document.createElement('script');tag.src='https://js.stripe.com/v3/';tag.async=true;tag.onload=()=>resolve();tag.onerror=()=>{stripeScript=null;reject(new Error('Le module de paiement sécurisé n’a pas pu être chargé. Vérifiez votre connexion.'));};document.head.appendChild(tag);});
 return stripeScript;
}
function CardStep({session,amount,lang,testMode,t,onPaid,onCancel}:{session:CardSession;amount:string;lang:string;testMode:boolean;t:(key:WebStringKey,vars?:Record<string,string>)=>string;onPaid:()=>Promise<void>;onCancel:()=>void}){
 const mount=useRef<HTMLDivElement|null>(null),stripeRef=useRef<StripeJs|null>(null),elementsRef=useRef<StripeElements|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[paying,setPaying]=useState(false);
 useEffect(()=>{
  let element:StripeElement|undefined,cancelled=false;
  loadStripeJs().then(()=>{
   if(cancelled||!mount.current||!window.Stripe)return;
   const stripe=window.Stripe(session.publishableKey);stripeRef.current=stripe;
   const elements=stripe.elements({clientSecret:session.clientSecret,locale:lang,appearance:{theme:'stripe',variables:{colorPrimary:'#19382c',borderRadius:'8px',fontFamily:'inherit'}}});
   elementsRef.current=elements;element=elements.create('payment');element.mount(mount.current);setReady(true);
  }).catch(e=>{if(!cancelled)setError((e as Error).message);});
  return()=>{cancelled=true;element?.destroy();};
 },[session.clientSecret,session.publishableKey,lang]);
 async function pay(){
  if(!stripeRef.current||!elementsRef.current||paying)return;
  setPaying(true);setError('');
  try{
   const result=await stripeRef.current.confirmPayment({elements:elementsRef.current,confirmParams:{return_url:window.location.href},redirect:'if_required'});
   if(result.error){setError(result.error.message??t('web_pay_failed'));return;}
   await onPaid();
  }catch(e){setError((e as Error).message||t('web_pay_failed'));}finally{setPaying(false);}
 }
 return <section className="rental-card"><Eyebrow>{t('web_pay_eyebrow')}</Eyebrow><h1>{lines(t('web_pay_title'))}</h1><p>{t('web_pay_body',{amount})}</p>{testMode&&<p className="small muted">{t('web_pay_testHint')}</p>}<div ref={mount} className="card-element" aria-busy={!ready}/>{!ready&&!error&&<p className="small muted">{t('web_pay_loading')}</p>}{error&&<ErrorBox message={error}/>}<Button className="cta full" disabled={!ready||paying} onClick={()=>void pay()}>{paying&&<Busy/>}{paying?t('web_pay_confirming'):t('web_pay_cta')}</Button><Button variant="outline" style={{width:'100%',marginTop:10}} disabled={paying} onClick={onCancel}>{t('web_pay_cancel')}</Button></section>;
}
/** Titles carry \n where the design wants a line break; splitting here keeps translators in plain text. */
const lines=(text:string)=>text.split('\n').flatMap((part,i)=>i?[<br key={i}/>,part]:[part]);
export function RentalFlow({publicId}: {publicId:string}){
 const pub=useApi<PublicData>('public',10000),customer=useApi<{rental:RentalView|null}>('customer',3000);
 const translationsApi=useApi<{locale:string;translations:RuntimeTranslations|null}>('translations/'+publicId);
 const webTranslations=translationsApi.data?.translations??null;
 const available=webTranslations?.available??[];
 const [locale,setLocale]=useWebLocale(webTranslations);
 const strings=resolveWebStrings(webTranslations,locale);
 // Everything the customer is told about their money follows the deployment's real payment mode.
 // These used to be fixed strings, so a live site would still have called itself a demonstration.
 const payment=pub.data?.payment??'mock',real=payment==='stripe_live';
 const modeBanner=real?null:payment==='stripe_test'?'web_mode_bannerTest':'web_mode_bannerMock';
 const t=(stringKey:WebStringKey,vars?:Record<string,string>)=>{let s=strings[stringKey];if(vars)for(const [k,v] of Object.entries(vars))s=s.replaceAll(`{${k}}`,v);return s;};
 const [localRental,setRental]=useState<RentalView|null>(null),[contactEmail,setContactEmail]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[phase,setPhase]=useState(0),[error,setError]=useState(''),[dismissed,setDismissed]=useState(false);
 const key=useRef<string|null>(null),lock=useRef(false),resumed=useRef(false);
 const [session,setSession]=useState<CardSession|null>(null);
 const remoteRental=customer.data?.rental; const rental=dismissed?localRental:remoteRental&&(!localRental||remoteRental.id===localRental.id)?remoteRental:localRental;
 const station=pub.data?.stations.find(s=>s.publicId===publicId);const pricing=pub.data?.pricing;
 async function start(){if(lock.current||!accepted)return;lock.current=true;setBusy(true);setError('');setDismissed(false);key.current??=crypto.randomUUID();setPhase(1);const timer=setTimeout(()=>setPhase(2),450);try{const result=await api<{rental:RentalView;payment?:CardSession|null}>('start',{stationPublicId:publicId,termsAccepted:true,idempotencyKey:key.current,...(contactEmail.trim()?{contactEmail:contactEmail.trim()}:{})});setRental(result.rental);setSession(result.payment??null);void pub.refresh();}catch(e){setError((e as Error).message);}finally{clearTimeout(timer);setPhase(0);setBusy(false);lock.current=false;}}
 // The browser reporting "paid" proves nothing; the server reads the intent back from Stripe. If Stripe has not
 // finished moving the intent yet the server answers "not confirmed" and we simply ask again for a few seconds.
 async function confirmPayment(rentalId:string){
  for(let attempt=0;attempt<8;attempt++){
   try{const result=await api<{rental:RentalView}>('rental/confirm-payment',{rentalId});setRental(result.rental);setSession(null);void customer.refresh();return;}
   catch(e){if(!/pas encore confirmé/.test((e as Error).message)||attempt===7)throw e;await new Promise(resolve=>setTimeout(resolve,1500));}
  }
 }
 async function cancelUnpaid(){
  const id=rental?.id;setSession(null);setDismissed(true);setRental(null);key.current=null;setAccepted(false);
  if(id)await api('rental/cancel-unpaid',{rentalId:id}).catch(()=>undefined);
  void customer.refresh();
 }
 // A reload, or the return from a 3-D Secure redirect, loses the in-memory client secret. The open rental is still
 // there, and asking for it again gives back the very same intent — no second charge, no second rental.
 const pendingCard=remoteRental?.state==='CREATED'&&remoteRental.station?.publicId===publicId;
 useEffect(()=>{
  if(!pendingCard||session||resumed.current||!remoteRental||!pub.data?.cardPayments)return;
  resumed.current=true;
  void (async()=>{
   try{
    const result=await api<{rental:RentalView;payment?:CardSession|null}>('start',{stationPublicId:publicId,termsAccepted:true,idempotencyKey:crypto.randomUUID()});
    const returned=new URLSearchParams(window.location.search).get('redirect_status');
    if(returned==='succeeded'){window.history.replaceState({},'',window.location.pathname);await confirmPayment(result.rental.id);}
    else if(result.payment)setSession(result.payment);
   }catch(e){setError((e as Error).message);}
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[pendingCard,session,remoteRental?.id,pub.data?.cardPayments]);
 const awaitingCard=rental?.state==='CREATED'&&!!session;
 const completed=rental?.state==='COMPLETED';const active=rental&&['ACTIVE','OVERDUE'].includes(rental.state);const failed=rental&&['EJECTION_FAILED','PAYMENT_FAILED'].includes(rental.state);const lost=rental?.state==='LOST';
 const processing=rental&&['CREATED','PAYMENT_AUTH','EJECTING'].includes(rental.state);const returning=rental&&['RETURN_PENDING','RETURNED'].includes(rental.state);const needsReview=rental?.state==='ERROR';const cancelled=rental&&['CANCELLED','EXPIRED'].includes(rental.state);
 return <div className="rental-page"><header className="rental-header"><Brand/><div className="rental-header-actions">{available.length>1&&<label className="language-switcher"><Globe size={15}/><select value={locale} onChange={e=>setLocale(e.target.value)} aria-label="Langue">{available.map(l=><option key={l.locale} value={l.locale}>{l.label}</option>)}</select></label>}<Link href="/support">Besoin d’aide ?</Link></div></header><main className="rental-container"><Link href="/stations" className="back-link"><ArrowLeft size={16}/>Les stations</Link>{modeBanner&&<div className="rental-demo">{t(modeBanner)}</div>}{pub.loading||customer.loading?<Loading/>:pub.error||customer.error?<ErrorBox message={pub.error||customer.error} retry={()=>{void pub.refresh();void customer.refresh();}}/>:!station||!pricing?<ErrorBox message="Station introuvable. Vérifiez le lien QR."/>:awaitingCard&&rental&&session?<CardStep session={session} amount={euro(rental.pricing.depositCents)} lang={locale.slice(0,2)} testMode={payment==='stripe_test'} t={t} onPaid={()=>confirmPayment(rental.id)} onCancel={()=>void cancelUnpaid()}/>:busy?<section className="rental-card preparing" aria-live="polite"><div className="eject-visual"><BatteryCharging size={64}/></div><Eyebrow>{t('web_busy_eyebrow')}</Eyebrow><h1>{phase===1?t('web_busy_authorizing'):t('web_busy_preparing')}</h1><p>{t('web_busy_stayNearby')}</p><Busy/></section>:completed&&rental?<section className="rental-card receipt"><div className="success-emblem"><CheckCircle2 size={38}/></div><Eyebrow>{t('web_receipt_eyebrow')}</Eyebrow><h1>{t('web_receipt_title')}</h1><p>{t('web_receipt_body')}</p><div className="receipt-total">{euro(rental.amountCents)}<span>{t('web_receipt_amount')}</span></div><dl className="detail-list"><div><dt>{t('web_receipt_totalDuration')}</dt><dd>{duration(rental.elapsedMs)}</dd></div><div><dt>{t('web_receipt_depositReleased')}</dt><dd>{euro(rental.payment?.releasedCents??0)}</dd></div><div><dt>{t('web_receipt_amountAuthorized')}</dt><dd>{euro(rental.pricing.depositCents)}</dd></div><div><dt>{t('web_receipt_reference')}</dt><dd className="mono">{rental.id.slice(0,8).toUpperCase()}</dd></div><div><dt>{t('web_receipt_returnedAt')}</dt><dd>{dateTime(rental.returnedAt!)}</dd></div></dl><p className="small muted">{t(real?'web_receipt_noteLive':payment==='stripe_test'?'web_receipt_noteTest':'web_receipt_note')}</p><Button className="cta" variant="outline" onClick={()=>window.print()}><Download size={18}/>{t('web_receipt_print')}</Button><Button className="cta" onClick={()=>{setDismissed(true);setRental(null);key.current=null;setAccepted(false);}}>{t('web_receipt_newRental')}</Button></section>:active&&rental?<section className="rental-card active-rental"><div className="card-heading"><span className="rental-icon"><BatteryCharging size={25}/></span><Status value={rental.state}/></div><Eyebrow>{t('web_active_eyebrow')}</Eyebrow><h1>{t('web_active_title')}</h1><p>{t('web_active_body')}</p><div className="active-meter"><div><Clock size={20}/><strong>{duration(rental.elapsedMs)}</strong><span>{t('web_active_duration')}</span></div><div><strong>{euro(rental.currentCents)}</strong><span>{t('web_active_currentPrice',{cap:euro(rental.pricing.capCents)})}</span></div></div><dl className="detail-list"><div><dt>{t('web_active_returnBefore')}</dt><dd>{dateTime(rental.deadline!-rental.simulatedMinutes*60_000)}</dd></div><div><dt>{t('web_active_startStation')}</dt><dd>{rental.station?.venue.name}</dd></div><div><dt>{t('web_active_reference')}</dt><dd className="mono">{rental.id.slice(0,8).toUpperCase()}</dd></div></dl>{rental.state==='OVERDUE'&&<ErrorBox message={t('web_active_overdue',{deposit:euro(rental.pricing.depositCents)})}/>}<Cta href="/stations">{t('web_active_cta')}</Cta><div className="info-callout small"><ScanLine size={20}/><p>{t('web_active_returnHint')}</p></div></section>:failed&&rental?<section className="rental-card"><Eyebrow>{t('web_failed_eyebrow')}</Eyebrow><h1>{lines(t('web_failed_title'))}</h1><ErrorBox message={rental.error??t('web_failed_fallback')}/><dl className="detail-list"><div><dt>{t('web_common_charged')}</dt><dd>0 €</dd></div><div><dt>{t('web_failed_released')}</dt><dd>{euro(rental.payment?.releasedCents??0)}</dd></div></dl><Button className="cta" onClick={()=>{setDismissed(true);setRental(null);key.current=null;}}>{t('web_failed_retry')}</Button><Cta href="/stations" outline>{t('web_common_otherStation')}</Cta></section>:processing&&rental?<section className="rental-card preparing" aria-live="polite"><div className="eject-visual"><BatteryCharging size={64}/></div><Eyebrow>{t('web_busy_eyebrow')}</Eyebrow><h1>{t('web_busy_preparingRental')}</h1><p>{t('web_busy_dontClose')}</p><Busy/></section>:returning&&rental?<section className="rental-card preparing" aria-live="polite"><div className="eject-visual"><BatteryCharging size={64}/></div><Eyebrow>{t('web_returning_eyebrow')}</Eyebrow><h1>{lines(t('web_returning_title'))}</h1><p>{t('web_returning_body')}</p><Busy/></section>:needsReview&&rental?<section className="rental-card"><Eyebrow>{t('web_review_eyebrow')}</Eyebrow><h1>{lines(t('web_review_title'))}</h1><p>{t('web_review_body')}</p><ErrorBox message={rental.error??t('web_review_fallback')}/><dl className="detail-list"><div><dt>{t('web_receipt_reference')}</dt><dd className="mono">{rental.id.slice(0,8).toUpperCase()}</dd></div></dl><Cta href="/support" outline>{t('web_common_support')}</Cta></section>:cancelled&&rental?<section className="rental-card"><Eyebrow>{t(rental.state==='EXPIRED'?'web_cancelled_eyebrowExpired':'web_cancelled_eyebrowCancelled')}</Eyebrow><h1>{lines(t(rental.state==='EXPIRED'?'web_cancelled_titleExpired':'web_cancelled_titleCancelled'))}</h1><p>{t('web_cancelled_body')}</p><Button className="cta" onClick={()=>{setDismissed(true);setRental(null);key.current=null;setAccepted(false);}}>{t('web_receipt_newRental')}</Button><Cta href="/stations" outline>{t('web_common_otherStation')}</Cta></section>:lost&&rental?<section className="rental-card"><Eyebrow>{t('web_lost_eyebrow')}</Eyebrow><h1>{lines(t('web_lost_title'))}</h1><p>{t('web_lost_body')}</p><dl className="detail-list"><div><dt>{t('web_common_charged')}</dt><dd>{euro(rental.payment?.capturedCents??0)}</dd></div><div><dt>{t('web_receipt_reference')}</dt><dd className="mono">{rental.id.slice(0,8).toUpperCase()}</dd></div></dl><Cta href="/support" outline>{t('web_common_support')}</Cta><Button className="cta" onClick={()=>{setDismissed(true);setRental(null);key.current=null;setAccepted(false);}}>{t('web_receipt_newRental')}</Button></section>:<section className="rental-card"><div className="card-heading"><span className="rental-icon"><ScanLine size={25}/></span><Status value={station.online?'online':'offline'}/></div><Eyebrow>{t('web_intro_eyebrow')}</Eyebrow><h1>{station.venue.name}</h1><p className="rental-availability"><BatteryCharging size={18}/>{t('web_intro_available',{count:String(station.available),plural:station.available>1?'s':''})}</p><div className="rental-price"><strong>{euro(pricing.hourlyCents)}</strong><span>{t('web_intro_perHour')}</span></div><div className="rental-promises"><div><Check/><span>{t('web_intro_max')} <strong>{euro(pricing.capCents)}</strong></span></div><div><ShieldCheck/><span>{t('web_intro_deposit')} <strong>{euro(pricing.depositCents)}</strong></span></div><div><Clock/><span>{t('web_intro_returnWithin')} <strong>{pricing.deadlineHours} heures</strong></span></div></div>{pub.data?.emailEnabled&&<label className="field-label rental-contact">{t('web_intro_emailLabel')}<input type="email" inputMode="email" autoComplete="email" maxLength={200} value={contactEmail} onChange={e=>setContactEmail(e.target.value)} placeholder={t('web_intro_emailPlaceholder')}/><span className="small muted">{t('web_intro_emailHelp')}</span></label>}<div className="terms-check"><Checkbox id="terms" checked={accepted} onCheckedChange={v=>setAccepted(v===true)}/><label htmlFor="terms">{t('web_intro_acceptPrefix')}<Link href="/terms" target="_blank">{t('web_intro_acceptTermsLink')}</Link>{t(payment!=='mock'?'web_intro_acceptSuffixLive':'web_intro_acceptSuffix',{amount:euro(pricing.depositCents)})}</label></div>{error&&<ErrorBox message={error}/>}<Button className="cta full" disabled={!accepted||!station.online||station.available===0||busy} onClick={start}>{t('web_intro_cta')}<ArrowUpRight size={18}/></Button><p className="security-note"><ShieldCheck size={14}/>{t(real?'web_intro_securityNoteLive':payment==='stripe_test'?'web_intro_securityNoteTest':'web_intro_securityNote')}</p>{!station.online&&<ErrorBox message={t('web_intro_offline')}/>}{station.online&&station.available===0&&<ErrorBox message={t('web_intro_noBattery')}/>}</section>}<div className="rental-footer"><span>Scannez.</span><span>Emportez.</span><span>Profitez.</span></div></main></div>;
}
