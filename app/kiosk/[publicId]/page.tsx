'use client';
import {use, useCallback, useEffect, useState} from 'react';
import {useApi, type PublicData} from '@/components/batyeo/shared';
import {KioskPoster, KioskPromo, type PosterPromo} from '@/components/batyeo/kiosk-poster';
import {resolveKioskStrings, type KioskStringKey, type RuntimeTranslations} from '@/core/i18n';
import type {PosterPayload} from '@/core/screen';

/** The poster is the resting screen; promos and BATYEO media only ever interrupt it briefly. */
const POSTER_MS = 20_000;
/** Someone touched the screen: they are reading or about to scan, so nothing rotates away under them. */
const TOUCH_HOLD_MS = 60_000;

interface KioskMediaItem {id: string; kind: 'IMAGE' | 'VIDEO'; uri: string; durationMs: number}
interface KioskDisplayConfig {venueName: string; idleContent: string; maintenanceBanner: string | null; refreshIntervalMs: number; playlist: KioskMediaItem[]; poster: PosterPayload | null}
type Slide = {kind: 'poster'} | {kind: 'promo'; promo: PosterPromo & {durationMs: number}} | {kind: 'media'; item: KioskMediaItem};

// A fixed-size, self-hosted kiosk screen — not a page asset Next.js needs to optimize.
function PromoMedia({item}: {item: KioskMediaItem}) {
 if (item.kind === 'VIDEO') return <video key={item.id} src={item.uri} autoPlay muted playsInline style={styles.media} />;
 // eslint-disable-next-line @next/next/no-img-element
 return <img key={item.id} src={item.uri} alt="" style={styles.media} />;
}

export default function KioskPage({params}: {params: Promise<{publicId: string}>}) {
 const {publicId} = use(params);
 const {data, error, loading} = useApi<PublicData>('public', 15000);
 const {data: display} = useApi<KioskDisplayConfig>('display/' + publicId, 20000);
 const {data: translationData} = useApi<{locale: string; translations: RuntimeTranslations | null}>('translations/' + publicId);
 const station = data?.stations.find(s => s.publicId === publicId);
 const qrTarget = typeof window !== 'undefined' ? `${window.location.origin}/rent/${encodeURIComponent(publicId)}` : `/rent/${encodeURIComponent(publicId)}`;
 const strings = resolveKioskStrings(translationData?.translations ?? null, translationData?.locale ?? 'fr-FR');
 const t = (key: KioskStringKey, vars?: Record<string, string>) => Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), strings[key]);

 // Poster between every interruption: poster, promo, poster, video… so the QR is never away for long.
 const extras: Slide[] = [...(display?.poster?.promos ?? []).map(promo => ({kind: 'promo' as const, promo})), ...(display?.playlist ?? []).map(item => ({kind: 'media' as const, item}))];
 const slides: Slide[] = extras.length ? extras.flatMap(extra => [{kind: 'poster' as const}, extra]) : [{kind: 'poster'}];
 const [index, setIndex] = useState(0);
 const [holdUntil, setHoldUntil] = useState(0);
 const slide = slides[index % slides.length];
 const slideMs = slide.kind === 'poster' ? POSTER_MS : slide.kind === 'promo' ? slide.promo.durationMs : slide.item.durationMs;
 useEffect(() => {
  if (slides.length < 2) return;
  const wait = Math.max(slideMs, holdUntil - Date.now());
  const timer = setTimeout(() => setIndex(i => (i + 1) % slides.length), wait);
  return () => clearTimeout(timer);
 }, [index, slides.length, slideMs, holdUntil]);
 const hold = useCallback(() => { setIndex(i => i - (i % slides.length)); setHoldUntil(Date.now() + TOUCH_HOLD_MS); }, [slides.length]);

 const poster = display?.poster;
 const canRent = !!station?.online && (station?.available ?? 0) > 0;

 return (
  <main style={styles.screen} onPointerDown={slide.kind === 'poster' ? undefined : hold}>
   {display?.maintenanceBanner && <div style={styles.banner}>{display.maintenanceBanner}</div>}
   {loading && <p style={styles.status}>{t('kiosk_loading')}</p>}
   {!loading && error && <p style={styles.error}>{t('kiosk_connectionLost')}</p>}
   {!loading && !error && !station && <p style={styles.error}>{t('kiosk_stationNotFound', {publicId})}</p>}
   {station && poster && data && (
    <div style={styles.stage}>
     {slide.kind === 'poster' && <KioskPoster branding={poster.branding} onInteract={hold} live={{venueName: poster.venueName, city: station.venue.city, online: station.online, available: station.available, hourlyCents: data.pricing.hourlyCents, capCents: data.pricing.capCents, depositCents: data.pricing.depositCents, qrTarget}}/>}
     {slide.kind === 'promo' && <KioskPromo promo={slide.promo} branding={poster.branding} venueName={poster.venueName} qrTarget={qrTarget} canRent={canRent}/>}
     {slide.kind === 'media' && <div style={styles.mediaFrame}><PromoMedia item={slide.item}/></div>}
    </div>
   )}
  </main>
 );
}

// The cabinet screen is landscape and cannot scroll: the 16:9 stage is letterboxed to fit whatever panel it runs on.
const styles = {
 screen: {height: '100vh', width: '100vw', overflow: 'hidden', position: 'relative' as const, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#f4f6ee', fontFamily: 'system-ui, sans-serif', textAlign: 'center' as const},
 stage: {width: 'min(100vw, calc(100vh * 16 / 9))'},
 mediaFrame: {width: '100%', aspectRatio: '16 / 9', background: '#000'},
 media: {width: '100%', height: '100%', objectFit: 'cover' as const},
 status: {fontSize: 22, color: '#d8ed98'},
 error: {fontSize: 22, color: '#ffd7d0', maxWidth: 480},
 banner: {position: 'absolute' as const, top: 0, left: 0, right: 0, background: 'rgba(157,63,53,0.92)', color: '#fff', padding: '14px 24px', fontSize: 18, fontWeight: 700, zIndex: 10},
};
