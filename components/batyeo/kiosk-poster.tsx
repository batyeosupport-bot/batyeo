'use client';
import {useEffect, useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {POSTER_LOCALES, posterAvailability, posterPrice, resolvePosterText, type PosterCopy, type PosterLocale} from '@/core/poster-i18n';

/** What BATYEO designs for a venue. The partner never edits this. */
export interface PosterBranding {logoUrl: string | null; backgroundUrl: string | null; primary: string; accent: string; locales: PosterLocale[]; copy: Partial<Record<PosterLocale, PosterCopy>>}
/** What the poster reads live, so it can never advertise a price or a stock the station doesn't have. */
export interface PosterLive {venueName: string; city: string; online: boolean; available: number; hourlyCents: number; capCents: number; depositCents: number; qrTarget: string}
export {POSTER_THEMES} from '@/core/screen';
/** A venue promo as the screen receives it: the schedule label is computed server-side, in Paris time. */
export interface PosterPromo {id: string; title: string; subtitle: string; highlight: string; imageUrl: string | null; schedule: string}

const KICKER_MS = 4500;
const STEP_MS = 2200;
const SCENE_MS = 6000;
const CHARGE_MS = 5000;
const FULL_HOLD_MS = 1000;
/** French is the resting language: a tourist's choice holds while they read and scan, then the screen goes back. */
const LOCALE_RESET_MS = 60_000;

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
   <defs><clipPath id="kp-cell"><rect x="30" y="60" width="140" height="320" rx="26"/></clipPath></defs>
   <rect x="72" y="24" width="56" height="30" rx="10" fill={color}/>
   <rect x="22" y="52" width="156" height="336" rx="34" fill="rgba(0,0,0,.4)" stroke={color} strokeWidth="10" style={{filter: `drop-shadow(0 0 14px ${color})`}}/>
   <g clipPath="url(#kp-cell)">
    <rect x="30" y={370 - fillHeight} width="140" height={fillHeight + 10} fill={color}/>
    <rect x="30" y={370 - fillHeight} width="140" height="12" fill="#fff" opacity=".4" className="kp-wave"/>
   </g>
   <path d="M112 150 L78 232 H104 L92 300 L132 206 H106 Z" fill="#fff" className="kp-bolt"/>
  </svg>
 );
}

const ICONS = {
 clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
 day: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><text x="12" y="19" textAnchor="middle" fontSize="7" fontWeight="900" stroke="none" fill="currentColor">24</text></>,
 shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></>,
 qr: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3M14 20h2"/></>,
 phone: <><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></>,
 battery: <><rect x="7" y="4" width="10" height="17" rx="2"/><path d="M10 2h4M12.5 8l-2 4h3l-2 4"/></>,
 return: <><path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M4 20v-5h5"/></>,
};
function Icon({name}: {name: keyof typeof ICONS}) {
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

/** The product itself, standing next to the phone — the thing the customer walks away with. */
function BatteryStick() {
 return (
  <div className="kp-stick" aria-hidden="true">
   <span className="kp-stick-cap"/>
   <span className="kp-stick-word">batyeo<em>.</em></span>
   <span className="kp-stick-bolt"><Icon name="battery"/></span>
  </div>
 );
}

function Sparkles() {
 return <div className="kp-sparkles" aria-hidden="true">{[[8, 18, 0], [46, 8, 1.2], [63, 86, .6], [95, 30, 1.8], [30, 92, 2.4], [80, 62, 3]].map(([x, y, d], i) => <i key={i} style={{left: `${x}%`, top: `${y}%`, animationDelay: `${d}s`}}/>)}</div>;
}

export function KioskPoster({branding, live, onInteract}: {branding: PosterBranding; live: PosterLive; onInteract?: () => void}) {
 const level = useCharge();
 const locales: PosterLocale[] = branding.locales.length ? branding.locales : ['fr-FR'];
 const [chosen, setChosen] = useState<PosterLocale | null>(null);
 const locale = chosen && locales.includes(chosen) ? chosen : locales[0];
 useEffect(() => {
  if (!chosen) return;
  const timer = setTimeout(() => setChosen(null), LOCALE_RESET_MS);
  return () => clearTimeout(timer);
 }, [chosen]);
 const choose = (l: PosterLocale) => { setChosen(l === locales[0] ? null : l); onInteract?.(); };

 const {strings: t, headlines, tagline} = resolvePosterText(locale, branding.copy[locale]);
 const hero = headlines[0];
 const kickers = headlines.length > 1 ? headlines.slice(1) : [tagline];
 const kicker = useCycle(kickers.length, KICKER_MS);
 const steps: [string, keyof typeof ICONS][] = [[t.step1, 'qr'], [t.step2, 'phone'], [t.step3, 'battery'], [t.step4, 'return']];
 const step = useCycle(steps.length, STEP_MS);
 const scene = useCycle(3, SCENE_MS);
 const canRent = live.online && live.available > 0;
 const vars = {'--kp-primary': branding.primary, '--kp-accent': branding.accent} as React.CSSProperties;
 const photo = branding.backgroundUrl ? {backgroundImage: `url(${JSON.stringify(branding.backgroundUrl)})`} : undefined;

 return (
  <div className="kp-frame" style={vars} lang={locale}>
   <style>{POSTER_CSS}</style>
   <div className="kp-bg" style={photo}/>
   <div className="kp-shade"/>
   <div className="kp-rays" aria-hidden="true"/>
   <Sparkles/>
   <div className="kp-poster">
    <header className="kp-top">
     <div className="kp-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {branding.logoUrl ? <img src={branding.logoUrl} alt={live.venueName}/> : <span>{live.venueName}</span>}
     </div>
     {locales.length > 1 && <nav className="kp-langs" aria-label="Langue · Language">{locales.map(l => <button type="button" key={l} lang={l} className={l === locale ? 'is-on' : ''} onClick={() => choose(l)}>{POSTER_LOCALES.find(p => p.locale === l)?.code}</button>)}</nav>}
    </header>

    <section className="kp-left">
     <h1 key={'h' + locale + hero} className="kp-hero">{hero}</h1>
     <p key={'k' + locale + kicker} className="kp-kicker">{kickers[kicker]}</p>
     <div className="kp-prices" key={'p' + locale}>
      <div className="kp-price"><span className="kp-ico"><Icon name="clock"/></span><strong>{posterPrice(locale, live.hourlyCents)}</strong><span className="kp-plabel">{t.perHour}</span></div>
      <div className="kp-price"><span className="kp-ico"><Icon name="day"/></span><strong>{posterPrice(locale, live.capCents)}</strong><span className="kp-plabel">{t.capDay}</span></div>
      <div className="kp-price"><span className="kp-ico"><Icon name="shield"/></span><strong>{posterPrice(locale, live.depositCents)}</strong><span className="kp-plabel">{t.deposit}</span></div>
     </div>
     <div className="kp-pay"><b>{t.accept}</b><span>Apple Pay</span><span>Google Pay</span><span>CB</span><span>Visa</span><span>Mastercard</span></div>
    </section>

    <BatteryStick/>

    <section className="kp-phone" aria-hidden="true">
     <div className="kp-notch"/>
     <div className={'kp-scene' + (scene === 0 ? ' is-on' : '')}>
      <Battery level={level} accent={branding.accent}/>
      <p className="kp-level">{level}<small>%</small></p>
      <p className="kp-charging">{level === 100 ? t.charged : t.charging}</p>
     </div>
     <div className={'kp-scene kp-scene-photo' + (scene === 1 ? ' is-on' : '')}>
      <div className="kp-scene-bg" style={photo}/>
      <p className="kp-scene-title">{kickers[kickers.length - 1]}</p>
      <p className="kp-scene-venue">{live.venueName}</p>
     </div>
     <div className={'kp-scene' + (scene === 2 ? ' is-on' : '')}>
      <p className="kp-scene-price">{posterPrice(locale, live.hourlyCents)}</p>
      <p className="kp-scene-sub">{t.perHour}</p>
      <p className="kp-scene-cap">max {posterPrice(locale, live.capCents)}</p>
     </div>
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
     {steps.map(([label, icon], i) => <div key={i} className={'kp-step' + (i === step ? ' is-on' : '')}><span className="kp-step-ico"><Icon name={icon}/></span>{label}</div>)}
     <span className="kp-brand">batyeo<em>.</em></span>
    </footer>
   </div>
  </div>
 );
}

// Everything is sized in container units: the same poster fills a 10" cabinet screen or a 4K preview identically.
// Anton (condensed poster capitals) and Kaushan Script (the hand-written kicker) fall back to Impact/cursive offline.
const POSTER_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Kaushan+Script&display=swap');
.kp-frame{width:100%;aspect-ratio:16/9;container-type:size;position:relative;overflow:hidden;background:var(--kp-primary);font-family:'Arial Narrow','Helvetica Neue',Arial,sans-serif;color:#fff;box-shadow:inset 0 0 0 .35cqw color-mix(in srgb,var(--kp-accent) 70%,transparent),inset 0 0 4cqw color-mix(in srgb,var(--kp-accent) 25%,transparent)}
.kp-bg{position:absolute;inset:-4%;background:radial-gradient(circle at 72% 40%,color-mix(in srgb,var(--kp-accent) 28%,transparent),transparent 50%),radial-gradient(circle at 10% 95%,color-mix(in srgb,var(--kp-accent) 16%,transparent),transparent 45%),var(--kp-primary);background-size:cover;background-position:center;animation:kp-drift 26s ease-in-out infinite alternate}
.kp-shade{position:absolute;inset:0;background:linear-gradient(90deg,color-mix(in srgb,var(--kp-primary) 92%,transparent) 0%,color-mix(in srgb,var(--kp-primary) 62%,transparent) 50%,color-mix(in srgb,var(--kp-primary) 85%,transparent) 100%),linear-gradient(0deg,rgba(0,0,0,.55),transparent 35%)}
.kp-rays{position:absolute;left:52%;top:40%;width:90cqw;height:90cqw;margin:-45cqw 0 0 -45cqw;background:repeating-conic-gradient(from 0deg,color-mix(in srgb,var(--kp-accent) 9%,transparent) 0deg 6deg,transparent 6deg 18deg);border-radius:50%;mask-image:radial-gradient(circle,#000 10%,transparent 60%);-webkit-mask-image:radial-gradient(circle,#000 10%,transparent 60%);animation:kp-spin 60s linear infinite}
.kp-sparkles i{position:absolute;width:1.2cqw;height:1.2cqw;background:radial-gradient(circle,#fff 0 12%,transparent 13%),conic-gradient(from 45deg,transparent 0 22%,#fff 23% 27%,transparent 28% 47%,#fff 48% 52%,transparent 53% 72%,#fff 73% 77%,transparent 78% 97%,#fff 98%);opacity:0;animation:kp-twinkle 3.6s ease-in-out infinite;filter:drop-shadow(0 0 .4cqw var(--kp-accent))}
.kp-poster{position:absolute;inset:0;z-index:1;display:grid;grid-template-columns:40cqw 5cqw 18cqw 1fr;grid-template-rows:auto minmax(0,1fr) auto;gap:0 1.6cqw;padding:2.2cqw 3cqw 2cqw}
.kp-top{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;height:5.6cqw}
.kp-logo{height:100%;display:flex;align-items:center}
.kp-logo img{max-height:100%;max-width:22cqw;object-fit:contain;filter:drop-shadow(0 .3cqw .8cqw rgba(0,0,0,.6))}
.kp-logo span{font-family:Anton,Impact,'Arial Narrow',sans-serif;font-size:2.4cqw;letter-spacing:.06em;text-transform:uppercase;border:.25cqw solid var(--kp-accent);padding:.35cqw 1.4cqw;border-radius:.8cqw;background:rgba(0,0,0,.4);box-shadow:0 0 1.4cqw color-mix(in srgb,var(--kp-accent) 45%,transparent)}
.kp-langs{display:flex;gap:.5cqw;background:rgba(0,0,0,.5);padding:.45cqw;border-radius:99cqw;border:.12cqw solid rgba(255,255,255,.15)}
.kp-langs button{appearance:none;border:0;cursor:pointer;font:inherit;font-size:1.35cqw;font-weight:800;min-width:3.6cqw;padding:.55cqw .9cqw;border-radius:99cqw;background:transparent;color:rgba(255,255,255,.75);transition:background .3s,color .3s}
.kp-langs button.is-on{background:var(--kp-accent);color:var(--kp-primary)}
.kp-left{display:flex;flex-direction:column;justify-content:center;gap:1cqw;min-width:0;min-height:0}
.kp-hero{margin:0;font-family:Anton,Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:6.6cqw;line-height:.95;text-transform:uppercase;color:var(--kp-accent);-webkit-text-stroke:.1cqw color-mix(in srgb,var(--kp-accent) 45%,#000);text-shadow:0 0 .5cqw var(--kp-accent),0 0 2.2cqw color-mix(in srgb,var(--kp-accent) 60%,transparent),.3cqw .3cqw 0 rgba(0,0,0,.55);transform:skewX(-6deg);transform-origin:left;animation:kp-flicker 1.4s ease-out both}
.kp-kicker{margin:0;font-family:'Kaushan Script',cursive;font-size:3.1cqw;line-height:1.05;color:#fff;text-shadow:0 0 1.2cqw color-mix(in srgb,var(--kp-accent) 70%,transparent),.2cqw .2cqw 0 rgba(0,0,0,.6);transform:rotate(-2.5deg);transform-origin:left;animation:kp-slide .7s cubic-bezier(.2,1.4,.4,1) both}
.kp-prices{display:flex;flex-direction:column;gap:.65cqw;margin-top:.4cqw}
.kp-price{display:grid;grid-template-columns:3.6cqw 9.5cqw 1fr;align-items:center;gap:1.2cqw;width:34cqw;border:.2cqw solid var(--kp-accent);background:linear-gradient(90deg,rgba(0,0,0,.72),rgba(0,0,0,.45));border-radius:1cqw;padding:.4cqw 1.2cqw .4cqw .5cqw;box-shadow:0 0 1.2cqw color-mix(in srgb,var(--kp-accent) 35%,transparent),inset 0 0 .8cqw color-mix(in srgb,var(--kp-accent) 20%,transparent);animation:kp-pop .6s cubic-bezier(.2,1.5,.4,1) both}
.kp-price:nth-child(2){animation-delay:.15s}.kp-price:nth-child(3){animation-delay:.3s}
.kp-ico{width:3.6cqw;height:3.6cqw;border-radius:50%;display:grid;place-items:center;background:var(--kp-accent);color:var(--kp-primary)}
.kp-ico svg{width:2.2cqw;height:2.2cqw}
.kp-price strong{font-family:Anton,Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:3.6cqw;line-height:1;letter-spacing:.02em;white-space:nowrap}
.kp-plabel{white-space:pre-line;font-size:1.2cqw;font-weight:800;text-transform:uppercase;line-height:1.15;color:#e8e8e8}
.kp-pay{display:flex;align-items:center;gap:.5cqw;flex-wrap:wrap;margin-top:.3cqw}
.kp-pay b{font-size:1cqw;text-transform:uppercase;letter-spacing:.1em;color:var(--kp-accent);margin-right:.3cqw}
.kp-pay span{font-size:1cqw;font-weight:800;background:#fff;color:#111;border-radius:.45cqw;padding:.3cqw .7cqw}
.kp-stick{align-self:center;justify-self:center;position:relative;width:4.6cqw;height:30cqw;border-radius:2.3cqw;background:linear-gradient(90deg,#0c0c0c,#2a2a2a 45%,#0c0c0c);border:.18cqw solid color-mix(in srgb,var(--kp-accent) 70%,#000);box-shadow:0 0 1.6cqw color-mix(in srgb,var(--kp-accent) 45%,transparent),inset 0 0 .6cqw rgba(255,255,255,.15);display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:1.6cqw 0 1cqw;animation:kp-float 4s ease-in-out infinite}
.kp-stick-cap{position:absolute;top:-.8cqw;width:2cqw;height:1cqw;border-radius:.4cqw .4cqw 0 0;background:#333}
.kp-stick-word{writing-mode:vertical-rl;transform:rotate(180deg);font-family:Anton,Impact,sans-serif;font-size:2.4cqw;letter-spacing:.08em;color:#fff}
.kp-stick-word em{color:var(--kp-accent);font-style:normal}
.kp-stick-bolt{width:3cqw;height:3cqw;border-radius:50%;display:grid;place-items:center;border:.18cqw solid var(--kp-accent);color:var(--kp-accent)}
.kp-stick-bolt svg{width:1.8cqw;height:1.8cqw}
.kp-phone{align-self:center;position:relative;height:36cqw;aspect-ratio:9/18.5;border-radius:2.8cqw;background:#050505;border:.55cqw solid #1b1b1b;box-shadow:0 0 0 .18cqw color-mix(in srgb,var(--kp-accent) 80%,transparent),0 0 3cqw color-mix(in srgb,var(--kp-accent) 45%,transparent),0 2cqw 3cqw rgba(0,0,0,.6);overflow:hidden;animation:kp-float 5s ease-in-out infinite reverse;justify-self:center}
.kp-notch{position:absolute;top:.7cqw;left:50%;transform:translateX(-50%);width:5cqw;height:1.2cqw;border-radius:99cqw;background:#000;z-index:3}
.kp-scene{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4cqw;padding:2.4cqw 1.2cqw;text-align:center;opacity:0;transform:scale(.94);transition:opacity .8s,transform .8s;background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--kp-accent) 18%,#000),#000 70%)}
.kp-scene.is-on{opacity:1;transform:none}
.kp-battery{height:17cqw;width:auto;overflow:visible}
.kp-wave{animation:kp-wave 1.2s ease-in-out infinite}
.kp-bolt{transform-origin:105px 225px;animation:kp-pulse 1.4s ease-in-out infinite}
.kp-level{margin:0;font-family:Anton,Impact,sans-serif;font-size:4.2cqw;line-height:1;font-variant-numeric:tabular-nums}
.kp-level small{font-size:2cqw;margin-left:.2cqw}
.kp-charging{margin:0;font-size:1.1cqw;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--kp-accent)}
.kp-scene-photo{justify-content:flex-end;background:#000}
.kp-scene-bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,color-mix(in srgb,var(--kp-accent) 35%,#000),#000);background-size:cover;background-position:center;animation:kp-drift 12s ease-in-out infinite alternate}
.kp-scene-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.9) 5%,transparent 60%)}
.kp-scene-title{position:relative;margin:0;font-family:Anton,Impact,sans-serif;font-size:3cqw;line-height:1;text-transform:uppercase;color:var(--kp-accent);text-shadow:0 0 1.2cqw color-mix(in srgb,var(--kp-accent) 60%,transparent)}
.kp-scene-venue{position:relative;margin:0 0 .6cqw;font-size:1.1cqw;font-weight:800;text-transform:uppercase;letter-spacing:.1em}
.kp-scene-price{margin:0;font-family:Anton,Impact,sans-serif;font-size:7cqw;line-height:1;color:var(--kp-accent);text-shadow:0 0 2cqw color-mix(in srgb,var(--kp-accent) 60%,transparent)}
.kp-scene-sub{margin:0;font-size:1.6cqw;font-weight:800;text-transform:uppercase}
.kp-scene-cap{margin:.8cqw 0 0;font-size:1.3cqw;font-weight:800;background:var(--kp-accent);color:var(--kp-primary);border-radius:99cqw;padding:.35cqw 1cqw;text-transform:uppercase}
.kp-right{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1cqw;min-width:0}
.kp-qr{position:relative;width:100%;max-width:21cqw;aspect-ratio:1;background:#fff;border-radius:1.6cqw;padding:1.3cqw;box-shadow:0 0 0 .35cqw var(--kp-accent),0 0 3cqw color-mix(in srgb,var(--kp-accent) 55%,transparent)}
.kp-qr::after{content:'';position:absolute;inset:-.35cqw;border-radius:1.9cqw;border:.35cqw solid var(--kp-accent);animation:kp-ring 2s ease-out infinite}
.kp-scan{margin:0;text-align:center;line-height:1;font-family:Anton,Impact,sans-serif;font-size:2.8cqw;text-transform:uppercase;letter-spacing:.02em;color:#fff;text-shadow:0 0 1.2cqw color-mix(in srgb,var(--kp-accent) 70%,transparent)}
.kp-stock{margin:0;display:flex;align-items:center;gap:.8cqw;font-size:1.4cqw;font-weight:800;background:rgba(0,0,0,.6);border:.12cqw solid color-mix(in srgb,var(--kp-accent) 50%,transparent);border-radius:99cqw;padding:.55cqw 1.4cqw}
.kp-stock i{width:1cqw;height:1cqw;border-radius:50%;background:var(--kp-accent);box-shadow:0 0 .8cqw var(--kp-accent);animation:kp-blink 1.6s ease-in-out infinite}
.kp-unavailable{font-size:2.2cqw;font-weight:800;text-align:center;background:rgba(0,0,0,.6);border:.2cqw solid #ff8a7a;border-radius:1.4cqw;padding:2cqw}
.kp-steps{grid-column:1/-1;display:flex;align-items:center;gap:.9cqw;margin-top:1.2cqw}
.kp-step{display:flex;align-items:center;gap:.7cqw;font-size:1.25cqw;font-weight:800;text-transform:uppercase;letter-spacing:.02em;background:rgba(0,0,0,.55);border:.15cqw solid rgba(255,255,255,.2);border-radius:99cqw;padding:.45cqw 1.2cqw .45cqw .45cqw;transition:all .5s}
.kp-step-ico{display:grid;place-items:center;width:2.4cqw;height:2.4cqw;border-radius:50%;background:rgba(255,255,255,.14)}
.kp-step-ico svg{width:1.5cqw;height:1.5cqw}
.kp-step.is-on{background:var(--kp-accent);color:var(--kp-primary);border-color:var(--kp-accent);transform:scale(1.07);box-shadow:0 0 1.6cqw color-mix(in srgb,var(--kp-accent) 60%,transparent)}
.kp-step.is-on .kp-step-ico{background:var(--kp-primary);color:var(--kp-accent)}
.kp-brand{margin-left:auto;font-family:Anton,Impact,sans-serif;font-size:2cqw;letter-spacing:.03em}
.kp-brand em{color:var(--kp-accent);font-style:normal}
@keyframes kp-drift{from{transform:scale(1)}to{transform:scale(1.08) translate(-1%,-1%)}}
@keyframes kp-spin{to{transform:rotate(360deg)}}
@keyframes kp-twinkle{0%,100%{opacity:0;transform:scale(.4) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}
@keyframes kp-flicker{0%{opacity:0}8%{opacity:1}12%{opacity:.2}18%{opacity:1}24%{opacity:.4}32%,100%{opacity:1}}
@keyframes kp-slide{from{opacity:0;transform:translateX(-3cqw) rotate(-2.5deg)}to{opacity:1;transform:rotate(-2.5deg)}}
@keyframes kp-pop{from{opacity:0;transform:translateX(-2cqw) scale(.92)}to{opacity:1;transform:none}}
@keyframes kp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-.8cqw)}}
@keyframes kp-ring{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.14)}}
@keyframes kp-wave{0%,100%{opacity:.15}50%{opacity:.55}}
@keyframes kp-pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.12);opacity:1}}
@keyframes kp-blink{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.kp-bg,.kp-rays,.kp-sparkles i,.kp-wave,.kp-bolt,.kp-stock i,.kp-stick,.kp-phone,.kp-qr::after,.kp-scene-bg{animation:none}}
`;

/** A venue's own offer, dressed in its colours. The QR stays in the corner: a promo slide never costs a rental. */
export function KioskPromo({promo, branding, venueName, qrTarget, canRent}: {promo: PosterPromo; branding: PosterBranding; venueName: string; qrTarget: string; canRent: boolean}) {
 const vars = {'--kp-primary': branding.primary, '--kp-accent': branding.accent} as React.CSSProperties;
 const photo = promo.imageUrl ?? branding.backgroundUrl;
 return (
  <div className="kp-frame" style={vars} lang="fr-FR">
   <style>{POSTER_CSS + PROMO_CSS}</style>
   <div className="kp-bg" style={photo ? {backgroundImage: `url(${JSON.stringify(photo)})`} : undefined}/>
   <div className="kpp-shade"/>
   <div className="kp-rays" aria-hidden="true"/>
   <Sparkles/>
   <div className="kpp-content">
    <div className="kp-logo">
     {/* eslint-disable-next-line @next/next/no-img-element */}
     {branding.logoUrl ? <img src={branding.logoUrl} alt={venueName}/> : <span>{venueName}</span>}
    </div>
    <p className="kpp-title">{promo.title}</p>
    {promo.highlight && <p className="kpp-highlight">{promo.highlight}</p>}
    {promo.subtitle && <p className="kpp-subtitle">{promo.subtitle}</p>}
    <p className="kpp-schedule">{promo.schedule}</p>
   </div>
   {canRent && <div className="kpp-corner"><div className="kpp-qr"><QRCodeSVG value={qrTarget} size={256} bgColor="#ffffff" fgColor="#0b0b0b" style={{width: '100%', height: '100%'}}/></div><span>Batterie à plat&nbsp;? Scanne&nbsp;ici</span></div>}
   <span className="kp-brand kpp-brand">batyeo<em>.</em></span>
  </div>
 );
}

const PROMO_CSS = `
.kpp-shade{position:absolute;inset:0;background:linear-gradient(90deg,color-mix(in srgb,var(--kp-primary) 92%,transparent) 0%,color-mix(in srgb,var(--kp-primary) 55%,transparent) 60%,transparent 100%)}
.kpp-content{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;justify-content:center;gap:1cqw;padding:3cqw 4cqw;max-width:66cqw}
.kpp-content .kp-logo{position:absolute;top:2.6cqw;left:4cqw;height:5.6cqw}
.kpp-title{margin:0;font-family:'Kaushan Script',cursive;font-size:4.6cqw;line-height:1;color:#fff;transform:rotate(-3deg);transform-origin:left;text-shadow:0 0 1.4cqw color-mix(in srgb,var(--kp-accent) 70%,transparent);animation:kp-slide .8s cubic-bezier(.2,1.4,.4,1) both}
.kpp-highlight{margin:0;font-family:Anton,Impact,sans-serif;font-size:10cqw;line-height:.92;text-transform:uppercase;color:var(--kp-accent);-webkit-text-stroke:.12cqw color-mix(in srgb,var(--kp-accent) 45%,#000);text-shadow:0 0 .6cqw var(--kp-accent),0 0 3cqw color-mix(in srgb,var(--kp-accent) 60%,transparent),.35cqw .35cqw 0 rgba(0,0,0,.55);transform:skewX(-6deg);transform-origin:left;animation:kp-flicker 1.4s ease-out both,kpp-pop 2.4s 1.4s ease-in-out infinite}
.kpp-subtitle{margin:0;font-size:2.1cqw;font-weight:800;color:#f2f2f2;max-width:56cqw;text-transform:uppercase;letter-spacing:.02em}
.kpp-schedule{margin:.6cqw 0 0;align-self:flex-start;font-family:Anton,Impact,sans-serif;font-size:2cqw;text-transform:uppercase;letter-spacing:.04em;background:var(--kp-accent);color:var(--kp-primary);border-radius:99cqw;padding:.5cqw 1.8cqw;box-shadow:0 0 1.6cqw color-mix(in srgb,var(--kp-accent) 60%,transparent)}
.kpp-corner{position:absolute;right:3cqw;bottom:3cqw;z-index:2;display:flex;flex-direction:column;align-items:center;gap:.6cqw;background:rgba(0,0,0,.6);border:.15cqw solid color-mix(in srgb,var(--kp-accent) 60%,transparent);border-radius:1.4cqw;padding:1cqw}
.kpp-qr{width:10cqw;aspect-ratio:1;background:#fff;border-radius:.8cqw;padding:.6cqw}
.kpp-corner span{font-size:1.1cqw;font-weight:800;text-align:center;max-width:12cqw;text-transform:uppercase}
.kpp-brand{position:absolute;left:4cqw;bottom:2.4cqw;z-index:2}
@keyframes kpp-pop{0%,100%{transform:skewX(-6deg) scale(1)}50%{transform:skewX(-6deg) scale(1.04)}}
@media (prefers-reduced-motion:reduce){.kpp-highlight{animation:none}}
`;
