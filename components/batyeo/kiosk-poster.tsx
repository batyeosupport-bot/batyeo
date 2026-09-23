'use client';
import {useEffect, useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {POSTER_LOCALES, posterAvailability, posterPrice, resolvePosterText, type PosterCopy, type PosterLocale} from '@/core/poster-i18n';

/** What BATYEO designs for a venue. The partner never edits this. */
export interface PosterBranding {logoUrl: string | null; backgroundUrl: string | null; primary: string; accent: string; locales: PosterLocale[]; copy: Partial<Record<PosterLocale, PosterCopy>>}
/** What the poster reads live, so it can never advertise a price or a stock the station doesn't have. */
export interface PosterLive {venueName: string; city: string; online: boolean; available: number; hourlyCents: number; capCents: number; depositCents: number; qrTarget: string}

export const POSTER_THEMES: Record<string, Pick<PosterBranding, 'primary' | 'accent'> & {label: string}> = {
 sport: {label: 'Bar sportif', primary: '#0f1f14', accent: '#b6ff3b'},
 lounge: {label: 'Lounge', primary: '#140f0a', accent: '#f3c969'},
 hotel: {label: 'Hôtel', primary: '#0d1a2e', accent: '#f4ead6'},
 batyeo: {label: 'BATYEO', primary: '#19382c', accent: '#d8ed98'},
};

const HEADLINE_MS = 5000;
/** Nobody taps a poster: languages take turns, long enough to read two headlines each. */
const LOCALE_MS = 10_000;
const STEP_MS = 2200;
const CHARGE_MS = 7000;
const FULL_HOLD_MS = 1600;

function useCharge() {
 const [level, setLevel] = useState(8);
 useEffect(() => {
  // A plain timer rather than requestAnimationFrame: cabinet WebViews throttle rAF when they think nobody is watching.
  const start = Date.now();
  const timer = setInterval(() => {
   const t = (Date.now() - start) % (CHARGE_MS + FULL_HOLD_MS);
   setLevel(t >= CHARGE_MS ? 100 : Math.round(8 + 92 * (t / CHARGE_MS)));
  }, 60);
  return () => clearInterval(timer);
 }, []);
 return level;
}

function useCycle(length: number, ms: number) {
 const [index, setIndex] = useState(0);
 useEffect(() => {
  if (length < 2) return;
  const timer = setInterval(() => setIndex(i => (i + 1) % length), ms);
  return () => clearInterval(timer);
 }, [length, ms]);
 return length ? index % length : 0;
}

function levelColor(level: number, accent: string) {
 if (level < 25) return '#ff4d3d';
 if (level < 55) return '#ffa630';
 return accent;
}

function Battery({level, accent}: {level: number; accent: string}) {
 const color = levelColor(level, accent);
 const fillHeight = 300 * level / 100;
 return (
  <svg viewBox="0 0 200 400" className="kp-battery" aria-hidden="true">
   <defs>
    <filter id="kp-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="kp-cell"><rect x="30" y="60" width="140" height="320" rx="26"/></clipPath>
   </defs>
   <rect x="72" y="24" width="56" height="30" rx="10" fill={color} opacity=".9"/>
   <rect x="22" y="52" width="156" height="336" rx="34" fill="rgba(0,0,0,.35)" stroke={color} strokeWidth="8" filter="url(#kp-glow)"/>
   <g clipPath="url(#kp-cell)">
    <rect x="30" y={370 - fillHeight} width="140" height={fillHeight + 10} fill={color} opacity=".92"/>
    <rect x="30" y={370 - fillHeight} width="140" height="10" fill="#fff" opacity=".35" className="kp-wave"/>
   </g>
   <path d="M112 150 L78 232 H104 L92 300 L132 206 H106 Z" fill="#fff" className="kp-bolt"/>
  </svg>
 );
}

export function KioskPoster({branding, live}: {branding: PosterBranding; live: PosterLive}) {
 const level = useCharge();
 const locales: PosterLocale[] = branding.locales.length ? branding.locales : ['fr-FR'];
 const locale = locales[useCycle(locales.length, LOCALE_MS)];
 const {strings: t, headlines, tagline} = resolvePosterText(locale, branding.copy[locale]);
 const steps = [t.step1, t.step2, t.step3, t.step4];
 const headline = useCycle(headlines.length, HEADLINE_MS);
 const step = useCycle(steps.length, STEP_MS);
 const canRent = live.online && live.available > 0;
 const vars = {'--kp-primary': branding.primary, '--kp-accent': branding.accent} as React.CSSProperties;

 return (
  <div className="kp-frame" style={vars} lang={locale}>
   <style>{POSTER_CSS}</style>
   <div className="kp-poster">
    <div className="kp-bg" style={branding.backgroundUrl ? {backgroundImage: `url(${JSON.stringify(branding.backgroundUrl)})`} : undefined}/>
    <div className="kp-shade"/>

    <section className="kp-left">
     <div className="kp-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {branding.logoUrl ? <img src={branding.logoUrl} alt={live.venueName}/> : <span>{live.venueName}</span>}
     </div>
     <div className="kp-headlines">
      {headlines.map((h, i) => <h1 key={locale + i} className={'kp-headline' + (i === headline ? ' is-on' : '')}>{h}</h1>)}
     </div>
     <p className="kp-tagline">{tagline}</p>
     <div className="kp-prices">
      <div className="kp-price"><strong>{posterPrice(locale, live.hourlyCents)}</strong><span>{t.perHour}</span></div>
      <div className="kp-price"><strong>{posterPrice(locale, live.capCents)}</strong><span>{t.capDay}</span></div>
      <div className="kp-price"><strong>{posterPrice(locale, live.depositCents)}</strong><span>{t.deposit}</span></div>
     </div>
     <div className="kp-pay"><span>Apple Pay</span><span>Google Pay</span><span>CB</span><span>Visa</span><span>Mastercard</span></div>
    </section>

    <section className="kp-middle">
     <Battery level={level} accent={branding.accent}/>
     <p className="kp-level">{level}<small>%</small></p>
     <p className="kp-charging">{level === 100 ? t.charged : t.charging}</p>
    </section>

    <section className="kp-right">
     {canRent ? (
      <>
       <div className="kp-qr"><QRCodeSVG value={live.qrTarget} size={512} bgColor="#ffffff" fgColor="#0b0b0b" style={{width: '100%', height: '100%'}}/></div>
       <p className="kp-scan">{t.scan}</p>
       <p className="kp-stock"><i/>{posterAvailability(locale, live.available)}</p>
      </>
     ) : (
      <div className="kp-unavailable">{live.online ? t.allRented : t.offline}</div>
     )}
    </section>

    <footer className="kp-steps">
     {steps.map((label, i) => <div key={i} className={'kp-step' + (i === step ? ' is-on' : '')}><b>{i + 1}</b>{label}</div>)}
     {locales.length > 1 && <div className="kp-langs">{locales.map(l => <span key={l} className={l === locale ? 'is-on' : ''}>{POSTER_LOCALES.find(p => p.locale === l)?.code}</span>)}</div>}
     <span className="kp-brand">batyeo<em>.</em></span>
    </footer>
   </div>
  </div>
 );
}

// Everything is sized in container units: the same poster fills a 10" cabinet screen or a 4K preview identically.
const POSTER_CSS = `
.kp-frame{width:100%;aspect-ratio:16/9;container-type:size;position:relative;overflow:hidden;background:var(--kp-primary);font-family:'Arial Narrow','Helvetica Neue',Arial,sans-serif;color:#fff}
.kp-poster{position:absolute;inset:0;display:grid;grid-template-columns:1.25fr .8fr .75fr;grid-template-rows:minmax(0,1fr) auto;gap:0 2.4cqw;padding:2.6cqw 3.2cqw 2.2cqw}
.kp-bg{position:absolute;inset:-4%;background:radial-gradient(circle at 70% 30%,color-mix(in srgb,var(--kp-accent) 22%,transparent),transparent 55%),radial-gradient(circle at 10% 90%,color-mix(in srgb,var(--kp-accent) 12%,transparent),transparent 50%),var(--kp-primary);background-size:cover;background-position:center;animation:kp-drift 24s ease-in-out infinite alternate}
.kp-shade{position:absolute;inset:0;background:linear-gradient(90deg,color-mix(in srgb,var(--kp-primary) 94%,transparent) 0%,color-mix(in srgb,var(--kp-primary) 70%,transparent) 55%,color-mix(in srgb,var(--kp-primary) 88%,transparent) 100%)}
.kp-left,.kp-middle,.kp-right,.kp-steps{position:relative;z-index:1}
.kp-left{display:flex;flex-direction:column;gap:1.1cqw;min-width:0;min-height:0}
.kp-logo{height:6cqw;display:flex;align-items:center}
.kp-logo img{max-height:100%;max-width:22cqw;object-fit:contain;filter:drop-shadow(0 .3cqw .8cqw rgba(0,0,0,.5))}
.kp-logo span{font-size:2.6cqw;font-weight:900;letter-spacing:.04em;text-transform:uppercase;border:.25cqw solid var(--kp-accent);padding:.5cqw 1.4cqw;border-radius:1cqw}
.kp-headlines{position:relative;height:10.4cqw}
.kp-headline{position:absolute;inset:0;margin:0;font-size:4.8cqw;line-height:1;font-weight:900;text-transform:uppercase;font-style:italic;color:var(--kp-accent);text-shadow:0 0 2.2cqw color-mix(in srgb,var(--kp-accent) 55%,transparent);opacity:0;transform:translateY(1.2cqw);transition:opacity .7s,transform .7s}
.kp-headline.is-on{opacity:1;transform:none}
.kp-tagline{margin:0;font-size:1.7cqw;font-weight:700;color:#f2f2f2}
.kp-prices{display:flex;flex-direction:column;gap:.7cqw}
.kp-price{display:flex;align-items:center;gap:1.4cqw;border:.2cqw solid color-mix(in srgb,var(--kp-accent) 75%,transparent);background:rgba(0,0,0,.45);border-radius:1cqw;padding:.35cqw 1.3cqw;width:25cqw}
.kp-price strong{font-size:2.9cqw;font-weight:900;min-width:7cqw}
.kp-price span{white-space:pre-line;font-size:1.15cqw;font-weight:700;text-transform:uppercase;line-height:1.15;color:#e6e6e6}
.kp-pay{display:flex;gap:.6cqw;flex-wrap:wrap;margin-top:.4cqw}
.kp-pay span{font-size:1cqw;font-weight:800;background:#fff;color:#111;border-radius:.5cqw;padding:.35cqw .8cqw}
.kp-middle{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4cqw}
.kp-battery{height:30cqw;width:auto;overflow:visible}
.kp-wave{animation:kp-wave 1.2s ease-in-out infinite}
.kp-bolt{transform-origin:105px 225px;animation:kp-pulse 1.4s ease-in-out infinite}
.kp-level{margin:0;font-size:5cqw;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
.kp-level small{font-size:2.4cqw;margin-left:.2cqw}
.kp-charging{margin:0;font-size:1.4cqw;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--kp-accent)}
.kp-right{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2cqw}
.kp-qr{width:100%;max-width:22cqw;aspect-ratio:1;background:#fff;border-radius:1.6cqw;padding:1.4cqw;box-shadow:0 0 0 .35cqw var(--kp-accent),0 0 3cqw color-mix(in srgb,var(--kp-accent) 50%,transparent)}
.kp-scan{margin:0;text-align:center;line-height:1.05;font-size:2.4cqw;font-weight:900;text-transform:uppercase;font-style:italic}
.kp-stock{margin:0;display:flex;align-items:center;gap:.8cqw;font-size:1.5cqw;font-weight:700;background:rgba(0,0,0,.5);border-radius:99cqw;padding:.6cqw 1.4cqw}
.kp-stock i{width:1cqw;height:1cqw;border-radius:50%;background:var(--kp-accent);animation:kp-blink 1.6s ease-in-out infinite}
.kp-unavailable{font-size:2.2cqw;font-weight:800;text-align:center;background:rgba(0,0,0,.55);border:.2cqw solid #ff8a7a;border-radius:1.4cqw;padding:2cqw}
.kp-steps{grid-column:1/-1;display:flex;align-items:center;gap:1cqw;margin-top:1.2cqw}
.kp-step{display:flex;align-items:center;gap:.8cqw;font-size:1.3cqw;font-weight:700;background:rgba(0,0,0,.45);border:.15cqw solid rgba(255,255,255,.18);border-radius:99cqw;padding:.55cqw 1.3cqw .55cqw .55cqw;transition:all .5s}
.kp-step b{display:grid;place-items:center;width:2cqw;height:2cqw;border-radius:50%;background:rgba(255,255,255,.15);font-size:1.1cqw}
.kp-step.is-on{background:var(--kp-accent);color:var(--kp-primary);border-color:var(--kp-accent);transform:scale(1.05)}
.kp-step.is-on b{background:var(--kp-primary);color:var(--kp-accent)}
.kp-langs{margin-left:auto;display:flex;gap:.4cqw}
.kp-langs+.kp-brand{margin-left:1.2cqw}
.kp-langs span{font-size:1cqw;font-weight:800;padding:.3cqw .6cqw;border-radius:.5cqw;color:rgba(255,255,255,.55);transition:all .4s}
.kp-langs span.is-on{background:#fff;color:var(--kp-primary)}
.kp-brand{margin-left:auto;font-size:1.8cqw;font-weight:900;letter-spacing:.02em}
.kp-brand em{color:var(--kp-accent);font-style:normal}
@keyframes kp-drift{from{transform:scale(1)}to{transform:scale(1.08) translate(-1%,-1%)}}
@keyframes kp-wave{0%,100%{opacity:.15}50%{opacity:.5}}
@keyframes kp-pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.12);opacity:1}}
@keyframes kp-blink{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.kp-bg,.kp-wave,.kp-bolt,.kp-stock i{animation:none}}
`;
