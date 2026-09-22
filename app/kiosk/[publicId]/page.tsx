'use client';
import {use, useEffect, useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {useApi, type PublicData} from '@/components/batyeo/shared';
import {euro} from '@/core/pricing';
import {resolveKioskStrings, type KioskStringKey, type RuntimeTranslations} from '@/core/i18n';

/** How long the price/QR screen shows before the promotional carousel takes over, when media exists. */
const INFO_SLIDE_MS = 20_000;
/** Nobody touches this screen, so the languages take turns instead of waiting for a tap. */
const LOCALE_ROTATION_MS = 10_000;

interface KioskMediaItem {id: string; kind: 'IMAGE' | 'VIDEO'; uri: string; durationMs: number}
interface KioskDisplayConfig {venueName: string; idleContent: string; maintenanceBanner: string | null; refreshIntervalMs: number; playlist: KioskMediaItem[]}

// A fixed-size, self-hosted kiosk screen — not a page asset Next.js needs to optimize.
function PromoMedia({item}: {item: {id: string; kind: 'IMAGE' | 'VIDEO'; uri: string}}) {
 if (item.kind === 'VIDEO') return <video key={item.id} src={item.uri} autoPlay muted playsInline style={styles.promoMedia} />;
 // eslint-disable-next-line @next/next/no-img-element
 return <img key={item.id} src={item.uri} alt="" style={styles.promoMedia} />;
}

export default function KioskPage({params}: {params: Promise<{publicId: string}>}) {
 const {publicId} = use(params);
 const {data, error, loading} = useApi<PublicData>('public', 15000);
 const {data: display} = useApi<KioskDisplayConfig>('display/' + publicId, 20000);
 const {data: translationData} = useApi<{locale: string; translations: RuntimeTranslations | null}>('translations/' + publicId);
 const station = data?.stations.find(s => s.publicId === publicId);
 const qrTarget = typeof window !== 'undefined' ? `${window.location.origin}/rent/${encodeURIComponent(publicId)}` : `/rent/${encodeURIComponent(publicId)}`;

 // A station with no configured translations keeps exactly one locale — the rotation below is then inert.
 const translations = translationData?.translations ?? null;
 const locales = translations?.available.length ? translations.available.map(l => l.locale) : [translationData?.locale ?? 'fr-FR'];
 const [localeIndex, setLocaleIndex] = useState(0);
 useEffect(() => {
  if (locales.length < 2) return;
  const timer = setInterval(() => setLocaleIndex(prev => (prev + 1) % locales.length), LOCALE_ROTATION_MS);
  return () => clearInterval(timer);
 }, [locales.length]);
 const strings = resolveKioskStrings(translations, locales[localeIndex % locales.length]);
 const t = (key: KioskStringKey, vars?: Record<string, string>) => {
  let value = strings[key];
  if (vars) for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, replacement);
  return value;
 };

 // -1 = the price/QR screen; 0..n-1 = an index into the promotional playlist.
 const [slide, setSlide] = useState(-1);
 const playlist = display?.playlist ?? [];
 useEffect(() => {
  if (!playlist.length) return;
  const duration = slide === -1 ? INFO_SLIDE_MS : (playlist[slide]?.durationMs ?? INFO_SLIDE_MS);
  const timer = setTimeout(() => setSlide(prev => { const next = prev + 1; return next >= playlist.length ? -1 : next; }), duration);
  return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [slide, playlist.length]);
 // Out-of-range once the playlist shrinks (or is empty) simply falls back to the info screen — no extra state to keep in sync.
 const promo = playlist.length ? playlist[slide] : undefined;

 return (
  <main style={styles.screen}>
   <style>{KIOSK_CSS}</style>
   {display?.maintenanceBanner && <div style={styles.banner}>{display.maintenanceBanner}</div>}
   {loading && <p style={styles.status}>{t('kiosk_loading')}</p>}
   {!loading && error && <p style={styles.error}>{t('kiosk_connectionLost')}</p>}
   {!loading && !error && !station && <p style={styles.error}>{t('kiosk_stationNotFound', {publicId})}</p>}
   {station && promo && (
    <div className="kiosk-promo">
     <PromoMedia item={promo} />
     {station.online && <div className="kiosk-corner-qr" style={styles.cornerQr}>
      <QRCodeSVG value={qrTarget} size={96} bgColor="#f7f8f2" fgColor="#19382c" />
      <span style={styles.cornerLabel}>{t('kiosk_scanToRent')}</span>
     </div>}
    </div>
   )}
   {station && !promo && (
    <div className="kiosk-layout">
     <div className="kiosk-info">
      <p style={styles.eyebrow}>batyeo<span style={styles.dot}>.</span></p>
      <h1 style={styles.title}>{station.venue.name}</h1>
      <p style={styles.subtitle}>{station.venue.city}</p>
      {display?.idleContent && <p style={styles.idleContent}>{display.idleContent}</p>}
      <div style={styles.badge(station.online)}>{t(station.online ? 'kiosk_online' : 'kiosk_offline')}</div>
      {station.online && <p style={styles.count}>{station.available > 0 ? t('kiosk_available', {count: String(station.available), plural: station.available > 1 ? 's' : ''}) : t('kiosk_allRented')}</p>}
      {station.online && data?.pricing && <p style={styles.price}>{t('kiosk_price', {hourly: euro(data.pricing.hourlyCents), cap: euro(data.pricing.capCents)})}<br/>{t('kiosk_deposit', {deposit: euro(data.pricing.depositCents)})}</p>}
      {station.online && <ol style={styles.steps}><li>{t('kiosk_step1')}</li><li>{t('kiosk_step2')}</li><li>{t('kiosk_step3')}</li><li>{t('kiosk_step4')}</li></ol>}
      {!station.online && <p style={styles.error}>{t('kiosk_unavailable')}</p>}
     </div>
     {station.online && <div className="kiosk-qr">
      <div style={styles.qrCard}>
       <QRCodeSVG value={qrTarget} size={260} bgColor="#f7f8f2" fgColor="#19382c" />
      </div>
      <p style={styles.instructions}>{t('kiosk_scanInstructions')}</p>
     </div>}
    </div>
   )}
  </main>
 );
}

// Cabinet screens are landscape and cannot scroll: two columns keep the QR, the price and the steps all on screen at once.
const KIOSK_CSS = `
.kiosk-layout{display:flex;flex-direction:column;align-items:center;gap:20px}
.kiosk-info,.kiosk-qr{display:flex;flex-direction:column;align-items:center;gap:12px}
.kiosk-promo{position:absolute;inset:0;background:#000}
@media (orientation:landscape){
 .kiosk-layout{flex-direction:row;justify-content:center;gap:64px;width:100%}
 .kiosk-info{align-items:flex-start;text-align:left;max-width:520px}
}`;

const styles = {
 screen: {minHeight: '100vh', width: '100%', position: 'relative' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 20, background: '#19382c', color: '#f4f6ee', padding: 32, textAlign: 'center' as const, fontFamily: 'system-ui, sans-serif'},
 status: {fontSize: 22, color: '#d8ed98'},
 error: {fontSize: 22, color: '#ffd7d0', maxWidth: 480},
 eyebrow: {fontSize: 20, fontWeight: 800, margin: 0},
 dot: {color: '#d8ed98'},
 title: {fontSize: 44, fontWeight: 700, margin: 0, lineHeight: 1.1},
 subtitle: {fontSize: 22, color: '#c7d3c2', margin: 0},
 idleContent: {fontSize: 18, color: '#d8ed98', margin: 0, maxWidth: 480},
 count: {fontSize: 26, fontWeight: 600, margin: 0},
 qrCard: {background: '#f7f8f2', borderRadius: 24, padding: 20},
 price: {fontSize: 20, fontWeight: 600, margin: 0, maxWidth: 520, color: '#d8ed98'},
 steps: {display: 'flex', flexDirection: 'column' as const, gap: 6, listStyle: 'none', padding: 0, margin: 0, fontSize: 17, color: '#c7d3c2'},
 instructions: {fontSize: 18, color: '#c7d3c2', maxWidth: 420, margin: 0},
 badge: (online: boolean) => ({padding: '8px 20px', borderRadius: 999, fontSize: 16, fontWeight: 700, background: online ? '#d8ed98' : '#e7a99c', color: '#19382c'}),
 banner: {position: 'absolute' as const, top: 0, left: 0, right: 0, background: 'rgba(157,63,53,0.9)', color: '#fff', padding: '14px 24px', fontSize: 16, fontWeight: 600, zIndex: 10},
 promoMedia: {width: '100%', height: '100%', objectFit: 'cover' as const},
 cornerQr: {position: 'absolute' as const, bottom: 24, right: 24, background: '#f7f8f2', borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6},
 cornerLabel: {fontSize: 12, fontWeight: 700, color: '#19382c'},
};
